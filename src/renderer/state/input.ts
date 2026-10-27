/**
 * 输入域 store（zustand）—— AssistantInput 的单一事实源（草稿 / slash 补全 / 提交路由）。
 *
 *  单一文本（无命令槽 / 无前缀）：提交时按文本形态路由——
 *    `/xxx` 开头  → commandStore.intercept（builtin 即地执行）；未识别透传 prompt 通道
 *    执行中       → 入队（Enter=steer；⇧⌘Enter=followUp）
 *    其余         → 发送（新任务态首条消息由主进程建会话）
 *
 *  状态归属：草稿跨组件投影（输入区 / 编辑器镜像 / 主进程扩展写回），面板关闭重开不丢。
 */
import { create } from 'zustand';
import { useAppStore } from './app';
import { commandStore, matchCommands } from './commands';
import { useConversationStore } from './conversation';
import { useUiStore } from './uiState';

/** Enter 提交修饰（快捷键路径）：enter=默认 / steer=⌘Enter / followUp=⇧⌘Enter。 */
export type SubmitModifier = 'enter' | 'steer' | 'followUp';

/** 补全候选（slash 目录过滤产物）。 */
export interface CompletionItem {
  label: string;
  hint?: string;
  name: string;
}

interface InputState {
  text: string;
  completionOpen: boolean;
  acIdx: number;
  acItems: CompletionItem[];
  setText: (raw: string) => void;
  appendToken: (token: string) => void;
  setFromMain: (incoming: string, paste?: boolean) => void;
  insertSlash: () => void;
  applyCompletion: (name: string) => void;
  closeCompletions: () => void;
  moveCompletion: (delta: -1 | 1) => void;
  highlightCompletion: (index: number) => void;
  submit: (modifier: SubmitModifier) => void;
}

/** 补全候选计算（打开态 + 首 token 过滤：`/` 开头、命令名输入中、无换行）。 */
function computeAcItems(
  text: string,
  completionOpen: boolean,
): CompletionItem[] {
  if (!completionOpen) return [];
  if (!text.startsWith('/') || text.includes('\n')) return [];
  const frag = text.slice(1).split(' ')[0] ?? '';
  if (frag !== text.slice(1)) return []; // 已进参数位（首 token 结束）
  return matchCommands(frag).map((c) => ({
    label: '/' + c.name,
    hint: c.description,
    name: c.name,
  }));
}

const EMPTY_AC: CompletionItem[] = [];

export const useInputStore = create<InputState>()((set, get) => ({
  text: '',
  completionOpen: false,
  acIdx: 0,
  acItems: EMPTY_AC,

  /** 草稿写入（唯一入口：补全开合 + 镜像同步都挂在这里）。 */
  setText: (raw) => {
    const completionOpen = raw.startsWith('/') && !raw.includes('\n');
    set({
      text: raw,
      completionOpen,
      acIdx: 0,
      acItems: computeAcItems(raw, completionOpen),
    });
  },

  /** 追加片段（浏览器 ref 标签回填 @ref）。 */
  appendToken: (token) => {
    const text = get().text;
    get().setText(text ? text + token : token);
  },

  /** 主进程侧写输入（扩展 setEditorText/pasteToEditor 回灌）。 */
  setFromMain: (incoming, paste) => {
    const text = get().text;
    get().setText(paste && text ? text + incoming : incoming);
  },

  /** 工具栏 slash：插入 /（空文本→/；句尾空格→追加；其余不动）。 */
  insertSlash: () => {
    const v = get().text;
    get().setText(v === '' ? '/' : v.endsWith(' ') ? v + '/' : v);
  },

  /** 补全确认：命令名（含尾空格）落到文本，交回键盘继续输入参数。 */
  applyCompletion: (name) => {
    set({
      text: '/' + name + ' ',
      completionOpen: false,
      acIdx: 0,
      acItems: EMPTY_AC,
    });
  },

  /** 关闭补全（Esc / 选中后）——文本保留（再输入字符可重开）。 */
  closeCompletions: () => set({ completionOpen: false, acItems: EMPTY_AC }),

  /** 补全高亮移动（↑↓；夹取到候选边界）。 */
  moveCompletion: (delta) => {
    const n = get().acItems.length;
    if (n === 0) return;
    set({ acIdx: Math.min(Math.max(get().acIdx + delta, 0), n - 1) });
  },

  /** 补全高亮定位（鼠标 hover 跟随）。 */
  highlightCompletion: (index) => set({ acIdx: index }),

  /**
   * 提交（Enter / ⌘Enter / ⇧⌘Enter）：求值 → 清空复位 → 派发。
   * slash：宿主拦截优先，未识别透传 prompt 通道。
   */
  submit: (modifier) => {
    const full = get().text.trim();
    if (!full || !useAppStore.getState().status.configured) return;
    // 先求值再清空（同步；镜像立即推空——提交即推语义）
    set({ text: '', completionOpen: false, acIdx: 0, acItems: EMPTY_AC });

    const conversation = useConversationStore.getState();
    if (full.startsWith('/')) {
      if (!commandStore.intercept(full))
        void conversation.send(full, undefined, true);
      return;
    }
    if (conversation.streaming()) {
      void conversation.queueSend(
        modifier === 'followUp' ? 'followUp' : 'steer',
        full,
      );
      return;
    }
    void conversation.send(full, useUiStore.getState().selectedSkills, false);
  },
}));
