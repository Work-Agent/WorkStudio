/**
 * 工具面：ls / find / read / grep / bash + 浏览器工具。
 *
 * 前四个是取数面（与页面 bridge、插件上下文同一份实现），
 * bash 是写与改的唯一通道（技能说明怎么调），browser_* 走 Browser 模块。
 * 没有 write / edit / open / command：写走命令，导航归页面。
 */

import type { ResourceAccess } from '@work-studio/sdk';
import { CallFailure, exitCodeOf, type CallResult } from '../../contract.ts';
import type {
  Entry,
  Item,
  ListOptions,
  ReadOptions,
  ResourceRoot,
} from '../../transport/resource.ts';
import { TransportAccess } from '../../transport/access.ts';
import type { TransportRouter } from '../../transport/router.ts';
import { createLog } from '../../log.ts';
import type { CommandInput } from '../../registry/command.ts';
import { parseCommandLine } from '../../registry/command.ts';
import type { DomainRegistry } from '../../registry/registry.ts';
import type { WebCache } from '../../transport/web-cache.ts';
import type {
  BrowserCaptureView,
  BrowserCapability,
  BrowserPageView,
  BrowserTab,
} from '../browser/capability.ts';

export interface ToolInfo {
  name: string;
  summary: string;
  /** 是否写入：写与改只能经命令通道。 */
  write: boolean;
}

export interface CommandOutcome {
  stdout: string;
  data?: unknown;
  exitCode: number;
}

const TOOLS: readonly ToolInfo[] = [
  { name: 'ls', summary: '结构：认领者并发聚合', write: false },
  { name: 'find', summary: '结构：按名字过滤', write: false },
  { name: 'read', summary: '内容：条目带 locator', write: false },
  { name: 'grep', summary: '内容：按查询匹配', write: false },
  {
    name: 'open',
    summary: '把 locator 交给宿主打开（与侧栏同一入口）',
    write: false,
  },
  { name: 'bash', summary: '写与改：按技能说明执行命令', write: true },
  { name: 'browser_open', summary: '打开网页', write: false },
  { name: 'browser_click', summary: '点击网页元素', write: true },
  { name: 'browser_type', summary: '输入网页文本', write: true },
  { name: 'browser_screenshot', summary: '截取网页画面', write: false },
  { name: 'browser_snapshot', summary: '采集网页快照', write: false },
];

export class ToolSurface implements ResourceAccess {
  /** 插件引擎命令的开关：已激活的插件技能所属插件。 */
  private skillOwners: () => readonly string[] = () => [];
  /** 取数面：与页面 bridge、插件上下文同一份实现。 */
  private readonly access: TransportAccess;

  constructor(
    private readonly transport: TransportRouter,
    private readonly registry: DomainRegistry,
    private readonly browser: BrowserCapability,
    private readonly cache?: WebCache,
    /** 打开入口：与侧栏点击同一条路（点位、插件页、外链都由宿主解释）。 */
    private readonly openLocation?: (
      ref: string,
      locator?: string,
    ) => Promise<unknown>,
  ) {
    this.access = new TransportAccess(transport);
  }

  /** 技能在 AgentApp 里才就绪：组合根在装配完成后回填这个开关。 */
  bindSkillOwners(owners: () => readonly string[]): void {
    this.skillOwners = owners;
  }

  list(): readonly ToolInfo[] {
    return TOOLS;
  }

  /** 会话创建时注入资源地图：已登记适配器的资源根。 */
  resourceRoots(): ResourceRoot[] {
    return this.transport.resourceRoots();
  }

  /** 打开：人看到的就是助手打开的那个页面，两种交互共用同一入口。 */
  async open(ref: string, locator?: string): Promise<unknown> {
    if (!this.openLocation) throw new CallFailure('failed', '打开能力未接入');
    return this.openLocation(ref, locator);
  }

  ls(ref: string, options?: ListOptions): Promise<Entry[]> {
    return this.access.ls(ref, options);
  }

  find(ref: string, query: string): Promise<Entry[]> {
    return this.access.find(ref, query);
  }

  read(ref: string, options?: ReadOptions): Promise<Item[]> {
    return this.access.read(ref, options);
  }

  grep(ref: string, query: string): Promise<Item[]> {
    return this.access.grep(ref, query);
  }

