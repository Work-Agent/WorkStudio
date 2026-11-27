/**
 * 页面地址与协议（architecture.md §9）。
 *
 * 两个 scheme 承担信任边界：`work://studio/...` 是系统页，`plugin://<id>/...`
 * 是插件页。地址只携带身份（页面名、插件 id、会话），不携带磁盘路径；
 * 具体文件由页面提供方在这里解析。
 */

/** 系统页名。 */
export type SystemPage =
  | 'shell'
  | 'assistant'
  | 'overlay'
  | 'capture'
  | 'welcome'
  | 'settings'
  | 'oauth';

/** 系统页 → URL；设置卡片作为路径段。 */
export function workUrl(page: SystemPage, card?: string): string {
  return card
    ? `work://studio/${page}/${encodeURIComponent(card)}`
    : `work://studio/${page}`;
}

/** 插件页 → URL；`content` 与 `settings` 是路径种类。 */
export function pluginUrl(
  id: string,
  kind: 'content' | 'settings',
  query: Record<string, string> = {},
): string {
  const url = new URL(`plugin://${id}/${kind}`);
  for (const [key, value] of Object.entries(query)) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

/** 解析 work://studio/<page>[/<rest...>]。 */
export function parseWorkUrl(
  value: string,
): { page: string; rest: string[] } | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'work:' || url.hostname !== 'studio') return null;
    const parts = url.pathname.split('/').filter(Boolean);
    const page = parts[0] ?? '';
    return page ? { page, rest: parts.slice(1) } : null;
  } catch {
    return null;
  }
}

/** 解析 plugin://<id>/<kind>[/<rest...>]?ref=...。 */
export function parsePluginUrl(
  value: string,
): { id: string; kind: string; rest: string[]; ref?: string } | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'plugin:') return null;
    const parts = url.pathname.split('/').filter(Boolean);
    const ref = url.searchParams.get('ref');
    return {
      id: url.hostname,
      kind: parts[0] ?? '',
      rest: parts.slice(1),
      ...(ref ? { ref } : {}),
    };
  } catch {
    return null;
  }
}
