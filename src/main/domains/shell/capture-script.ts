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
  html: string;
  text: string;
  markdown: string;
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

  return {
    url: location.href,
    title: document.title,
    html: document.documentElement?.outerHTML ?? '',
    text: document.body?.innerText ?? '',
    markdown: blocks
      .join('\n\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  };
}
