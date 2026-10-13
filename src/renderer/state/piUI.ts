/**
 * piUI store（zustand）—— 扩展 UI 上下文的渲染层投影。
 *
 * 消费 pi:ui-request 全流：
 *   对话框族（select/confirm/input/editor）→ pendingDialog（DialogHost 渲染）
 *   状态族（notify/status/working/widgets/title/editorText）→ 各字段
 *
 * 编辑器镜像（D7）：AssistantInput 防抖推送 → piBridge.pushEditorState。
 */
import { create } from 'zustand';
import { piAPI } from '../api/bridge';

export interface PiDialog {
  kind: 'select' | 'confirm' | 'input' | 'editor';
  id: string;
  title: string;
  options?: string[];
  message?: string;
  placeholder?: string;
  prefill?: string;
}

export interface PiToast {
  id: number;
  message: string;
  level: 'info' | 'warning' | 'error';
}

interface PiUIState {
  pendingDialog: PiDialog | null;
  toasts: PiToast[];
  statusSlots: Record<string, string | undefined>;
  widgets: Record<string, string[] | undefined>;
  workingMessage: string | undefined;
  /** 主进程侧写输入（扩展 setEditorText/pasteToEditor 回灌）。 */
  editorTextFromMain: { text: string; paste?: boolean; seq: number } | null;
  pushToast: (message: string, level?: PiToast['level']) => void;
  respond: (resp: {
    id: string;
    ok: boolean;
    value?: unknown;
    reason?: string;
  }) => void;
  cancel: () => void;
  handleRequest: (req: Record<string, unknown>) => void;
  restoreSnapshot: (
    ui: {
      widgets?: Array<{ key: string; lines?: string[] }>;
      status?: Array<{ key: string; text?: string }>;
    } | null,
  ) => void;
  pushEditorMirror: (text: string, immediate?: boolean) => void;
}

let localToastSeq = 0;
let toastSeq = 0;
let editorPushTimer: ReturnType<typeof setTimeout> | null = null;

export const usePiUIStore = create<PiUIState>()((set, get) => ({
  pendingDialog: null,
  toasts: [],
  statusSlots: {},
  widgets: {},
  workingMessage: undefined,
  editorTextFromMain: null,

  /** 渲染层本地 toast（4s 自动消失；与 pi notify 事件同管线）。 */
  pushToast: (message, level = 'info') => {
    const toast: PiToast = { id: 1_000_000 + ++localToastSeq, message, level };
    set((s) => ({ toasts: [...s.toasts, toast] }));
    setTimeout(
      () => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== toast.id) })),
      4000,
    );
  },

  /** 对话框应答（DialogHost 提交时调用；结构化回传）。 */
  respond: (resp) => {
    if (get().pendingDialog?.id === resp.id) set({ pendingDialog: null });
    void piAPI.uiRespond(resp);
  },

  /** 取消当前对话框（Esc/遮罩点击）。 */
  cancel: () => {
    const dialog = get().pendingDialog;
    if (dialog)
      get().respond({ id: dialog.id, ok: false, reason: 'cancelled' });
  },

  /** 消费 main 侧 UI 请求（bindPiUIRequests 订阅回调）。 */
  handleRequest: (req) => {
    const kind = String(req['kind'] ?? '');
    const id = String(req['id'] ?? '');
    switch (kind) {
      case 'select':
      case 'confirm':
      case 'input':
      case 'editor': {
        // 单对话框策略：新请求顶掉旧的（旧请求落取消应答）
        const prev = get().pendingDialog;
        if (prev)
          get().respond({ id: prev.id, ok: false, reason: 'cancelled' });
        set({
          pendingDialog: {
            kind,
            id,
            title: String(req['title'] ?? ''),
            options: req['options'] as string[] | undefined,
            message: req['message'] as string | undefined,
            placeholder: req['placeholder'] as string | undefined,
            prefill: req['prefill'] as string | undefined,
          },
        });
        break;
      }
      case 'notify': {
        const toast: PiToast = {
          id: ++toastSeq,
          message: String(req['message'] ?? ''),
          level: (req['level'] as PiToast['level']) ?? 'info',
        };
        set((s) => ({ toasts: [...s.toasts, toast] }));
        setTimeout(
          () =>
            set((s) => ({ toasts: s.toasts.filter((x) => x.id !== toast.id) })),
          4000,
        );
        break;
      }
      case 'status':
        set((s) => ({
          statusSlots: {
            ...s.statusSlots,
            [String(req['key'])]: req['text'] as string | undefined,
          },
        }));
        break;
      case 'workingMessage':
        set({ workingMessage: req['message'] as string | undefined });
        break;
      case 'widget':
        set((s) => ({
          widgets: {
            ...s.widgets,
            [String(req['widgetKey'])]: req['lines'] as string[] | undefined,
          },
        }));
        break;
      case 'widgetClear':
        set((s) => ({
          widgets: { ...s.widgets, [String(req['widgetKey'])]: undefined },
        }));
        break;
      case 'title':
        document.title = String(req['title'] ?? '');
        break;
      case 'editorText':
        set({
          editorTextFromMain: {
            text: String(req['text'] ?? ''),
            paste: req['paste'] === true,
            seq: ++toastSeq,
          },
        });
        break;
      default:
        break;
    }
  },

  /** pi:sync 的 UI 快照恢复（换代/刷新后重建全局 UI 区）。 */
  restoreSnapshot: (ui) => {
    if (!ui) return;
    const next: Partial<PiUIState> = {};
    if (ui.widgets)
      next.widgets = Object.fromEntries(
        ui.widgets.map((w) => [w.key, w.lines]),
      );
    if (ui.status)
      next.statusSlots = Object.fromEntries(
        ui.status.map((s) => [s.key, s.text]),
      );
    set(next);
  },

  /** 编辑器镜像推送（防抖 150ms；AssistantInput 变化时调用）。 */
  pushEditorMirror: (text, immediate = false) => {
    if (editorPushTimer) clearTimeout(editorPushTimer);
    const push = (): void => piAPI.pushEditorState(text);
    if (immediate) push();
    else editorPushTimer = setTimeout(push, 150);
  },
}));

/** 全局订阅（main.tsx 挂一次）。 */
export function bindPiUIRequests(): void {
  piAPI.onUIRequest((req) => usePiUIStore.getState().handleRequest(req));
}
