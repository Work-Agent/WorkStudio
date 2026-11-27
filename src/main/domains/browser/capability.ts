/**
 * Browser 能力：打开、导航、执行脚本、读取与采集。
 *
 * 标签按窗口（= 工作区）隔离：`browser/<wsId>/tabs`；agent 工具等没有窗口上下文的
 * 调用方沿用「活动窗口」的便捷方法，内部仍然落到具体窗口。
 */

import { notImplemented } from '../../contract.ts';
import type { ShellHost } from '../shell/native.ts';

export interface BrowserTab {
  id: string;
  url: string;
  title: string;
  active: boolean;
}

export interface BrowserSnapshotView {
  tabs: BrowserTab[];
  activeId: string | null;
  url: string | null;
  title: string | null;
  text: string;
}

export interface BrowserPageView {
  url: string;
  title: string;
  text: string;
}

export interface BrowserCaptureView {
  url: string;
  title: string;
  excerpt: string;
  html: string;
  markdown: string;
  icon: string;
}

export interface BrowserViewHandle {
  id: string;
  title: string;
  url?: string;
}

export type BrowserOpenView = (
  windowId: string,
  input: {
    id: string;
    type: 'web';
    title: string;
    url: string;
  },
) => Promise<BrowserViewHandle>;

interface WindowTabs {
  readonly tabs: Map<string, BrowserTab>;
  readonly byUrl: Map<string, string>;
  activeId: string | null;
}

export class BrowserCapability {
  private readonly windows = new Map<string, WindowTabs>();
  private seq = 0;

  constructor(
    private readonly host?: ShellHost,
    private readonly openView?: BrowserOpenView,
  ) {}

  private tabsOf(windowId: string): WindowTabs {
    let state = this.windows.get(windowId);
    if (!state) {
      state = { tabs: new Map(), byUrl: new Map(), activeId: null };
      this.windows.set(windowId, state);
    }
    return state;
  }

  private activeWindow(): string {
    const id = this.host?.activeWindow();
    if (!id) throw new Error('没有活动窗口');
    return id;
  }

  /** 标签属于哪个窗口：agent 工具只拿得到标签 id。 */
  private tabWindow(id: string): string | null {
    for (const [windowId, state] of this.windows) {
      if (state.tabs.has(id)) return windowId;
    }
    return null;
  }

  forgetWindow(windowId: string): void {
    this.windows.delete(windowId);
  }

  list(windowId: string): BrowserTab[] {
    return [...this.tabsOf(windowId).tabs.values()];
  }

  snapshot(windowId: string): BrowserSnapshotView {
    const state = this.tabsOf(windowId);
    const active = state.activeId
      ? (state.tabs.get(state.activeId) ?? null)
      : null;
    return {
      tabs: [...state.tabs.values()],
      activeId: state.activeId,
      url: active?.url ?? null,
      title: active?.title ?? null,
      text: '',
    };
  }

  /** 便捷入口：活动窗口。 */
  async open(url: string, title?: string): Promise<BrowserTab> {
    return this.openIn(this.activeWindow(), url, title);
  }

  async openIn(
    windowId: string,
    url: string,
    title?: string,
  ): Promise<BrowserTab> {
    const state = this.tabsOf(windowId);
    const existingId = state.byUrl.get(url);
    const existing = existingId ? state.tabs.get(existingId) : null;
    if (existing) {
      await this.openView?.(windowId, {
        id: existing.id,
        type: 'web',
        title: existing.title,
        url,
      });
      this.host?.activateView(windowId, existing.id);
      for (const [key, item] of state.tabs) {
        state.tabs.set(key, { ...item, active: key === existing.id });
      }
      state.activeId = existing.id;
      return existing;
    }
    if (!this.host && !this.openView) notImplemented('browser/open');
    const id = `browser-${++this.seq}`;
    const input = {
      id,
      type: 'web' as const,
      title: title ?? url,
      url,
    };
    const view = this.openView
      ? await this.openView(windowId, input)
      : this.host!.openView(windowId, input);
    const tab: BrowserTab = {
      id,
      url,
      title: title ?? view.title,
      active: true,
    };
    state.byUrl.set(url, id);
    for (const [key, item] of state.tabs) {
      state.tabs.set(key, { ...item, active: false });
    }
    state.tabs.set(id, tab);
    state.activeId = id;
    return tab;
  }

