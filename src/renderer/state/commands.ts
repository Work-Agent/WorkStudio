/**
 * Slash 命令域 store（zustand）—— 命令目录（builtin + pi 扩展）与宿主拦截执行。
 *
 *  目录：builtin = pi 官方 slash 语言的 GUI 语境子集；pi 扩展命令经 get_commands 合流。
 *  拦截：提交时按文本前缀判定——命中即地执行（UI 浮层 / pi:cmd 命令），
 *        未命中返回 false 交回 prompt 通道透传。
 *  浮层事件：DOM 事件（组件 chunk 热替换时分裂，DOM 事件天然跨实例广播）。
 */
import { create } from 'zustand';
import { piAPI } from '../api/bridge';
import { useConversationStore } from './conversation';
import { EMPTY_MESSAGES } from './message';

export interface CommandInfo {
  name: string;
  description?: string;
}

/** builtin 目录：宿主已接通的 GUI 语境命令。 */
export const BUILTIN_COMMANDS: CommandInfo[] = [
  { name: 'new', description: '新建会话' },
  { name: 'compact', description: '压缩会话上下文（可附指示）' },
  { name: 'model', description: '切换模型（打开选择器）' },
  { name: 'thinking', description: '思考档位（打开切换器）' },
  { name: 'name', description: '命名当前会话（/name 标题）' },
  { name: 'session', description: '会话统计（面板）' },
  { name: 'copy', description: '复制上一条助手消息' },
];

export const OPEN_MODEL_SWITCHER_EVT = 'wa:open-model-switcher';
export const OPEN_THINKING_SWITCHER_EVT = 'wa:open-thinking-switcher';
export const OPEN_SESSION_INFO_EVT = 'wa:open-session-info';

interface CommandsState {
  catalog: CommandInfo[];
  load: () => void;
}

export const useCommandStore = create<CommandsState>()((set) => ({
  catalog: [],

  /** 目录装载（输入区挂载时调一次；扩展命令与 builtin 运行时合流）。 */
  load: () => {
    void piAPI.cmd
      .invoke<{ commands: CommandInfo[] }>('get_commands')
      .then((r) => {
        if (r.ok) set({ catalog: r.data.commands });
      })
      .catch(() => {
        /* 目录缺失不阻断输入（builtin 仍在） */
      });
  },
}));

/** 目录匹配（首 token 前缀；补全展示上限 8）。 */
export function matchCommands(frag: string): CommandInfo[] {
  return [...BUILTIN_COMMANDS, ...useCommandStore.getState().catalog]
    .filter((c) => c.name.startsWith(frag))
    .slice(0, 8);
}

/** 最近一条助手文本（/copy 源）。 */
function lastAssistantText(): string | null {
  const conversation = useConversationStore.getState();
  const msgs =
    conversation.messagesBySession[conversation.currentKey()] ?? EMPTY_MESSAGES;
  const last = [...msgs].reverse().find((m) => m.role === 'assistant');
  return (
    (last?.blocks ?? [])
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('\n') || null
  );
}

export const commandStore = {
  /** 目录装载。 */
  load: (): void => useCommandStore.getState().load(),

  /** 宿主本地命令拦截：true = 已消费不进 prompt 通道。 */
  intercept(full: string): boolean {
    const sp = full.indexOf(' ');
    const cmd = sp === -1 ? full.slice(1) : full.slice(1, sp);
    const arg = sp === -1 ? '' : full.slice(sp + 1).trim();
    switch (cmd) {
      case 'new':
        void piAPI.cmd.invoke('new_session', {});
        return true;
      case 'compact':
        void piAPI.cmd.invoke(
          'compact',
          arg ? { customInstructions: arg } : {},
        );
        return true;
      case 'model':
        document.dispatchEvent(new CustomEvent(OPEN_MODEL_SWITCHER_EVT));
        return true;
      case 'thinking':
        document.dispatchEvent(new CustomEvent(OPEN_THINKING_SWITCHER_EVT));
        return true;
      case 'name': {
        if (!arg) return false; // 无参不拦截（透传保持一致）
        const path = useConversationStore.getState().piSessionFile;
        if (path) void piAPI.cmd.invoke('rename_session', { path, name: arg });
        return true;
      }
      case 'session':
        document.dispatchEvent(new CustomEvent(OPEN_SESSION_INFO_EVT));
        return true;
      case 'copy': {
        const txt = lastAssistantText();
        if (txt) void navigator.clipboard.writeText(txt);
        return true;
      }
      default:
        return false;
    }
  },
};
