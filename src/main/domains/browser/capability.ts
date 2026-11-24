/**
 * Browser 能力：打开、导航、执行脚本、读取与采集。
 *
 * 视图宿主在迁移时以具体 Electron 实现注入；这里只保留浏览器聚合状态。
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
  html: string;
}

export interface BrowserViewHandle {
  id: string;
  title: string;
  url?: string;
}

export type BrowserOpenView = (input: {
  id: string;
  type: 'web';
  title: string;
  url: string;
}) => Promise<BrowserViewHandle>;

export class BrowserCapability {
  private readonly tabs = new Map<string, BrowserTab>();
  private readonly byUrl = new Map<string, string>();
  private activeId: string | null = null;
  private seq = 0;

  constructor(
    private readonly host?: ShellHost,
    private readonly openView?: BrowserOpenView,
  ) {}

  list(): BrowserTab[] {
    return [...this.tabs.values()];
  }

  snapshot(): BrowserSnapshotView {
    const active = this.activeId
      ? (this.tabs.get(this.activeId) ?? null)
      : null;
    return {
      tabs: this.list(),
      activeId: this.activeId,
      url: active?.url ?? null,
      title: active?.title ?? null,
      text: '',
    };
  }

  async open(url: string, title?: string): Promise<BrowserTab> {
    const existingId = this.byUrl.get(url);
    const existing = existingId ? this.tabs.get(existingId) : null;
    if (existing) {
      await this.openView?.({
        id: existing.id,
        type: 'web',
        title: existing.title,
        url,
      });
      this.host?.activateView(existing.id);
      for (const [key, item] of this.tabs) {
        this.tabs.set(key, { ...item, active: key === existing.id });
      }
      this.activeId = existing.id;
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
      ? await this.openView(input)
      : this.host!.openView(input);
    const tab: BrowserTab = {
      id,
      url,
      title: title ?? view.title,
      active: true,
    };
    this.byUrl.set(url, id);
    for (const [key, item] of this.tabs) {
      this.tabs.set(key, { ...item, active: false });
    }
    this.tabs.set(id, tab);
    this.activeId = id;
    return tab;
  }

  async navigate(id: string, url: string): Promise<void> {
    this.requireHost('browser/navigate');
    this.host!.navigateView(id, url);
    const tab = this.tabs.get(id);
    if (tab) this.tabs.set(id, { ...tab, url });
  }

  async evaluate<T>(id: string, script: string): Promise<T> {
    this.requireHost('browser/evaluate');
    return this.host!.evaluateView<T>(id, script);
  }

  async read(id?: string): Promise<BrowserPageView> {
    this.requireHost('browser/read');
    const target = id ?? this.activeId;
    if (!target) throw new Error('没有活动网页');
    const page = await this.host!.captureView(target);
    return { url: page.url, title: page.title, text: page.text };
  }

  async click(id: string, selector: string): Promise<void> {
    this.requireHost('browser/click');
    await this.host!.evaluateView(
      id,
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('element not found'); el.click(); })()`,
    );
  }

  async type(id: string, selector: string, text: string): Promise<void> {
    this.requireHost('browser/type');
    await this.host!.evaluateView(
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

  async screenshot(id: string): Promise<Uint8Array> {
    this.requireHost('browser/screenshot');
    return this.host!.screenshotView(id);
  }

  async capture(id?: string): Promise<BrowserCaptureView> {
    this.requireHost('browser/capture');
    const target = id ?? this.activeId;
    if (!target) throw new Error('没有活动网页');
    const page = await this.host!.captureView(target);
    return { url: page.url, title: page.title, html: page.html };
  }

  private requireHost(name: string): void {
    if (!this.host) notImplemented(name);
  }
}
