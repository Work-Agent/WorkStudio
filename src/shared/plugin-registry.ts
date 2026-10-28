// ─── 可安装插件清单（PLUGINS.md） ─────────────────────────────────
//
// 清单是编译期资产：构建时由 electron.vite.config.ts 解析为静态数组
// （virtual:plugin-registry），运行期直接用数据，不再读 Markdown。
//   - [Word 文档](https://.../plugin-docx.zip#sha256=...)
//   - ./plugins/csv

export type PluginSourceType = 'zip' | 'local';

export interface PluginRegistryEntry {
  source: string;
  type: PluginSourceType;
  /** 展示名：清单链接文本优先，缺省时用插件清单 label。 */
  label?: string;
  sha256?: string;
}

export interface PluginSource extends PluginRegistryEntry {
  /** 本地来源解析后的绝对路径（相对工作区）。 */
  path?: string;
  /** 已安装插件 id。 */
  name?: string;
  version?: string;
}

const URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

/** 解析一行来源：http(s) zip 或本地路径；非法来源直接抛错。 */
export function describePluginSource(
  source: string,
  label?: string,
): PluginRegistryEntry {
  const value = source.trim();
  if (!value) throw new Error('来源为空');
  if (!URL_RE.test(value))
    return { source: value, type: 'local', ...(label ? { label } : {}) };

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`无法解析的地址：${value}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new Error(`插件来源必须是 http(s) zip 或本地路径：${value}`);
  if (!url.pathname.toLowerCase().endsWith('.zip'))
    throw new Error(`远程插件必须是 .zip：${value}`);
  const sha = /^#sha256=([a-f0-9]{64})$/i.exec(url.hash);
  if (!sha) throw new Error(`远程插件必须带 #sha256=<64位哈希>：${value}`);
  return {
    source: value,
    type: 'zip',
    sha256: sha[1]!.toLowerCase(),
    ...(label ? { label } : {}),
  };
}

/** 解析整份清单；`origin` 用于报错定位（文件 + 行号）。 */
export function parsePluginRegistry(
  markdown: string,
  origin = 'PLUGINS.md',
): PluginRegistryEntry[] {
  const entries: PluginRegistryEntry[] = [];
  const seen = new Set<string>();
  const comments = { open: false };

  markdown.split(/\r?\n/).forEach((raw, index) => {
    const line = stripComments(raw, comments);
    const item = parseRegistryLine(line);
    if (!item) return;
    try {
      const entry = describePluginSource(item.source, item.label);
      if (seen.has(entry.source)) throw new Error(`重复来源：${entry.source}`);
      seen.add(entry.source);
      entries.push(entry);
    } catch (error) {
      throw new Error(`${origin}:${index + 1}: ${reason(error)}`);
    }
  });

  return entries;
}

function parseRegistryLine(
  line: string,
): { source: string; label?: string } | null {
  const trimmed = line.trim();
  const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
  if (!bullet) return null;
  const body = bullet[1]!.trim();
  const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(body);
  if (link) return { label: link[1]!.trim(), source: link[2]!.trim() };
  if (body.startsWith('[')) throw new Error(`链接格式无效：${body}`);
  const source = body.split(/\s{2,}/)[0]!.trim();
  if (!source) throw new Error('列表项缺少来源');
  return { source };
}

/** 去掉 HTML 注释（支持跨行，构建期清单里用来写说明）。 */
function stripComments(raw: string, state: { open: boolean }): string {
  let line = raw;
  if (state.open) {
    const end = line.indexOf('-->');
    if (end < 0) return '';
    line = line.slice(end + 3);
    state.open = false;
  }
  for (;;) {
    const start = line.indexOf('<!--');
    if (start < 0) return line;
    const end = line.indexOf('-->', start + 4);
    if (end < 0) {
      state.open = true;
      return line.slice(0, start);
    }
    line = line.slice(0, start) + line.slice(end + 3);
  }
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