  async navigateIn(windowId: string, id: string, url: string): Promise<void> {
    this.requireHost('browser/navigate');
    this.host!.navigateView(windowId, id, url);
    const state = this.tabsOf(windowId);
    const tab = state.tabs.get(id);
    if (tab) state.tabs.set(id, { ...tab, url });
  }

  async evaluateIn<T>(
    windowId: string,
    id: string,
    script: string,
  ): Promise<T> {
    this.requireHost('browser/evaluate');
    return this.host!.evaluateView<T>(windowId, id, script);
  }

  async evaluate<T>(id: string, script: string): Promise<T> {
    const windowId = this.tabWindow(id);
    if (!windowId) throw new Error(`网页标签不存在：${id}`);
    return this.evaluateIn<T>(windowId, id, script);
  }

  async readIn(windowId: string, id?: string): Promise<BrowserPageView> {
    this.requireHost('browser/read');
    const state = this.tabsOf(windowId);
    const target = id ?? state.activeId;
    if (!target) throw new Error('没有活动网页');
    const page = await this.host!.captureView(windowId, target);
    return { url: page.url, title: page.title, text: page.text };
  }

  async read(id?: string): Promise<BrowserPageView> {
    const windowId = id ? this.tabWindow(id) : this.activeWindow();
    if (!windowId) throw new Error(`网页标签不存在：${id}`);
    return this.readIn(windowId, id);
  }

  async clickIn(windowId: string, id: string, selector: string): Promise<void> {
    this.requireHost('browser/click');
    await this.host!.evaluateView(
      windowId,
      id,
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('element not found'); el.click(); })()`,
    );
  }

  async click(id: string, selector: string): Promise<void> {
    const windowId = this.tabWindow(id);
    if (!windowId) throw new Error(`网页标签不存在：${id}`);
    return this.clickIn(windowId, id, selector);
  }

  async typeIn(
    windowId: string,
    id: string,
    selector: string,
    text: string,
  ): Promise<void> {
    this.requireHost('browser/type');
    await this.host!.evaluateView(
      windowId,
      id,
      `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error('element not found');
        el.focus();
        el.value = ${JSON.stringify(text)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      })()`,
    );
  }

  async type(id: string, selector: string, text: string): Promise<void> {
    const windowId = this.tabWindow(id);
    if (!windowId) throw new Error(`网页标签不存在：${id}`);
    return this.typeIn(windowId, id, selector, text);
  }

  async screenshotIn(windowId: string, id: string): Promise<Uint8Array> {
    this.requireHost('browser/screenshot');
    return this.host!.screenshotView(windowId, id);
  }

  async screenshot(id: string): Promise<Uint8Array> {
    const windowId = this.tabWindow(id);
    if (!windowId) throw new Error(`网页标签不存在：${id}`);
    return this.screenshotIn(windowId, id);
  }

  async captureIn(windowId: string, id?: string): Promise<BrowserCaptureView> {
    this.requireHost('browser/capture');
    const state = this.tabsOf(windowId);
    const target = id ?? state.activeId;
    if (!target) throw new Error('没有活动网页');
    const page = await this.host!.captureView(windowId, target);
    return {
      url: page.url,
      title: page.title,
      excerpt: page.excerpt,
      html: page.html,
      markdown: page.markdown,
      icon: page.icon,
    };
  }

  async capture(id?: string): Promise<BrowserCaptureView> {
    const windowId = id ? this.tabWindow(id) : this.activeWindow();
    if (!windowId) throw new Error(`网页标签不存在：${id}`);
    return this.captureIn(windowId, id);
  }

  private requireHost(name: string): void {
    if (!this.host) notImplemented(name);
  }
}
