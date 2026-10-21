/**
 * BrowserAutomation —— 浏览器自动化实现（agent-design.md §3.5）。
 *
 * 基于 raw 网页视图的 webContents：DOM 操作经 executeJavaScript，截图经 capturePage。
 * 工具层只依赖 BrowserAutomationContract；未来可换 CDP 实现而工具不动。
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
    const wc = this.viewHost.getWebContents(id);
    if (!wc) throw new Error('No browser page available');
    const result = (await wc.executeJavaScript(
      `({ url: location.href, title: document.title, text: document.body ? document.body.innerText : '' })`,
    )) as { url: string; title: string; text: string };
    return {
      viewId: id,
      url: result.url,
      title: result.title,
      text: result.text,
    };
  }

  async click(
    selector: string,
    viewId?: string,
  ): Promise<{ ok: boolean; note?: string }> {
    const wc = this.viewHost.getWebContents(this.resolveId(viewId));
    if (!wc) return { ok: false, note: 'no browser page' };
    const sel = JSON.stringify(selector);
    return (await wc.executeJavaScript(
      `(() => { const el = document.querySelector(${sel}); if (!el) return { ok: false, note: 'element not found' }; el.click(); return { ok: true }; })()`,
    )) as { ok: boolean; note?: string };
  }

  async type(
    selector: string,
    text: string,
    viewId?: string,
  ): Promise<{ ok: boolean; note?: string }> {
    const wc = this.viewHost.getWebContents(this.resolveId(viewId));
    if (!wc) return { ok: false, note: 'no browser page' };
    const sel = JSON.stringify(selector);
    const value = JSON.stringify(text);
    return (await wc.executeJavaScript(
      `(() => {
        const el = document.querySelector(${sel});
        if (!el) return { ok: false, note: 'element not found' };
        if (!('value' in el)) return { ok: false, note: 'element is not an input' };
        el.focus();
        el.value = ${value};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true };
      })()`,
    )) as { ok: boolean; note?: string };
  }

  async back(viewId?: string): Promise<void> {
    const id = this.resolveId(viewId);
    this.viewHost.goBack(id);
  }

  async snapshot(viewId?: string): Promise<BrowserSnapshot> {
    const id = this.resolveId(viewId);
    const wc = this.viewHost.getWebContents(id);
    if (!wc) throw new Error('No browser page available');
    const result = (await wc.executeJavaScript(
      `(${extractMarkdown.toString()})()`,
    )) as { url: string; title: string; markdown: string };
    return { viewId: id, ...result };
  }

  async screenshot(viewId?: string): Promise<string> {
    const wc = this.viewHost.getWebContents(this.resolveId(viewId));
    if (!wc) throw new Error('No browser page available');
    const image = await wc.capturePage();
    const file = join(tmpdir(), `workstudio-shot-${Date.now()}.png`);
    writeFileSync(file, image.toPNG());
    return file;
  }

  activeViewId(): string | null {
    const active = this.viewHost.listBrowser().find((v) => v.active);
    return active?.id ?? null;
  }

  private resolveId(viewId?: string): string {
    const id = viewId ?? this.activeViewId();
    if (!id) throw new Error('No active browser tab — open a URL first');
    return id;
  }
}


/** 页面内的正文提取（序列化后在 webContents 里执行）。 */
function extractMarkdown(): {
  url: string;
  title: string;
  markdown: string;
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
    for (const child of [...el.children]) {
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
          if (text) blocks.push((tag === 'ol' ? `${index + 1}. ` : '- ') + text);
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
  return {
    url: location.href,
    title,
    markdown: ((title ? `# ${title}\n\n` : '') + body).slice(0, 200000),
  };
}
