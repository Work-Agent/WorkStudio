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
  // 快照未到前用 null 占位：空数组分不清「还没订阅」和「真没有通知」。
  const notices = useResource<Array<{
    id: string;
    level: 'info' | 'warn' | 'error';
    message: string;
    source?: string;
  }> | null>('shell', workspaceId ? `${workspaceId}/notices` : null, null);
  /** null = 还没拿到首份快照；首份快照里的都是历史。 */
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!notices) return;
    // 通知是事件而非状态：挂载前的历史只记不弹，否则每开一个设置页
    // 都会把通知队列重播一屏。
    if (seen.current === null) {
      seen.current = new Set(notices.map((notice) => notice.id));
      return;
    }
    for (const notice of notices) {
      if (seen.current.has(notice.id)) continue;
      useNotificationsStore.getState().push({
        ...notice,
        level: notice.level === 'warn' ? 'warning' : notice.level,
      });
    }
    // 队列会丢弃旧条目，已读集合以当前快照为准，避免无界增长。
    seen.current = new Set(notices.map((notice) => notice.id));
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
