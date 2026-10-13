import type { ParsedBlock, ParsedMessage } from '../../shared/types';

/** 工具调用状态（渲染层独有，比 ParsedMessage 多 'running'/'error'）。 */
export interface ToolCall {
  toolCallId: string;
  toolName: string;
  args: unknown;
  status: 'running' | 'done' | 'error';
  result?: string;
}

/** 渲染层内容块（有序，按事件到达顺序排列）。 */
export type ContentBlock =
  | { type: 'thinking'; text: string }
  | { type: 'tool'; toolCall: ToolCall }
  | { type: 'text'; text: string };

/** 聊天消息（渲染层内部状态，比 ParsedMessage 多 id/streaming/error）。 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  blocks: ContentBlock[];
  streaming?: boolean;
  error?: string;
}

let idCounter = 0;
export const uid = (): string => `m${++idCounter}-${Date.now()}`;

/** 空消息流常量（selector 缺省值，保持引用稳定避免重渲染循环）。 */
export const EMPTY_MESSAGES: ChatMessage[] = [];

/** 格式化工具调用参数为可读字符串。 */
export function formatArgs(args: unknown): string {
  if (args == null) return '';
  if (typeof args === 'string') return args;
  try {
    const obj = args as Record<string, unknown>;
    return Object.entries(obj)
      .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(', ');
  } catch {
    return JSON.stringify(args);
  }
}

/** 将主进程返回的 ParsedMessage[] 转换为渲染层 ChatMessage[]。 */
export function parseParsedMessages(messages: ParsedMessage[]): ChatMessage[] {
  return messages.map((m) => ({
    id: uid(),
    role: m.role,
    blocks: m.blocks.map((b: ParsedBlock): ContentBlock => {
      if (b.type === 'tool') {
        return {
          type: 'tool',
          toolCall: {
            toolCallId: b.toolCallId,
            toolName: b.toolName,
            args: b.args,
            status: 'done' as const,
            result: b.result,
          },
        };
      }
      return b;
    }),
  }));
}
