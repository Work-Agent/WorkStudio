import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import type { UiNotifyMessage } from '../../../shared/types.ts';
import { useResource } from '../api/bridge.ts';
import { useWindowWorkspaceId } from './workspaces.ts';

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
    set((state) => ({
      toasts: state.toasts.filter((item) => item.id !== id),
    })),
}));

/** 主进程通知资源 → 本地队列；每个消费方自己订阅。 */
export function useNotices(): void {
  const workspaceId = useWindowWorkspaceId();
  const notices = useResource<
    Array<{
      id: string;
      level: 'info' | 'warn' | 'error';
      message: string;
      source?: string;
    }>
  >('shell', workspaceId ? `${workspaceId}/notices` : null, []);
  const seen = useRef(new Set<string>());
  useEffect(() => {
    for (const notice of notices) {
      if (seen.current.has(notice.id)) continue;
      seen.current.add(notice.id);
      useNotificationsStore.getState().push({
        ...notice,
        level: notice.level === 'warn' ? 'warning' : notice.level,
      });
    }
  }, [notices]);
}

let errorSeq = 0;
export function notifyError(message: string, source?: string): void {
  errorSeq += 1;
  useNotificationsStore.getState().push({
    id: `error-${errorSeq}`,
    message,
    level: 'error',
    ...(source ? { source } : {}),
  });
}
