/**
 * BrowserAutomation —— 浏览器自动化（architecture.md §7.3）。
 *
 * 对象是资源面板里的 web tab：打开/复用走 BrowserTabs 端口。
 * 页面操作用网页 preload 执行结构化操作，主进程不注入脚本、不挂调试器；
 * 截图走 capturePage。工具层只依赖 BrowserAutomationContract。
 */
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ipcMain, type WebContents } from 'electron';
import { CH_WEB } from '../../../../shared/channels.ts';
import type {
  WebOp,
  WebOpReply,
  WebOpResult,
} from '../../../../shared/web-page.ts';
import type {
  BrowserAutomationContract,
  BrowserPageState,
  BrowserSnapshot,
} from '../../../agent/harness/browser-contract.ts';
import type { BrowserTabs } from './tabs.ts';

const OP_TIMEOUT_MS = 15_000;
const LOAD_TIMEOUT_MS = 15_000;

interface Pending {
  resolve: (result: WebOpResult) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class BrowserAutomation implements BrowserAutomationContract {
  private readonly pending = new Map<string, Pending>();
  private seq = 0;

  constructor(private readonly tabs: BrowserTabs) {
    // 回执按 webContents + 请求号匹配：同一页面可并发多个操作。
    ipcMain.on(CH_WEB, (event, reply: WebOpReply) => {
      const key = `${event.sender.id}:${reply.id}`;
      const entry = this.pending.get(key);
      if (!entry) return;
      this.pending.delete(key);
      clearTimeout(entry.timer);
      if (reply.error) entry.reject(new Error(reply.error));
      else entry.resolve(reply.result ?? {});
    });
  }

  async open(url: string): Promise<{ viewId: string; url: string }> {
    if (!/^https?:\/\//i.test(url) && !/^file:\/\//i.test(url)) {
      throw new Error(`Unsupported URL scheme (http/https/file only): ${url}`);
    }
    const { id } = await this.tabs.openWeb(url);
    const wc = this.webContents(id);
    await this.waitForLoad(wc);
    return { viewId: id, url: wc.getURL() || url };
  }

  async read(viewId?: string): Promise<BrowserPageState> {
    const id = this.resolveId(viewId);
    const wc = this.webContents(id);
    await this.waitForLoad(wc);
    const result = await this.webOp(wc, { kind: 'text' });
    const page = result.text;
    if (!page) throw new Error('page read returned no content');
    return { viewId: id, url: page.url, title: page.title, text: page.text };
  }

  async snapshot(viewId?: string): Promise<BrowserSnapshot> {
    const id = this.resolveId(viewId);
    const wc = this.webContents(id);
    await this.waitForLoad(wc);
    const result = await this.webOp(wc, { kind: 'outline' });
    const page = result.outline;
    if (!page) throw new Error('page snapshot returned no content');
    return { viewId: id, ...page };
  }

  async click(
    selector: string,
    viewId?: string,
  ): Promise<{ ok: boolean; note?: string }> {
    const wc = this.webContents(this.resolveId(viewId));
    try {
      await this.webOp(wc, { kind: 'click', selector });
      return { ok: true };
    } catch (error) {
      return { ok: false, note: messageOf(error) };
    }
  }

  async type(
    selector: string,
    text: string,
    viewId?: string,
  ): Promise<{ ok: boolean; note?: string }> {
    const wc = this.webContents(this.resolveId(viewId));
    try {
      await this.webOp(wc, { kind: 'type', selector, text });
      return { ok: true };
    } catch (error) {
      return { ok: false, note: messageOf(error) };
    }
  }

  async back(viewId?: string): Promise<void> {
    const wc = this.webContents(this.resolveId(viewId));
    if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  }

  async screenshot(viewId?: string): Promise<string> {
    const wc = this.webContents(this.resolveId(viewId));
    const image = await wc.capturePage();
    const file = join(tmpdir(), `workstudio-shot-${Date.now()}.png`);
    writeFileSync(file, image.toPNG());
    return file;
  }

  activeViewId(): string | null {
    return this.tabs.activeViewId();
  }

  // ─── 内部 ────────────────────────────────────────────────────

  private resolveId(viewId?: string): string {
    const id = viewId ?? this.activeViewId();
    if (!id) throw new Error('No active browser tab — open a URL first');
    return id;
  }

  private webContents(id: string): WebContents {
    const wc = this.tabs.webContents(id);
    if (!wc || wc.isDestroyed()) throw new Error('No browser page available');
    return wc;
  }

  /** 向网页 preload 下发一次操作，等待回执。 */
  private webOp(wc: WebContents, op: WebOp): Promise<WebOpResult> {
    if (wc.isDestroyed())
      return Promise.reject(new Error('browser tab is gone'));
    this.seq += 1;
    const id = this.seq;
    const key = `${wc.id}:${id}`;
    return new Promise<WebOpResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(key);
        reject(new Error('browser operation timed out'));
      }, OP_TIMEOUT_MS);
      this.pending.set(key, { resolve, reject, timer });
      wc.send(CH_WEB, { id, op });
    });
  }

  /**
   * 等待 tab 完成本轮加载；已在稳定态则立即返回。
   * 失败/超时都放行（由后续读取反映实际页面），但会清掉监听。
   */
  private async waitForLoad(wc: WebContents): Promise<void> {
    if (!wc.isLoading()) return;
    await new Promise<void>((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        wc.off('did-finish-load', done);
        wc.off('did-fail-load', failed);
        wc.off('destroyed', done);
        resolve();
      };
      // 子框架加载失败不代表主文档失败，只有主框架失败才放行。
      const failed = (
        _event: Electron.Event,
        _code: number,
        _description: string,
        _url: string,
        isMainFrame: boolean,
      ): void => {
        if (isMainFrame) done();
      };
      const timer = setTimeout(done, LOAD_TIMEOUT_MS);
      wc.once('did-finish-load', done);
      wc.on('did-fail-load', failed);
      wc.once('destroyed', done);
    });
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
