/**
 * 助手消息流的 Markdown 渲染器（与 markdown-viewer 插件同一套安全策略：
 * 先转义再生成标签，原始 HTML 不直通）。支持标题 / 列表 / 任务列表 / 表格 /
 * 引用 / 围栏代码 / 行内代码 / 链接 / 图片 / 强调。返回 HTML 字符串，
 * 由调用方以 dangerouslySetInnerHTML 挂载。
 */

const esc = (s: string): string =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c] ?? c,
  );

// ── 行内语法（代码 span 先摘出，避免内部记号被再次替换） ──

const CODE_MARK = '\u0000';

function inline(text: string): string {
  const codes: string[] = [];
  let t = text.replace(/`([^`]+)`/g, (_m, c: string) => {
    codes.push(c);
    return CODE_MARK + (codes.length - 1) + CODE_MARK;
  });
  t = esc(t);
  // 图片 → 链接（图片必须先处理，避免被链接规则吞掉）
  t = t.replace(/!\[([^\]]*)\]\(([^\s)]+)\)/g, '<img alt="$1" src="$2">');
  t = t.replace(
    /\[([^\]]+)\]\(([^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noreferrer">$1</a>',
  );
  t = t.replace(
    /(^|[\s(])(https?:\/\/[^\s<)]+)/g,
    '$1<a href="$2" target="_blank" rel="noreferrer">$2</a>',
  );
  t = t
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/(^|[\s(])_([^_]+)_(?=[\s.,;:)!?]|$)/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');
  t = t.replace(
    new RegExp(CODE_MARK + '(\\d+)' + CODE_MARK, 'g'),
    (_m, i: string) => '<code>' + esc(codes[Number(i)] ?? '') + '</code>',
  );
  return t;
}

// ── 块级语法 ──────────────────────────────────────────────

const BLOCK_START =
  /^(\s*$|\s*```|\s*~~~|\s*#{1,6}\s|\s*>|\s*([-*+]|\d+[.)])\s+| {0,3}(-{3,}|\*{3,}|_{3,})\s*$|\s*\|)/;

function renderBlocks(src: string): string {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    // 围栏代码
    const fence = /^(\s*)(`{3,}|~{3,})\s*([^\s`]*)\s*$/.exec(line);
    if (fence) {
      const indent = fence[1]!;
      const fenceChar = fence[2]![0]!;
      const minLen = fence[2]!.length;
      const lang = fence[3] ?? '';
      const buf: string[] = [];
      i++;
      while (i < lines.length) {
        if (
          new RegExp('^\\s*' + fenceChar + '{' + minLen + ',}\\s*$').test(
            lines[i]!,
          )
        ) {
          i++;
          break;
        }
        buf.push(
          lines[i]!.startsWith(indent)
            ? lines[i]!.slice(indent.length)
            : lines[i]!,
        );
        i++;
      }
      out.push(
        '<pre><code' +
          (lang ? ' class="language-' + esc(lang) + '"' : '') +
          '>' +
          esc(buf.join('\n')) +
          '</code></pre>',
      );
      continue;
    }

    // 标题
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      out.push(
        '<h' + level + '>' + inline(heading[2] ?? '') + '</h' + level + '>',
      );
      i++;
      continue;
    }

    // 分隔线
    if (/^ {0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    // 表格（下一行为分隔行）
    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1]!) &&
      lines[i + 1]!.includes('-')
    ) {
      const [table, next] = renderTable(lines, i);
      out.push(table);
      i = next;
      continue;
    }

    // 引用
    if (/^\s*>/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!)) {
        buf.push(lines[i]!.replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push('<blockquote>' + renderBlocks(buf.join('\n')) + '</blockquote>');
      continue;
    }

    // 列表
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const [list, next] = renderList(lines, i);
      out.push(list);
      i = next;
      continue;
    }

    // 段落
    const para = [line];
    i++;
    while (i < lines.length && !BLOCK_START.test(lines[i]!)) {
      para.push(lines[i]!);
      i++;
    }
    out.push('<p>' + inline(para.join('\n')) + '</p>');
  }
  return out.join('\n');
}

function splitRow(row: string): string[] {
  return row
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((s) => s.trim());
}

function renderTable(lines: string[], start: number): [string, number] {
  const head = splitRow(lines[start]!);
  const align = splitRow(lines[start + 1]!).map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return '';
  });
  let i = start + 2;
  const rows: string[][] = [];
  while (
    i < lines.length &&
    lines[i]!.includes('|') &&
    !/^\s*$/.test(lines[i]!)
  ) {
    rows.push(splitRow(lines[i]!));
    i++;
  }
  const styleOf = (idx: number): string =>
    align[idx] ? ' style="text-align:' + align[idx] + '"' : '';
  let html = '<table><thead><tr>';
  head.forEach((cell, idx) => {
    html += '<th' + styleOf(idx) + '>' + inline(cell) + '</th>';
  });
  html += '</tr></thead><tbody>';
  for (const row of rows) {
    html += '<tr>';
    for (let c = 0; c < head.length; c++) {
      html += '<td' + styleOf(c) + '>' + inline(row[c] ?? '') + '</td>';
    }
    html += '</tr>';
  }
  return [html + '</tbody></table>', i];
}

const ITEM_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

function renderList(lines: string[], start: number): [string, number] {
  const first = ITEM_RE.exec(lines[start]!)!;
  const ordered = /\d/.test(first[2]!);
  const baseIndent = first[1]!.length;
  const items: string[] = [];
  let i = start;
  while (i < lines.length) {
    const m = ITEM_RE.exec(lines[i]!);
    if (!m || m[1]!.length !== baseIndent) break;
    const markerWidth = m[2]!.length + 1;
    const buf: string[] = [m[3]!];
    i++;
    // 收集该项的续行（含嵌套列表；按 marker 宽度去缩进）
    while (i < lines.length) {
      const l = lines[i]!;
      if (/^\s*$/.test(l)) {
        if (i + 1 < lines.length && /^\s{2,}/.test(lines[i + 1]!)) {
          buf.push('');
          i++;
          continue;
        }
        break;
      }
      const im = ITEM_RE.exec(l);
      if (im && im[1]!.length <= baseIndent) break;
      const indent = /^\s*/.exec(l)![0].length;
      if (indent <= baseIndent) break;
      buf.push(l.slice(Math.min(indent, baseIndent + markerWidth)));
      i++;
    }
    items.push(renderItem(buf.join('\n')));
  }
  const tag = ordered ? 'ol' : 'ul';
  return ['<' + tag + '>' + items.join('') + '</' + tag + '>', i];
}

function renderItem(src: string): string {
  let inner = renderBlocks(src);
  // 任务列表
  const task = /^\[([ xX])\]\s?(.*)$/.exec(src.trimStart().split('\n')[0]!);
  if (task) {
    const checked = task[1]!.toLowerCase() === 'x';
    inner = inner.replace(
      /<p>\[[ xX]\]\s?/,
      '<p><input type="checkbox" disabled' + (checked ? ' checked' : '') + '>',
    );
  }
  // 单段落解包（列表项内的 <p> 视觉冗余）
  const single = /^<p>([\s\S]*)<\/p>$/.exec(inner);
  if (single && !single[1]!.includes('<p>')) inner = single[1]!;
  return '<li>' + inner + '</li>';
}

/** Markdown → 安全 HTML（原始 HTML 不直通，标签只由渲染器生成）。 */
export function renderMarkdown(src: string): string {
  return renderBlocks(src || '');
}
