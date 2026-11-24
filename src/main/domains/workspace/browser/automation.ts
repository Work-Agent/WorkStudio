/**
 * BrowserAutomation —— 浏览器自动化（architecture.md §9.2）。
 *
 * 对象是资源面板里的 web tab：打开/复用走 BrowserTabs 端口，
 * 读取与快照走注入求值，点击/输入/截图走 tab 自己的
 * `webContents.debugger`。工具层只依赖 BrowserAutomationContract。
 */
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WebContents } from 'electron';
import type {
  BrowserAutomationContract,
  BrowserPageState,
  BrowserSnapshot,
} from '../../../agent/harness/browser-contract.ts';
import { readScript, snapshotScript } from './page.ts';
import type { PageExtraction, PageReading } from './page.ts';
import type { BrowserTabs } from './tabs.ts';

interface BoxModel {
  model: { content: number[] };
}

interface NodeId {
  nodeId: number;
}

const ATTACH_TIMEOUT_MS = 15_000;

export class BrowserAutomation implements BrowserAutomationContract {
  constructor(private readonly tabs: BrowserTabs) {}

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
    const page = await this.evaluate<PageReading>(wc, readScript());
    return { viewId: id, url: page.url, title: page.title, text: page.text };
  }

  async snapshot(viewId?: string): Promise<BrowserSnapshot> {
    const id = this.resolveId(viewId);
    const wc = this.webContents(id);
    await this.waitForLoad(wc);
    const page = await this.evaluate<PageExtraction>(wc, snapshotScript());
    return { viewId: id, ...page };
  }

  async click(
    selector: string,
    viewId?: string,
  ): Promise<{ ok: boolean; note?: string }> {
    const wc = this.webContents(this.resolveId(viewId));
    const nodeId = await this.nodeId(wc, selector);
    if (nodeId === null) return { ok: false, note: 'element not found' };

    // 目标可能在滚动区外：先滚进视口，再取几何。
    await this.send(wc, 'DOM.scrollIntoViewIfNeeded', { nodeId }).catch(
      () => undefined,
    );
    const box = await this.send<BoxModel>(wc, 'DOM.getBoxModel', {
      nodeId,
    }).catch(() => null);
    const quad = box?.model.content;
    if (!quad || quad.length < 8) {
      return { ok: false, note: 'element has no layout box' };
    }
    const x = (quad[0]! + quad[2]! + quad[4]! + quad[6]!) / 4;
    const y = (quad[1]! + quad[3]! + quad[5]! + quad[7]!) / 4;
    await this.pointer(wc, 'mouseMoved', x, y);
    await this.pointer(wc, 'mousePressed', x, y);
    await this.pointer(wc, 'mouseReleased', x, y);
    return { ok: true };
  }

  async type(
    selector: string,
    text: string,
    viewId?: string,
  ): Promise<{ ok: boolean; note?: string }> {
    const wc = this.webContents(this.resolveId(viewId));
    const nodeId = await this.nodeId(wc, selector);
    if (nodeId === null) return { ok: false, note: 'element not found' };
    await this.send(wc, 'DOM.focus', { nodeId }).catch(() => null);
    // 全选后覆盖输入；纯键盘路径，不经页面 DOM API。
    const meta = process.platform === 'darwin' ? 4 : 2;
    for (const type of ['keyDown', 'keyUp'] as const) {
      await this.send(wc, 'Input.dispatchKeyEvent', {
        type,
        modifiers: meta,
        key: 'a',
        code: 'KeyA',
        windowsVirtualKeyCode: 65,
        nativeVirtualKeyCode: 65,
        ...(type === 'keyDown' ? { commands: ['selectAll'] } : {}),
      });
    }
    await this.send(wc, 'Input.insertText', { text });
    return { ok: true };
  }

  async back(viewId?: string): Promise<void> {
    const wc = this.webContents(this.resolveId(viewId));
    if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  }

  async screenshot(viewId?: string): Promise<string> {
    const wc = this.webContents(this.resolveId(viewId));
    const shot = await this.send<{ data: string }>(
      wc,
      'Page.captureScreenshot',
      { format: 'png', captureBeyondViewport: false },
    );
    const file = join(tmpdir(), `workstudio-shot-${Date.now()}.png`);
    writeFileSync(file, Buffer.from(shot.data, 'base64'));
    return file;
  }

  activeViewId(): string | null {
    return this.tabs.activeViewId();
  }

  // ─── 内部 ────────────────────────────────────────────────────

  private async pointer(
    wc: WebContents,
    type: 'mouseMoved' | 'mousePressed' | 'mouseReleased',
    x: number,
    y: number,
  ): Promise<void> {
    await this.send(wc, 'Input.dispatchMouseEvent', {
      type,
      x,
      y,
      ...(type === 'mouseMoved' ? {} : { button: 'left', clickCount: 1 }),
    });
  }

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
      const timer = setTimeout(done, ATTACH_TIMEOUT_MS);
      wc.once('did-finish-load', done);
      wc.on('did-fail-load', failed);
      wc.once('destroyed', done);
    });
  }

  /** debugger 命令：按需 attach，随 webContents 销毁回收。 */
  private async send<T>(
    wc: WebContents,
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T> {
    if (wc.isDestroyed()) throw new Error('browser tab is gone');
    if (!wc.debugger.isAttached()) {
      try {
        wc.debugger.attach('1.3');
      } catch (error) {
        throw new Error(
          `browser debugger unavailable: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return (await wc.debugger.sendCommand(method, params)) as T;
  }

  /** 注入求值：读取与快照用，只读且按需执行。 */
  private async evaluate<T>(wc: WebContents, expression: string): Promise<T> {
    const result = await this.send<{
      result: { value?: T; description?: string };
      exceptionDetails?: { text: string };
    }>(wc, 'Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'evaluate failed');
    }
    return result.result.value as T;
  }

  private async nodeId(
    wc: WebContents,
    selector: string,
  ): Promise<number | null> {
    const { root } = await this.send<{ root: NodeId }>(wc, 'DOM.getDocument', {
      depth: 1,
    });
    const { nodeId } = await this.send<NodeId>(wc, 'DOM.querySelector', {
      nodeId: root.nodeId,
      selector,
    });
    return nodeId || null;
  }
}
