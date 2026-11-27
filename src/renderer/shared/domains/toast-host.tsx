/**
 * 通知条宿主：任何页面挂一次，就能显示主进程 `ui.notify` 与本地 notifyError。
 *
 * 每个页面是独立的 JS 上下文，通知队列不跨页面共享，所以主机页面（壳层）
 * 与设置页各自挂一份，避免在设置页触发的错误悄悄丢掉。
 */
import { useNotificationsStore, useNotices } from './notices.ts';

export function ToastHost() {
  useNotices();
  const toasts = useNotificationsStore((state) => state.toasts);
  const dismiss = useNotificationsStore((state) => state.dismiss);
  if (toasts.length === 0) return null;
  return (
    <div
      data-testid="toast-host"
      className="fixed bottom-24 right-5 z-[90] flex flex-col gap-2 items-end pointer-events-none"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto px-3.5 py-2 rounded-lg shadow-lg text-[12px] max-w-80 ${
            toast.level === 'error'
              ? 'bg-red-500/95 text-white'
              : toast.level === 'warning'
                ? 'bg-amber-500/95 text-white'
                : 'bg-zinc-800/95 text-white dark:bg-zinc-700/95'
          }`}
          onClick={() => dismiss(toast.id)}
          title={toast.source}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}
