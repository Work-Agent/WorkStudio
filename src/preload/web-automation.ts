/**
 * 网页提取（在网页 preload 内执行）—— 读取与快照的唯一实现。
 *
 * 与主进程无关：这里只依赖页面 DOM，提取结果是 Markdown + 可访问性结构，
 * 由自动化操作 `text` / `outline` 触发。
 */
import type {
  ElementReading,
  PageExtraction,
  PageReading,
  WebOp,
  WebOpResult,
} from '../shared/web-page.ts';

/** read：当前可见文本。 */
export function readPage(): PageReading {
  return {
    url: location.href,
    title: document.title,
    text: document.body ? document.body.innerText : '',
  };
}

/** snapshot：正文 Markdown + 可访问性结构。 */
export function extractArticle(): PageExtraction {
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

/** 主进程下发的自动化操作在页面上下文执行。 */
export function runWebOp(op: WebOp): WebOpResult {
  switch (op.kind) {
    case 'text':
      return { text: readPage() };
    case 'outline':
      return { outline: extractArticle() };
    case 'query':
      return { element: readElement(elementOf(op.selector)) };
    case 'click': {
      const el = elementOf(op.selector);
      el.scrollIntoView({ block: 'center' });
      el.click();
      return { ok: true };
    }
    case 'type': {
      const el = elementOf(op.selector) as
        | HTMLInputElement
        | HTMLTextAreaElement;
      el.scrollIntoView({ block: 'center' });
      el.focus();
      el.value = op.text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    }
    case 'scroll':
      window.scrollBy(0, op.y);
      return { ok: true };
  }
}

function elementOf(selector: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`element not found: ${selector}`);
  return el;
}

function readElement(el: HTMLElement): ElementReading {
  const attrs: Record<string, string> = {};
  for (const name of ['id', 'class', 'name', 'type', 'href', 'value', 'role']) {
    const value = el.getAttribute(name);
    if (value) attrs[name] = value.slice(0, 200);
  }
  return {
    found: true,
    text: (el.innerText || el.textContent || '').trim().slice(0, 2000),
    attrs,
  };
}