  /**
   * bash：argv 由框架解析，落到同一张命令表。
   * 退出码：0 成功、1 失败、2 用法、3 未找到。
   */
  commandList(): Array<{
    domain: string;
    resource: string;
    action: string;
    summary: string;
    args: unknown;
  }> {
    const owners = this.skillOwners();
    return (
      this.registry
        .commandTable()
        // 插件引擎命令随技能开启：选中某个技能，它的域才进命令表。
        .filter(
          (entry) =>
            entry.agentExposed !== false ||
            (entry.address.resource === entry.owner &&
              owners.includes(entry.owner)),
        )
        .map((entry) => ({
          domain: entry.address.domain,
          resource: entry.address.resource,
          action: entry.action,
          summary: entry.decl.summary,
          args: entry.decl.args,
        }))
    );
  }

  async bash(argv: readonly string[]): Promise<CommandOutcome> {
    const parsed = parseCommandLine(argv);
    if (!parsed) {
      throw new CallFailure(
        'invalid',
        '命令格式：ws <domain>/<resource> <action> <ref> [--arg value]',
      );
    }
    return this.dispatch(
      { domain: parsed.domain, resource: parsed.resource },
      parsed.action,
      parsed.input,
      'bash',
    );
  }

  /**
   * 命令分发：未知地址时把命令表里的候选回给模型。
   * 猜 `fs/fs/write` 这类不存在的地址只是一次无信息的往返，
   * 把真实可用的 domain / action 写回 stdout 才能让它自己收敛。
   */
  private async dispatch(
    address: { domain: string; resource: string },
    action: string,
    input: CommandInput,
    tool: 'bash',
  ): Promise<CommandOutcome> {
    const result = await this.registry.dispatchCommand(address, action, input, {
      origin: {
        type: 'tool',
        name: tool,
        skills: this.skillOwners(),
      },
      changed: (ref, type) => this.registry.changed(ref, type),
      log: createLog(`tool:${tool}:${address.domain}`),
    });
    const outcome = outcomeOf(result);
    if (result.ok || result.error.code !== 'unknown') return outcome;
    return {
      ...outcome,
      stdout: `${outcome.stdout}\n${this.unknownHint(address)}`,
    };
  }

  private unknownHint(address: { domain: string; resource: string }): string {
    const rows = this.commandList();
    const scoped = rows.filter(
      (entry) =>
        entry.domain === address.domain && entry.resource === address.resource,
    );
    if (scoped.length) {
      const actions = [...new Set(scoped.map((entry) => entry.action))];
      return `可用命令（${address.domain}/${address.resource}）：${actions.join(' / ')}`;
    }
    const domains = [...new Set(rows.map((entry) => entry.domain))].sort();
    const shown = domains.slice(0, 24).join(' / ');
    return `可用域：${shown}${domains.length > 24 ? ' …' : ''}；命令形如 <domain>/<domain>/<action>，具体用法见对应技能`;
  }

  async browserOpen(url: string): Promise<BrowserTab> {
    return this.browser.open(url);
  }

  async browserClick(id: string, selector: string): Promise<void> {
    return this.browser.click(id, selector);
  }

  async browserType(id: string, selector: string, text: string): Promise<void> {
    return this.browser.type(id, selector, text);
  }

  async browserScreenshot(id: string): Promise<Uint8Array> {
    return this.browser.screenshot(id);
  }

  async browserSnapshot(
    id?: string,
  ): Promise<BrowserCaptureView & { ref?: string }> {
    const page = await this.browser.capture(id);
    const saved = await this.cache?.save({
      url: page.url,
      title: page.title,
      markdown: page.html,
      capturedAt: Date.now(),
    });
    return saved ? { ...page, ref: saved.ref } : page;
  }

  async browserRead(id?: string): Promise<BrowserPageView> {
    return this.browser.read(id);
  }
}

function outcomeOf(result: CallResult): CommandOutcome {
  if (result.ok) {
    return {
      stdout:
        typeof result.data === 'string'
          ? result.data
          : JSON.stringify(result.data ?? null),
      data: result.data,
      exitCode: 0,
    };
  }
  return {
    stdout: result.error.message,
    exitCode: exitCodeOf(result.error.code),
  };
}
