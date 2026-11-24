/**
 * 工具面：ls / find / read / grep / bash + 浏览器工具。
 *
 * 取数路径不同、工具名稳定：前四个走传输层，bash 走命令表，
 * browser_* 走 Browser 模块。没有 write 与 edit。
 */

import {
  CallFailure,
  exitCodeOf,
  type CallResult,
  type Origin,
} from '../../contract.ts';
import type {
  Entry,
  Item,
  ListOptions,
  ReadOptions,
} from '../../transport/resource.ts';
import type { TransportRouter } from '../../transport/router.ts';
import { createLog } from '../../log.ts';
import type { CommandContext } from '../../registry/command.ts';
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
  { name: 'ls', summary: '列出相邻业务域的结构', write: false },
  { name: 'find', summary: '按条件过滤结构', write: false },
  { name: 'read', summary: '读取内容条目（带 locator）', write: false },
  { name: 'grep', summary: '按查询匹配内容', write: false },
  { name: 'bash', summary: '执行命令（写与改的唯一入口）', write: true },
  {
    name: 'command',
    summary: '按 domain / action / args 调用命令表',
    write: true,
  },
  {
    name: 'command_list',
    summary: '列出命令表（domain / action / args）',
    write: false,
  },
  { name: 'browser_open', summary: '打开网页', write: false },
  { name: 'browser_click', summary: '点击网页元素', write: true },
  { name: 'browser_type', summary: '输入网页文本', write: true },
  { name: 'browser_screenshot', summary: '截取网页画面', write: false },
  { name: 'browser_snapshot', summary: '采集网页快照', write: false },
];

export class ToolSurface {
  constructor(
    private readonly transport: TransportRouter,
    private readonly registry: DomainRegistry,
    private readonly browser: BrowserCapability,
    private readonly cache?: WebCache,
  ) {}

  list(): readonly ToolInfo[] {
    return TOOLS;
  }

  async ls(ref: string, options?: ListOptions): Promise<Entry[]> {
    return this.transport.ls(ref, options);
  }

  async find(ref: string, query: string): Promise<Entry[]> {
    return this.transport.find(ref, query);
  }

  async read(ref: string, options?: ReadOptions): Promise<Item[]> {
    return this.transport.read(ref, options);
  }

  async grep(ref: string, query: string): Promise<Item[]> {
    return this.transport.grep(ref, query);
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
    return this.registry.commandTable().map((entry) => ({
      domain: entry.address.domain,
      resource: entry.address.resource,
      action: entry.action,
      summary: entry.decl.summary,
      args: entry.decl.args,
    }));
  }

  async command(
    domain: string,
    action: string,
    input: Record<string, unknown> = {},
    resource = domain,
  ): Promise<CommandOutcome> {
    const origin: Origin = { type: 'tool', name: 'command' };
    const ctx: CommandContext = {
      origin,
      changed: (ref, type) => this.registry.changed(ref, type),
      log: createLog(`tool:command:${domain}`),
    };
    const result = await this.registry.dispatchCommand(
      { domain, resource },
      action,
      input,
      ctx,
    );
    return outcomeOf(result);
  }

  async bash(argv: readonly string[]): Promise<CommandOutcome> {
    const parsed = parseCommandLine(argv);
    if (!parsed) {
      throw new CallFailure(
        'invalid',
        '命令格式：ws <domain> <action> <ref> [--arg value]',
      );
    }
    const origin: Origin = { type: 'tool', name: 'bash' };
    const ctx: CommandContext = {
      origin,
      changed: (ref, type) => this.registry.changed(ref, type),
      log: createLog(`tool:bash:${parsed.domain}`),
    };
    const result = await this.registry.dispatchCommand(
      { domain: parsed.domain, resource: parsed.domain },
      parsed.action,
      parsed.input,
      ctx,
    );
    return outcomeOf(result);
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
