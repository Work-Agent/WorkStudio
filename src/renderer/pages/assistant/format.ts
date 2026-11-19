/** 助手视图的纯格式化函数。 */
import type { SessionMeta } from '../../../shared/types.ts';

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

/** 工具调用参数的单行预览（折叠摘要行用；截断到 80 字符）。 */
export function argsPreview(args: unknown): string {
  let text: string;
  if (typeof args === 'string') {
    text = args;
  } else if (args && typeof args === 'object') {
    // 对象取前几个原始字段值，比整段 JSON 更可读
    const parts = Object.values(args as Record<string, unknown>)
      .filter((v) => typeof v === 'string' || typeof v === 'number')
      .map((v) => String(v));
    text = parts.join(' · ') || JSON.stringify(args);
  } else {
    text = args == null ? '' : String(args);
  }
  text = text.replace(/\s+/g, ' ').slice(0, 80);
  // 空参数 / 空容器没有信息量，不显示预览
  return text === '{}' || text === '[]' ? '' : text;
}

/** 结果正文的展示过滤：空白或空容器（{} / []）视为无内容。 */
export function resultBody(result: string | undefined): string {
  const text = result?.trim() ?? '';
  return text === '{}' || text === '[]' ? '' : text;
}
