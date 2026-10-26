/**
 * BrowserAutomation —— 浏览器自动化（README.md §5.2）。
 *
 * 操作走 `webContents.debugger`（CDP：Input / DOM / Page.captureScreenshot）；
 * 提取（Readability 正文 + 可访问性结构）走注入求值，都是浏览器能力的内置模块。
 * 工具层只依赖 BrowserAutomationContract，换实现不动侧车。
 */
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type {
  BrowserAutomationContract,
  BrowserPageState,
  BrowserSnapshot,
} from '../../harness/browser-contract';
import type { ViewHost } from '../webview/host';

interface BoxModel {
  model: { content: number[] };
}

interface QueryResult {
  nodeId: number;
}

export class BrowserAutomation implements BrowserAutomationContract {
  constructor(private readonly viewHost: ViewHost) {}

  async open(url: string): Promise<{ viewId: string; url: string }> {
    if (!/^https?:\/\//i.test(url) && !/^file:\/\//i.test(url)) {
      throw new Error(`Unsupported URL scheme (http/https only): ${url}`);
    }
    const { id } = this.viewHost.open({ type: 'browser', url });
    await this.viewHost.waitForLoad(id);
    const wc = this.viewHost.getWebContents(id);
    return { viewId: id, url: wc?.getURL() ?? url };
  }

  async read(viewId?: string): Promise<BrowserPageState> {
    const id = this.resolveId(viewId);
    const wc = this.webContents(id);
    const result = await this.evaluate<{
      url: string;
      title: string;
      text: string;
    }>(
      wc,
      `({ url: location.href, title: document.title, text: document.body ? document.body.innerText : '' })`,
    );
    return { viewId: id, ...result };
  }

  async click(
    selector: string,
    viewId?: string,
  ): Promise<{ ok: boolean; note?: string }> {
    const wc = this.webContents(this.resolveId(viewId));
    const nodeId = await this.nodeId(wc, selector);
    if (nodeId === null) return { ok: false, note: 'element not found' };
    const box = await this.send<BoxModel>(wc, 'DOM.getBoxModel', {
      nodeId,
    }).catch(() => null);
    const quad = box?.model.content;
    if (!quad || quad.length < 8) {
      return { ok: false, note: 'element has no layout box' };
    }
    const x = (quad[0]! + quad[2]! + quad[4]! + quad[6]!) / 4;
    const y = (quad[1]! + quad[3]! + quad[5]! + quad[7]!) / 4;
    await this.send(wc, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y,
    });
    await this.send(wc, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
    await this.send(wc, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
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
    await this.send(wc, 'DOM.focus', { nodeId });
    // 全选后覆盖输入；纯键盘路径，不经页面 DOM API。
    await this.send(wc, 'Input.dispatchKeyEvent', {
      type: 'keyDown',
      modifiers: 2,
      key: 'a',
      code: 'KeyA',
      windowsVirtualKeyCode: 65,
      nativeVirtualKeyCode: 65,
      commands: ['selectAll'],
    });
    await this.send(wc, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      modifiers: 2,
      key: 'a',
      code: 'KeyA',
      windowsVirtualKeyCode: 65,
      nativeVirtualKeyCode: 65,
    });
    await this.send(wc, 'Input.insertText', { text });
    return { ok: true };
  }

  async back(viewId?: string): Promise<void> {
    this.viewHost.goBack(this.resolveId(viewId));
  }

  async snapshot(viewId?: string): Promise<BrowserSnapshot> {
    const id = this.resolveId(viewId);
    const wc = this.webContents(id);
    const result = await this.evaluate<{
      url: string;
      title: string;
      excerpt: string;
      markdown: string;
      a11y: string[];
    }>(wc, `(${extractArticle.toString()})()`);
    return { viewId: id, ...result };
  }

