/**
 * 页面侧脚本：在 web tab 内执行，只读页面。
 *
 * 读取与快照都走注入求值，不经页面 DOM API 之外的通道；
 * 提取结果是 Markdown + 可访问性结构，供侧车与站点快照使用。
 */

export interface PageReading {
  url: string;
  title: string;
  text: string;
}

export interface PageExtraction {
  url: string;
  title: string;
  excerpt: string;
  markdown: string;
  a11y: string[];
}

/** read：当前可见文本。 */
export function readScript(): string {
  return `({
    url: location.href,
    title: document.title,
    text: document.body ? document.body.innerText : '',
  })`;
}

/** snapshot：正文 Markdown + 可访问性结构。 */
export function snapshotScript(): string {
  return `(${extractArticle.toString()})()`;
}

/** 页面内的提取函数（序列化后注入）。 */
function extractArticle(): PageExtraction {
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
