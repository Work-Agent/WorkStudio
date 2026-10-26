/**
 * 会话索引 / JSONL 解析（architecture.md §8）。
 *
 * 落盘由 pi SessionManager 负责；本模块只做只读解析：
 *   - 会话列表（标题 / 时间 / 预览 / token 与消息计数）
 *   - 历史消息 → ParsedMessage[]（thinking / tool / text 块，工具结果按 toolCallId 配对）
 *   - 删除文件
 */
import { existsSync, readFileSync, rmSync } from 'fs';
import type {
  ParsedBlock,
  ParsedMessage,
  SessionMeta,
} from '../../shared/types';

type JsonlEntry = Record<string, unknown>;
type JsonlMessage = Record<string, unknown>;
type ContentBlock = {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
};

function readEntries(path: string): JsonlEntry[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf-8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l) as JsonlEntry;
      } catch {
        return null;
      }
    })
    .filter((e): e is JsonlEntry => e !== null);
}

/** 解析历史消息（用户 / 助手；工具结果配对进 tool 块）。 */
export function readSessionMessages(path: string): ParsedMessage[] {
  const entries = readEntries(path);
  const toolResults = new Map<string, string>();
  for (const entry of entries) {
    if (entry.type !== 'message' || !entry.message) continue;
    const msg = entry.message as JsonlMessage;
    if (msg.role !== 'toolResult' && msg.role !== 'tool') continue;
    const content = Array.isArray(msg.content)
      ? (msg.content as ContentBlock[])
      : [];
    const text = content
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text as string)
      .join('\n');
    const toolCallId = String(msg.toolCallId ?? msg.id ?? '');
    if (text && toolCallId) toolResults.set(toolCallId, text);
  }

  const messages: ParsedMessage[] = [];
  for (const entry of entries) {
    if (entry.type !== 'message' || !entry.message) continue;
    const msg = entry.message as JsonlMessage;
    const content = Array.isArray(msg.content)
      ? (msg.content as ContentBlock[])
      : [];
    if (msg.role !== 'user' && msg.role !== 'assistant') continue;
    const blocks = extractBlocks(content, toolResults);
    if (blocks.length > 0) messages.push({ role: msg.role, blocks });
  }
  return messages;
}

function extractBlocks(
  content: ContentBlock[],
  toolResults: Map<string, string>,
): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  for (const c of content) {
    if (c.type === 'text' && typeof c.text === 'string') {
      blocks.push({ type: 'text', text: c.text });
    } else if (c.type === 'thinking' && typeof c.text === 'string') {
      blocks.push({ type: 'thinking', text: c.text });
    } else if (c.type === 'toolCall' || c.type === 'tool_use') {
      const id = String(c.id ?? '');
      blocks.push({
        type: 'tool',
        toolCallId: id,
        toolName: String(c.name ?? 'unknown'),
        args: c.input ?? {},
        result: toolResults.get(id) ?? '',
      });
    }
  }
  return blocks;
}

/** 汇总 token 统计（assistant usage 累加）。 */
export function readSessionTokens(path: string): {
  input: number;
  output: number;
} {
  const entries = readEntries(path);
  let input = 0;
  let output = 0;
  for (const entry of entries) {
    if (entry.type !== 'message' || !entry.message) continue;
    const msg = entry.message as JsonlMessage;
    if (msg.role !== 'assistant') continue;
    const usage = msg.usage as Record<string, unknown> | undefined;
    if (!usage) continue;
    input += Number(usage.input ?? 0);
    output += Number(usage.output ?? 0);
  }
  return { input, output };
}

/** 最后一条助手文本预览（截断 80 字）。 */
export function readSessionPreview(path: string): string {
  const entries = readEntries(path);
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type !== 'message' || !entry.message) continue;
    const msg = entry.message as JsonlMessage;
    if (msg.role !== 'assistant') continue;
    const content = Array.isArray(msg.content)
      ? (msg.content as ContentBlock[])
      : [];
    for (let j = content.length - 1; j >= 0; j--) {
      const c = content[j];
      if (c.type === 'text' && typeof c.text === 'string' && c.text.trim()) {
        return c.text.trim().replace(/\s+/g, ' ').slice(0, 80);
      }
    }
  }
  return '';
}

/** 会话文件 → UI 元数据。 */
export function readSessionMeta(path: string): SessionMeta {
  const entries = readEntries(path);
  let createdAt = 0;
  let name: string | undefined;
  let messageCount = 0;
  for (const entry of entries) {
    createdAt ||= Number(entry.timestamp ?? 0);
    if (entry.type === 'session_info' && typeof entry.name === 'string')
      name = entry.name;
    if (entry.type === 'message') messageCount++;
  }
  const preview = readSessionPreview(path);
  const fallback = preview
    ? `${preview.slice(0, 30)}${preview.length > 30 ? '…' : ''}`
    : '未命名会话';
  const tokens = readSessionTokens(path);
  return {
    path,
    name: name ?? fallback,
    createdAt,
    preview,
    ...(tokens.input || tokens.output ? { tokens } : {}),
    messageCount,
  };
}

export function deleteSessionFile(path: string): void {
  try {
    if (existsSync(path)) rmSync(path);
  } catch {
    /* ignore */
  }
}

/** 工具结果 → 文本（事件载荷 / 工具卡摘要）。 */
export function stringifyToolResult(result: unknown): string {
  if (result == null) return '';
  try {
    const content = (
      result as { content?: Array<{ type: string; text?: string }> }
    ).content;
    if (Array.isArray(content)) {
      return content
        .filter((c) => c.type === 'text' && typeof c.text === 'string')
        .map((c) => c.text)
        .join('\n');
    }
  } catch {
    /* fallthrough */
  }
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}
