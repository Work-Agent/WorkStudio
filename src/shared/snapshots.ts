/**
 * 网站快照的公共形状：缓存清单的条目与「域 → 页」分组。
 *
 * 主进程的资源组与渲染层的侧栏面板共用这一份分组规则，
 * 所以「文件资源树」与「网站快照」两棵树的结构始终一致。
 */

export interface SnapshotEntry {
  url: string;
  title: string;
  capturedAt: number;
  ref: string;
  icon?: string;
}

export interface SnapshotDomainGroup {
  domain: string;
  items: SnapshotEntry[];
}

export function snapshotDomain(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

/** 按域名分组；域名内按采集时间倒序（输入顺序保持稳定）。 */
export function groupSnapshots(
  entries: readonly SnapshotEntry[],
): SnapshotDomainGroup[] {
  const groups = new Map<string, SnapshotEntry[]>();
  for (const entry of entries) {
    const domain = snapshotDomain(entry.url);
    const list = groups.get(domain);
    if (list) list.push(entry);
    else groups.set(domain, [entry]);
  }
  return [...groups.entries()]
    .map(([domain, items]) => ({ domain, items }))
    .sort((a, b) => a.domain.localeCompare(b.domain));
}
