/** 助手视图的纯格式化函数。 */
import type { SessionMeta } from '../../shared/types';

export function tabLabel(sessions: SessionMeta[], path: string): string {
  const name = sessions.find((s) => s.path === path)?.name;
  if (name) return name;
  const base = path.split(/[/\\]/).pop() ?? path;
  return base.replace(/\.jsonl?$/i, '').slice(0, 24) || '会话';
}

/** token 简写（↑/↓ 状态行）。 */
export function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}