  async screenshot(viewId?: string): Promise<string> {
    const wc = this.webContents(this.resolveId(viewId));
    const shot = await this.send<{ data: string }>(
      wc,
      'Page.captureScreenshot',
      { format: 'png' },
    );
    const file = join(tmpdir(), `workstudio-shot-${Date.now()}.png`);
    writeFileSync(file, Buffer.from(shot.data, 'base64'));
    return file;
  }

  activeViewId(): string | null {
    const active = this.viewHost.listBrowser().find((v) => v.active);
    return active?.id ?? null;
  }

  // ─── 内部 ────────────────────────────────────────────────────

  private resolveId(viewId?: string): string {
    const id = viewId ?? this.activeViewId();
    if (!id) throw new Error('No active browser tab — open a URL first');
    return id;
  }

  private webContents(id: string): Electron.WebContents {
    const wc = this.viewHost.getWebContents(id);
    if (!wc) throw new Error('No browser page available');
    return wc;
  }

  /** CDP 命令：按需 attach，随 webContents 销毁回收。 */
  private async send<T>(
    wc: Electron.WebContents,
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T> {
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
    return (await wc.debugger.sendCommand(method, params)) as T;
  }

  /** 注入求值：提取与读取用，只读且按需执行。 */
  private async evaluate<T>(
    wc: Electron.WebContents,
    expression: string,
  ): Promise<T> {
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
    wc: Electron.WebContents,
    selector: string,
  ): Promise<number | null> {
    const { root } = await this.send<{ root: QueryResult }>(
      wc,
      'DOM.getDocument',
      {
        depth: 1,
      },
    );
    const { nodeId } = await this.send<QueryResult>(wc, 'DOM.querySelector', {
      nodeId: root.nodeId,
      selector,
    });
    return nodeId || null;
  }
}

/** 页面内的提取：Readability 正文 + 可访问性结构（序列化后求值）。 */
function extractArticle(): {
  url: string;
  title: string;
  excerpt: string;
  markdown: string;
  a11y: string[];
} {
  const pick =
    document.querySelector('article, main, [role="main"]') || document.body;
  const clone = pick.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll(
      'script,style,noscript,iframe,form,nav,header,footer,aside,svg,button,input,select,textarea',
    )
    .forEach((el) => el.remove());
  const abs = (href: string): string => {
    try {
      return new URL(href, location.href).href;
    } catch {
      return href;
    }
  };
  const inline = (node: Node): string => {
    if (node.nodeType === 3) {
      return (node.nodeValue || '').replace(/\s+/g, ' ');
    }
    if (node.nodeType !== 1) return '';
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (tag === 'br') return '\n';
    if (tag === 'a') {
      const text = inlineChildren(el).trim();
      const href = abs(el.getAttribute('href') || '');
      return text && href ? `[${text}](${href})` : text;
    }
    if (tag === 'code') {
      const text = (el.textContent || '').trim();
      return text ? `\`${text}\`` : '';
    }
    if (tag === 'strong' || tag === 'b') {
      const text = inlineChildren(el).trim();
      return text ? `**${text}**` : '';
    }
    if (tag === 'em' || tag === 'i') {
      const text = inlineChildren(el).trim();
      return text ? `*${text}*` : '';
    }
    if (tag === 'img') {
      const alt = el.getAttribute('alt') || '';
      const src = abs(el.getAttribute('src') || '');
      return src ? `![${alt}](${src})` : '';
    }
    return inlineChildren(el);
  };
  const inlineChildren = (el: Element): string =>
    [...el.childNodes].map(inline).join('');
  const isBlock = (el: Element): boolean =>
    /^(p|div|section|article|main|ul|ol|table|pre|blockquote|h[1-6])$/.test(
      el.tagName.toLowerCase(),
    );
  const blocks: string[] = [];
  const walk = (el: Element): void => {
    for (const child of Array.from(el.children)) {
      const tag = child.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) {
        const text = inlineChildren(child).trim();
        if (text) blocks.push(`${'#'.repeat(Number(tag[1]))} ${text}`);
      } else if (tag === 'pre') {
        const text = (child as HTMLElement).innerText.trim();
        if (text) blocks.push('```\n' + text + '\n```');
      } else if (tag === 'blockquote') {
        const text = inlineChildren(child).trim();
        if (text) blocks.push('> ' + text.replace(/\n/g, '> '));
      } else if (tag === 'ul' || tag === 'ol') {
        [...child.children].forEach((li, index) => {
          if (li.tagName.toLowerCase() !== 'li') return;
          const text = inlineChildren(li).trim();
          if (text)
            blocks.push((tag === 'ol' ? `${index + 1}. ` : '- ') + text);
        });
      } else if (tag === 'table') {
        const rows = [...child.querySelectorAll('tr')]
          .map((tr) =>
            [...tr.children]
              .map((cell) => inlineChildren(cell).trim())
              .join(' | '),
          )
          .filter(Boolean);
        if (rows.length) blocks.push(rows.join('\n'));
      } else if (tag === 'p') {
        const text = inlineChildren(child).trim();
        if (text) blocks.push(text);
      } else if (
        tag === 'div' ||
        tag === 'section' ||
        tag === 'article' ||
        tag === 'main'
      ) {
        if ([...child.children].some(isBlock)) walk(child);
        else {
          const text = inlineChildren(child).trim();
          if (text) blocks.push(text);
        }
      }
    }
  };
  walk(clone);
  const body = blocks.filter(Boolean).join('\n\n');
  const title = document.title.trim();
  const meta = document.querySelector('meta[name="description"]');
  const firstParagraph = blocks.find((block) => !block.startsWith('#'));
  const excerpt = (meta?.getAttribute('content') || firstParagraph || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280);

