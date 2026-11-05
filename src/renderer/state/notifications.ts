/** 工作台通知队列（扩展 ui.notify 的渲染层投影）。 */
import { create } from 'zustand';
import type { UiNotifyMessage } from '../../shared/types';

export interface WorkspaceToast {
  id: string;
  message: string;
  level: UiNotifyMessage['level'];
  source?: string;
}

interface NotificationsState {
  toasts: WorkspaceToast[];
  push: (toast: WorkspaceToast) => void;
  dismiss: (id: string) => void;
}

export const useNotificationsStore = create<NotificationsState>()((set) => ({
  toasts: [],
  push: (toast) => {
    set((state) => ({ toasts: [...state.toasts, toast] }));
    setTimeout(
      () =>
        set((state) => ({
          toasts: state.toasts.filter((item) => item.id !== toast.id),
        })),
      4000,
    );
  },
  dismiss: (id) =>
    set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) })),
}));

let errorSeq = 0;

/** 命令失败的通知条：渲染层不吞错误，把失败原因摆到界面上。 */
export function notifyError(message: string, source?: string): void {
  errorSeq += 1;
  useNotificationsStore.getState().push({
    id: `error-${errorSeq}`,
    message,
    level: 'error',
    ...(source ? { source } : {}),
  });
}
