/** 工作台通知条（扩展 ui.notify）。 */
import { useNotificationsStore } from '../state/notifications';

export function ToastHost() {
  const toasts = useNotificationsStore((state) => state.toasts);
  const dismiss = useNotificationsStore((state) => state.dismiss);
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-24 right-5 z-[90] flex flex-col gap-2 items-end pointer-events-none">
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
