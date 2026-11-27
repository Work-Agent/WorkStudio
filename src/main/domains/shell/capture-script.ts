/**
 * 采集脚本：在页面内把 DOM 读成 Markdown，和标题 / 地址一次取回。
 *
 * 只能在页面里运行（没有 Node、没有外部依赖），宿主用
 * `(${capturePage.toString()})()` 注入，所以函数体内不能引用任何外部变量。
 * 提取规则是保守的：跳过导航 / 页脚 / 表单，正文按块输出，
 * 行内只保留强调、代码、链接与图片。
 */
export function capturePage(): {
  url: string;
  title: string;
  excerpt: string;
  html: string;
  text: string;
  markdown: string;
  icon: string;
} {
  const SKIP = new Set([
    'SCRIPT',
    'STYLE',
    'NOSCRIPT',
    'TEMPLATE',
    'SVG',
    'CANVAS',
    'IFRAME',
    'OBJECT',
    'EMBED',
    'FORM',
    'BUTTON',
    'INPUT',
    'SELECT',
    'TEXTAREA',
    'NAV',
    'FOOTER',
    'HEADER',
    'ASIDE',
  ]);

  const squash = (value: string): string => value.replace(/\s+/g, ' ').trim();

  const absolute = (value: string | null): string => {
    if (!value) return '';
    try {
      return new URL(value, location.href).href;
    } catch {
      return '';
    }
  };

  const inline = (node: Node): string => {
    if (node.nodeType === 3) return squash(node.nodeValue ?? '');
    if (node.nodeType !== 1) return '';
    const element = node as Element;
    const tag = element.tagName;
    if (SKIP.has(tag)) return '';
    if (tag === 'BR') return '\n';
    const inner = Array.from(element.childNodes).map(inline).join(' ');
    const text = squash(inner);
    if (!text) return '';
    switch (tag) {
      case 'STRONG':
      case 'B':
        return `**${text}**`;
      case 'EM':
      case 'I':
        return `*${text}*`;
      case 'DEL':
      case 'S':
        return `~~${text}~~`;
      case 'CODE':
        return `\`${text}\``;
      case 'A': {
        const href = absolute(element.getAttribute('href'));
        return href ? `[${text}](${href})` : text;
      }
      case 'IMG': {
        const src = absolute(element.getAttribute('src'));
        if (!src) return '';
        return `![${element.getAttribute('alt') ?? ''}](${src})`;
      }
      default:
        return inner;
    }
  };

  const blocks: string[] = [];

  const BLOCK = new Set([
    'P',
    'DIV',
    'SECTION',
    'ARTICLE',
    'UL',
    'OL',
    'PRE',
    'BLOCKQUOTE',
    'TABLE',
    'FIGURE',
    'DL',
  ]);

  const listItem = (li: Element, depth: number): string[] => {
    const parts: string[] = [];
    const nested: Element[] = [];
    const inlineParts: string[] = [];
    for (const child of Array.from(li.childNodes)) {
      if (child.nodeType === 1) {
        const tag = (child as Element).tagName;
        if (tag === 'UL' || tag === 'OL') {
          nested.push(child as Element);
          continue;
        }
        if (BLOCK.has(tag)) {
          walk(child, depth + 1, parts);
          continue;
        }
      }
      const text = squash(inline(child));
      if (text) inlineParts.push(text);
    }
    if (inlineParts.length) parts.unshift(squash(inlineParts.join(' ')));
    const lines = parts.length ? parts : [''];
    const out: string[] = [];
    for (const element of nested) walk(element, depth + 1, out);
    return [...lines, ...out];
  };

  function walk(node: Node, depth: number, out: string[]): void {
    if (node.nodeType === 3) {
      const text = squash(node.nodeValue ?? '');
      if (text) out.push(text);
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as Element;
    const tag = element.tagName;
    if (SKIP.has(tag)) return;

    const heading = /^H([1-6])$/.exec(tag);
    if (heading) {
      const text = squash(inline(element));
      if (text) out.push(`${'#'.repeat(Number(heading[1]))} ${text}`);
      return;
    }
    if (tag === 'P') {
      const text = squash(inline(element));
      if (text) out.push(text);
      return;
    }
    if (tag === 'PRE') {
      const code = (element.textContent ?? '').replace(/^\n+|\s+$/g, '');
      if (code) out.push(['```', code, '```'].join('\n'));
      return;
    }
    if (tag === 'BLOCKQUOTE') {
      const inner: string[] = [];
      for (const child of Array.from(element.childNodes)) {
        walk(child, depth + 1, inner);
      }
      if (inner.length) {
        out.push(
          inner
            .join('\n\n')
            .split('\n')
            .map((line) => `> ${line}`)
            .join('\n'),
        );
      }
      return;
    }
    if (tag === 'UL' || tag === 'OL') {
      let index = 1;
      for (const item of Array.from(element.children)) {
        if (item.tagName !== 'LI') continue;
        const marker = tag === 'OL' ? `${index++}. ` : '- ';
        const lines = listItem(item, depth);
        out.push(
          lines
            .join('\n')
            .split('\n')
            .map((line, position) =>
              position === 0 ? marker + line : `  ${line}`,
            )
            .join('\n'),
        );
      }
      return;
    }
    if (tag === 'HR') {
      out.push('---');
      return;
    }
    if (tag === 'TABLE') {
      const rows: string[][] = [];
      for (const row of Array.from(element.querySelectorAll('tr'))) {
        const cells = Array.from(row.querySelectorAll('th,td')).map((cell) =>
          squash(inline(cell)).replace(/\|/g, '\\|'),
        );
        if (cells.length) rows.push(cells);
      }
      if (rows.length) {
        const width = Math.max(...rows.map((row) => row.length));
        const line = (row: string[]): string =>
          `| ${row.concat(Array(width - row.length).fill('')).join(' | ')} |`;
        out.push(
          [line(rows[0]!), `| ${Array(width).fill('---').join(' | ')} |`]
            .concat(rows.slice(1).map(line))
            .join('\n'),
        );
      }
      return;
    }
    for (const child of Array.from(element.childNodes)) {
      walk(child, depth, out);
    }
  }

  const root =
    document.querySelector('article') ??
    document.querySelector('main') ??
    document.body;
  walk(root, 0, blocks);
  const body = blocks
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const visible = (element: Element): boolean => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  // 结构索引用的选择器：id 优先，否则最多向上三代（带 class / nth-of-type）。
  const selectorOf = (element: Element): string => {
    const parts: string[] = [];
    let node: Element | null = element;
    for (let depth = 0; node && depth < 3; depth += 1) {
      if (node.id) {
        parts.unshift(`#${node.id}`);
        break;
      }
      const tag = node.tagName;
      let part = tag.toLowerCase();
      const first = node.classList.item(0);
      if (first) part += `.${first}`;
      const parent: Element | null = node.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter(
          (child: Element) => child.tagName === tag,
        );
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ');
  };

  // 可访问性结构：landmark → 标题层级 → 交互元素，只做索引，不复制正文。
  const structure: string[] = [];
  const seen = new Set<Element>();
  const push = (element: Element): void => {
    if (structure.length >= 40 || seen.has(element) || !visible(element))
      return;
    seen.add(element);
    const role = (
      element.getAttribute('role') || element.tagName.toLowerCase()
    ).trim();
    const interactive = element.matches(
      'a, button, input, select, textarea, [role="button"]',
    );
    const heading = element.querySelector('h1, h2, h3, h4, h5, h6');
    const raw =
      element.getAttribute('aria-label') ||
      element.getAttribute('alt') ||
      (/^H[1-6]$/.test(element.tagName) ? element.textContent : '') ||
      (heading ? heading.textContent : '') ||
      (interactive ? element.textContent : '') ||
      element.getAttribute('placeholder') ||
      element.getAttribute('title') ||
      '';
    const name = squash(raw).slice(0, 60);
    structure.push(`${role}  "${name}"  ${selectorOf(element)}`);
  };
  for (const element of Array.from(
    document.querySelectorAll(
      'main, nav, header, footer, aside, form, article, section[aria-label], [role]',
    ),
  )) {
    push(element);
  }
  for (const element of Array.from(
    document.querySelectorAll('h1, h2, h3, h4, h5, h6'),
  )) {
    push(element);
  }
  for (const element of Array.from(
    document.querySelectorAll(
      'a[href], button, input, select, textarea, [role="button"]',
    ),
  )) {
    push(element);
  }

  const withStructure = structure.length
    ? `${body}\n\n## 可访问性结构\n\n\`\`\`text\n${structure.join('\n')}\n\`\`\``
    : body;

  // 概述：页面声明的 description 优先，否则取正文第一段。
  const described =
    document
      .querySelector('meta[name="description"]')
      ?.getAttribute('content') ||
    document
      .querySelector('meta[property="og:description"]')
      ?.getAttribute('content') ||
    body
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line && !/^(#|```|>|[-*+]\s|\d+[.)]\s)/.test(line)) ||
    '';
  const excerpt = squash(described).slice(0, 160);

  // 站点图标：页面声明的 icon 优先，缺省回落到站点根 favicon。
  const iconOf = (): string => {
    const link = document.querySelector(
      'link[rel~="icon"], link[rel="apple-touch-icon"]',
    );
    const href = link?.getAttribute('href');
    try {
      if (href) return new URL(href, location.href).href;
      return new URL('/favicon.ico', location.href).href;
    } catch {
      return '';
    }
  };

  return {
    url: location.href,
    title: document.title,
    excerpt,
    html: document.documentElement?.outerHTML ?? '',
    text: document.body?.innerText ?? '',
    markdown: withStructure,
    icon: iconOf(),
  };
}