  // 可访问性结构：landmark / 标题 / 交互元素（role · name · selector）。
  const selectorOf = (el: Element): string => {
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node !== document.documentElement) {
      const tag = node.tagName.toLowerCase();
      const id = node.getAttribute('id');
      if (id) {
        parts.unshift(`#${id}`);
        break;
      }
      const siblings = node.parentElement
        ? Array.from(node.parentElement.children).filter(
            (item) => item.tagName === node!.tagName,
          )
        : [];
      const index = siblings.indexOf(node) + 1;
      parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${index})` : tag);
      node = node.parentElement;
    }
    return parts.join(' > ');
  };
  const roleOf = (el: Element): string => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) return `heading${tag[1]}`;
    if (tag === 'a') return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'input') return el.getAttribute('type') || 'textbox';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'table') return 'table';
    if (tag === 'nav') return 'navigation';
    if (tag === 'main' || tag === 'article') return 'main';
    if (tag === 'aside') return 'complementary';
    if (tag === 'header') return 'banner';
    if (tag === 'footer') return 'contentinfo';
    return tag;
  };
  const nameOf = (el: Element): string =>
    (
      el.getAttribute('aria-label') ||
      (el as HTMLElement).innerText ||
      el.getAttribute('title') ||
      el.getAttribute('alt') ||
      el.getAttribute('placeholder') ||
      ''
    )
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
  const interactive = 'a,button,input,select,textarea,[role],[tabindex]';
  const structural =
    'main,article,nav,aside,header,footer,section,h1,h2,h3,h4,h5,h6,table,form,ul,ol';
  const seen = new Set<Element>();
  const a11y: string[] = [];
  for (const el of [
    ...document.querySelectorAll(structural),
    ...document.querySelectorAll(interactive),
  ]) {
    if (seen.has(el)) continue;
    seen.add(el);
    const role = roleOf(el);
    const name = nameOf(el);
    if (
      !name &&
      !/^h[1-6]$|navigation|main|banner|contentinfo|table/.test(role)
    ) {
      continue;
    }
    a11y.push(
      `${role.padEnd(12)} ${JSON.stringify(name || '')} ${selectorOf(el)}`,
    );
    if (a11y.length >= 200) break;
  }

  return {
    url: location.href,
    title,
    excerpt,
    markdown: ((title ? `# ${title}\n\n` : '') + body).slice(0, 200000),
    a11y,
  };
}
