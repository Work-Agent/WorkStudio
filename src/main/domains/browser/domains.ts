/**
 * browser 模块的 Domain：browser · policy · automation · capture · web。
 *
 * browser 服务的 resources：tabs · policy · automation · capture；
 * web 是独立的内建 Biz Domain：读快照、检索、采集与保存。
 */

import { CallFailure } from '../../contract.ts';
import type { TransportRouter } from '../../transport/router.ts';
import type { ResourceAdapter } from '../../transport/resource.ts';
import type { WebCache } from '../../transport/web-cache.ts';
import type { DomainRegistry } from '../../registry/registry.ts';
import type { BrowserCapability } from './capability.ts';

// ─── browser ─────────────────────────────────────────────────

export function defineTabsResource(
  registry: DomainRegistry,
  browser: BrowserCapability,
): void {
  const resource = registry.define('browser').resource('tabs');
  resource.snapshot(() => browser.snapshot());
  resource.command('open', {
    summary: '打开网页',
    args: {
      url: { type: 'string', required: true },
      title: { type: 'string' },
    },
    run: async (input) => {
      const tab = await browser.open(
        String(input.url),
        typeof input.title === 'string' ? input.title : undefined,
      );
      resource.publish();
      return tab;
    },
  });
  resource.command('navigate', {
    summary: '导航到新地址',
    args: {
      id: { type: 'string', required: true },
      url: { type: 'string', required: true },
    },
    run: async (input) => {
      await browser.navigate(String(input.id), String(input.url));
      resource.publish();
      return null;
    },
  });
  resource.command('evaluate', {
    summary: '在网页中执行脚本',
    args: {
      id: { type: 'string', required: true },
      script: { type: 'string', required: true },
    },
    run: (input) => browser.evaluate(String(input.id), String(input.script)),
  });
  resource.command('read', {
    summary: '读取当前网页文本',
    args: {},
    run: () => browser.read(),
  });
}

// ─── policy ──────────────────────────────────────────────────

export interface PolicyState {
  allowlist: string[];
}

export function createPolicyState(): PolicyState {
  return { allowlist: [] };
}

export function definePolicyResource(
  registry: DomainRegistry,
  state: PolicyState,
  persist?: (allowlist: string[]) => void,
): void {
  const resource = registry.define('browser').resource('policy');
  resource.snapshot(() => ({ allowlist: state.allowlist }));
  resource.command('set', {
    summary: '更新导航白名单',
    args: {},
    run: (input) => {
      if (Array.isArray(input.allowlist)) {
        state.allowlist = [
          ...new Set(
            input.allowlist.filter(
              (value): value is string => typeof value === 'string',
            ),
          ),
        ];
        persist?.(state.allowlist);
        resource.patch({ allowlist: state.allowlist });
      }
      return { allowlist: state.allowlist };
    },
  });
}

// ─── automation ──────────────────────────────────────────────

export interface AutomationState {
  readonly attached: Set<string>;
}

export function createAutomationState(): AutomationState {
  return { attached: new Set() };
}

export function defineAutomationResource(
  registry: DomainRegistry,
  state: AutomationState,
  browser?: BrowserCapability,
): void {
  const resource = registry.define('browser').resource('automation');
  resource.snapshot(() => ({ attached: [...state.attached] }));
  resource.command('attach', {
    summary: '附加调试协议',
    args: { id: { type: 'string', required: true } },
    run: (input) => {
      state.attached.add(String(input.id));
      resource.publish();
      return { attached: [...state.attached] };
    },
  });
  resource.command('detach', {
    summary: '断开调试协议',
    args: { id: { type: 'string', required: true } },
    run: (input) => {
      state.attached.delete(String(input.id));
      resource.publish();
      return { attached: [...state.attached] };
    },
  });
  resource.command('execute', {
    summary: '执行自动化脚本',
    args: {
      id: { type: 'string', required: true },
      script: { type: 'string', required: true },
    },
    run: async (input) => {
      if (!browser) throw new CallFailure('failed', '浏览器宿主未接入');
      const id = String(input.id);
      if (!state.attached.has(id)) {
        throw new CallFailure('failed', `未附加自动化：${id}`);
      }
      return browser.evaluate(id, String(input.script));
    },
  });
}

// ─── capture ─────────────────────────────────────────────────

export interface CaptureRecord {
  target: string;
}

export interface CaptureState {
  session: CaptureRecord | null;
}

export function createCaptureState(): CaptureState {
  return { session: null };
}

export function defineCaptureResource(
  registry: DomainRegistry,
  state: CaptureState,
): void {
  const resource = registry.define('browser').resource('capture');
  resource.snapshot(() => ({ session: state.session }));
  resource.command('begin', {
    summary: '开始指针捕获',
    args: { target: { type: 'string', required: true } },
    run: (input) => {
      state.session = { target: String(input.target) };
      resource.patch({ session: state.session });
      return { session: state.session };
    },
  });
  resource.command('end', {
    summary: '结束指针捕获',
    args: {},
    run: () => {
      state.session = null;
      resource.patch({ session: null });
      return { session: null };
    },
  });
}

// ─── web（内建 Biz Domain） ──────────────────────────────────

export function defineWebResource(
  registry: DomainRegistry,
  cache: WebCache,
  browser?: BrowserCapability,
  save?: (url: string, ref?: string) => Promise<{ ref: string }>,
): void {
  const resource = registry.define('web').resource('web');
  resource.snapshot(() => ({ cache: cache.directory }));
  resource.command('capture', {
    summary: '采集网页为快照',
    args: { url: { type: 'string', required: true } },
    run: async (_input) => {
      if (!browser) throw new CallFailure('failed', '浏览器宿主未接入');
      const page = await browser.capture();
      const saved = await cache.save({
        url: page.url,
        title: page.title,
        markdown: page.html,
        capturedAt: Date.now(),
      });
      resource.publish();
      return saved;
    },
  });
  resource.command('save', {
    summary: '保存快照为工作区资源',
    args: {
      url: { type: 'string', required: true },
      ref: { type: 'string' },
    },
    run: async (input) => {
      if (!save) throw new CallFailure('failed', '工作区写入未接入');
      const result = await save(
        String(input.url),
        typeof input.ref === 'string' ? input.ref : undefined,
      );
      resource.publish();
      return result;
    },
  });
}

export function registerWebAdapter(
  transport: TransportRouter,
  cache: WebCache,
): void {
  transport.register('web', createWebAdapter(cache), [
    { prefixes: ['http://', 'https://'], priority: 10 },
  ]);
}

export function unregisterWebAdapter(transport: TransportRouter): void {
  transport.revoke('web');
}

function createWebAdapter(cache: WebCache): ResourceAdapter {
  return {
    async read(ref) {
      const doc = await cache.get(ref);
      if (!doc) throw new CallFailure('not_found', `没有网页快照：${ref}`);
      return [
        {
          locator: doc.url,
          title: doc.title,
          text: doc.markdown,
        },
      ];
    },
    async grep(ref, query) {
      const doc = await cache.get(ref);
      if (!doc) return [];
      const index = doc.markdown.indexOf(query);
      if (index < 0) return [];
      return [
        {
          locator: doc.url,
          snippet: doc.markdown.slice(index, index + 160),
        },
      ];
    },
  };
}
