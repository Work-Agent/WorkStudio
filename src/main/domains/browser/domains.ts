/**
 * browser 模块的 Domain：browser · policy · automation · capture · web。
 *
 * browser 服务的 resources：tabs · policy · automation · capture；
 * web 是独立的内建 Biz Domain：读快照、检索、采集与保存。
 */

import { snapshotTitle } from '../../../shared/snapshots.ts';
import { CallFailure } from '../../contract.ts';
import type { TransportRouter } from '../../transport/router.ts';
import type { ResourceAdapter } from '../../transport/resource.ts';
import type { WebCache } from '../../transport/web-cache.ts';
import type { DomainRegistry } from '../../registry/registry.ts';
import type { BrowserCapability } from './capability.ts';

// ─── browser ─────────────────────────────────────────────────

export function tabsResourceName(windowId: string): string {
  return `${windowId}/tabs`;
}

export function defineTabsResources(
  registry: DomainRegistry,
  browser: BrowserCapability,
): { ensure: (windowId: string) => void; remove: (windowId: string) => void } {
  const define = (windowId: string): void => {
    const domain = registry.define('browser');
    const name = tabsResourceName(windowId);
    if (domain.resourceOf(name)) return;
    const resource = domain.resource(name);
    resource.snapshot(() => browser.snapshot(windowId));
    resource.command('open', {
      summary: '打开网页',
      args: {
        url: { type: 'string', required: true },
        title: { type: 'string' },
      },
      run: async (input) => {
        const tab = await browser.openIn(
          windowId,
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
        await browser.navigateIn(windowId, String(input.id), String(input.url));
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
      run: (input) =>
        browser.evaluateIn(windowId, String(input.id), String(input.script)),
    });
    resource.command('read', {
      summary: '读取当前网页文本',
      args: {},
      run: () => browser.readIn(windowId),
    });
  };

  return {
    ensure: (windowId: string) => define(windowId),
    remove: (windowId: string) => {
      browser.forgetWindow(windowId);
      registry.define('browser').remove(tabsResourceName(windowId));
    },
  };
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

/** 自动化附加是窗口级状态：`browser/<wsId>/automation`。 */
export interface AutomationStates {
  readonly byWindow: Map<string, AutomationState>;
}

export function createAutomationStates(): AutomationStates {
  return { byWindow: new Map() };
}

export function automationResourceName(windowId: string): string {
  return `${windowId}/automation`;
}

export function defineAutomationResources(
  registry: DomainRegistry,
  states: AutomationStates,
  browser?: BrowserCapability,
): { ensure: (windowId: string) => void; remove: (windowId: string) => void } {
  const define = (windowId: string): void => {
    const domain = registry.define('browser');
    const name = automationResourceName(windowId);
    if (domain.resourceOf(name)) return;
    let state = states.byWindow.get(windowId);
    if (!state) {
      state = { attached: new Set() };
      states.byWindow.set(windowId, state);
    }
    const resource = domain.resource(name);
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
        return browser.evaluateIn(windowId, id, String(input.script));
      },
    });
  };

  return {
    ensure: (windowId: string) => define(windowId),
    remove: (windowId: string) => {
      states.byWindow.delete(windowId);
      registry.define('browser').remove(automationResourceName(windowId));
    },
  };
}

// ─── capture ─────────────────────────────────────────────────

export interface CaptureRecord {
  target: string;
}

export interface CaptureState {
  session: CaptureRecord | null;
}

/** 网页采集（指针捕获）是窗口级会话：`browser/<wsId>/capture`。 */
export interface CaptureStates {
  readonly byWindow: Map<string, CaptureState>;
}

export function createCaptureStates(): CaptureStates {
  return { byWindow: new Map() };
}

export function captureResourceName(windowId: string): string {
  return `${windowId}/capture`;
}

export function defineCaptureResources(
  registry: DomainRegistry,
  states: CaptureStates,
): { ensure: (windowId: string) => void; remove: (windowId: string) => void } {
  const define = (windowId: string): void => {
    const domain = registry.define('browser');
    const name = captureResourceName(windowId);
    if (domain.resourceOf(name)) return;
    let state = states.byWindow.get(windowId);
    if (!state) {
      state = { session: null };
      states.byWindow.set(windowId, state);
    }
    const resource = domain.resource(name);
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
  };

  return {
    ensure: (windowId: string) => define(windowId),
    remove: (windowId: string) => {
      states.byWindow.delete(windowId);
      registry.define('browser').remove(captureResourceName(windowId));
    },
  };
}

