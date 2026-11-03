/** 助手视图的消息流投影（按会话隔离）。 */
import type { ParsedMessage } from '../../shared/types';
import { useAppMessages } from './appState';

export interface MessagesView {
  messages: ParsedMessage[];
  streaming: boolean;
  optimistic: string | undefined;
  pushOptimistic: (text: string) => void;
  clearNewTask: () => void;
}

const EMPTY: MessagesView = {
  messages: [],
  streaming: false,
  optimistic: undefined,
  pushOptimistic: () => undefined,
  clearNewTask: () => undefined,
};

export function useMessages(activePath: string | null): MessagesView {
  return useAppMessages(activePath) ?? EMPTY;
}