// ─── web（内建 Biz Domain） ──────────────────────────────────

export function defineWebResource(
  registry: DomainRegistry,
  cache: WebCache,
  browser?: BrowserCapability,
  save?: (url: string, ref?: string) => Promise<{ ref: string }>,
  removeSite?: (domain: string) => Promise<void>,
): void {
  const resource = registry.define('web').resource('web');
  /** 站点采集的进行中状态：清单与面板都从快照里读。 */
  let crawl: { url: string; done: number; total: number } | null = null;
  resource.snapshot(() => ({
    cache: cache.directory,
    ...(crawl ? { crawl } : {}),
  }));
  resource.command('list', {
    summary: '列出网页快照缓存',
    args: {},
    run: async () => {
      // 老缓存只有 JSON：清单一律补写成工作区里的 .md，打开即 markdown。
      if (save) {
        for (const doc of cache.list()) {
          if (doc.fileRef) continue;
          try {
            const file = await save(doc.url);
            cache.attachFile(doc.url, file.ref);
          } catch {
            /* 写不进去就保留旧地址，读取不受影响 */
          }
        }
      }
      return cache.list().map((doc) => ({
        url: doc.url,
        title: snapshotTitle(doc),
        capturedAt: doc.capturedAt,
        ref: doc.fileRef ?? cache.refOf(doc.url),
        ...(doc.icon ? { icon: doc.icon } : {}),
      }));
    },
  });
  resource.command('doc', {
    summary: '读取一份快照的正文',
    args: { url: { type: 'string', required: true } },
    run: async (input) => {
      const doc = await cache.get(String(input.url));
      if (!doc) throw new CallFailure('not_found', '没有网页快照');
      return doc;
    },
  });
  resource.command('remove', {
    summary: '删除网页快照',
    args: { url: { type: 'string', required: true } },
    run: (input) => {
      cache.remove(String(input.url));
      resource.publish();
      return null;
    },
  });
  resource.command('crawl', {
    summary: '采集整个站点',
    args: {
      url: { type: 'string', required: true },
      max: { type: 'number' },
    },
    run: async (input) => {
      if (!browser) throw new CallFailure('failed', '浏览器宿主未接入');
      if (!save) throw new CallFailure('failed', '工作区写入未接入');
      if (crawl) throw new CallFailure('failed', '已有采集任务在运行');
      const url = String(input.url);
      const max = Math.min(Math.max(Number(input.max) || 50, 1), 200);
      crawl = { url, done: 0, total: 0 };
      resource.publish();
      try {
        const captured = await browser.crawl(
          url,
          max,
          async (page, done, total) => {
            await cache.save({
              url: page.url,
              title: page.title,
              markdown: page.markdown,
              ...(page.excerpt ? { excerpt: page.excerpt } : {}),
              capturedAt: Date.now(),
              ...(page.icon ? { icon: page.icon } : {}),
            });
            const file = await save(page.url);
            cache.attachFile(page.url, file.ref);
            crawl = { url, done, total };
            resource.publish();
          },
        );
        return { captured };
      } finally {
        crawl = null;
        resource.publish();
      }
    },
  });
  resource.command('removeSite', {
    summary: '删除一个站点的全部快照',
    args: { domain: { type: 'string', required: true } },
    run: async (input) => {
      const domain = String(input.domain);
      cache.removeDomain(domain);
      await removeSite?.(domain);
      resource.publish();
      return null;
    },
  });
  resource.command('capture', {
    summary: '采集网页为快照',
    args: { url: { type: 'string', required: true } },
    run: async (_input) => {
      if (!browser) throw new CallFailure('failed', '浏览器宿主未接入');
      const page = await browser.capture();
      const saved = await cache.save({
        url: page.url,
        title: page.title,
        markdown: page.markdown,
        ...(page.excerpt ? { excerpt: page.excerpt } : {}),
        capturedAt: Date.now(),
        ...(page.icon ? { icon: page.icon } : {}),
      });
      // 同时落成工作区里的 Markdown：清单条目打开时走 markdown 编辑器。
      if (save) {
        const file = await save(page.url);
        cache.attachFile(page.url, file.ref);
        resource.publish();
        const doc = await cache.get(page.url);
        return { ref: doc ? cache.refOfDoc(doc) : file.ref };
      }
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
