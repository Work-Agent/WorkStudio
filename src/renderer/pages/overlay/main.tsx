/**
 * 浮层视图（独立渲染进程）—— 模态 / 扩展 UI 对话框。
 *
 * 主进程是唯一的对话框宿主（pending 表在 DialogHost）；本页只是渲染与应答：
 * 收到 dialog 请求 → 展示模态卡片；用户操作 → overlay.respond；
 * 收到 dialogResolved（超时 / 会话关闭等主进程裁决）→ 撤卡。
 */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { DomainUpdate } from '@work-studio/sdk';
import type { UiDialogRequest } from '../../../shared/types.ts';
import '../../shared/styles/index.css';

interface Props {
  dialog: UiDialogRequest;
  onRespond: (response: {
    cancelled?: boolean;
    value?: string;
    confirmed?: boolean;
  }) => void;
}

function DialogCard({ dialog, onRespond }: Props) {
  const [text, setText] = useState(dialog.prefill ?? '');

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onRespond({ cancelled: true });
      if (
        e.key === 'Enter' &&
        (dialog.dialogType === 'input' || dialog.dialogType === 'editor') &&
        (e.metaKey || e.ctrlKey)
      ) {
        onRespond({ value: text });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, text, onRespond]);

  // 非模态：不铺背板、不拦点击，等浏览器回调的卡片只在旁边提示。
  const glass = dialog.modal === false;
  return (
    <div
      className={
        glass
          ? 'fixed inset-x-0 bottom-6 flex justify-center pointer-events-none'
          : 'fixed inset-0 flex items-center justify-center bg-black/35'
      }
    >
      <div
        className={`w-[min(560px,calc(100vw-48px))] rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-[#1E2021] shadow-2xl ${
          glass ? 'pointer-events-auto' : ''
        }`}
      >
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 text-[13px] font-medium text-zinc-900 dark:text-zinc-100">
          {dialog.title}
        </div>
        <div className="px-4 py-3 text-[12px] text-zinc-700 dark:text-zinc-200 space-y-2">
          {dialog.message && (
            <div className="whitespace-pre-wrap">{dialog.message}</div>
          )}
          {dialog.dialogType === 'select' && (
            <div className="flex flex-col gap-1">
              {(dialog.options ?? []).map((option) => (
                <button
                  key={option}
                  className="text-left px-2 py-1.5 rounded hover:bg-zinc-200/70 dark:hover:bg-zinc-700/50"
                  onClick={() => onRespond({ value: option })}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
          {dialog.dialogType === 'input' && (
            <input
              autoFocus
              type={dialog.secret ? 'password' : 'text'}
              autoComplete="off"
              className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#181A1B] px-2 py-1.5 outline-none focus:border-[#4F6BED]"
              placeholder={dialog.placeholder}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onRespond({ value: text });
              }}
            />
          )}
          {dialog.dialogType === 'editor' && (
            <textarea
              autoFocus
              className="w-full h-48 resize-none rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#181A1B] px-2 py-1.5 outline-none focus:border-[#4F6BED]"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          )}
        </div>
        <div className="px-4 py-3 border-t border-zinc-200 dark:border-zinc-800 flex justify-end gap-2">
          <button
            className="px-3 py-1 rounded-md text-[12px] text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200/70 dark:hover:bg-zinc-700/50"
            onClick={() => onRespond({ cancelled: true })}
          >
            取消
          </button>
          {dialog.dialogType === 'confirm' && (
            <button
              className="px-3 py-1 rounded-md text-[12px] bg-[#4F6BED] text-white hover:bg-[#3D56E0]"
              onClick={() => onRespond({ confirmed: true })}
            >
              确认
            </button>
          )}
          {(dialog.dialogType === 'input' ||
            dialog.dialogType === 'editor') && (
            <button
              className="px-3 py-1 rounded-md text-[12px] bg-[#4F6BED] text-white hover:bg-[#3D56E0]"
              onClick={() => onRespond({ value: text })}
            >
              提交
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface DialogView {
  id: string;
  request: UiDialogRequest | null;
  status: 'open' | 'resolved' | 'cancelled';
}

function Overlay() {
  const [dialogs, setDialogs] = useState<UiDialogRequest[]>([]);

  useEffect(() => {
    const bridge = window.workStudio;
    if (!bridge) return;
    const wsId = bridge.workspaceId;
    if (!wsId) return;
    const dialogs = `${wsId}/dialogs`;
    const apply = (views: DialogView[]): void => {
      setDialogs(
        views
          .filter((view) => view.status === 'open' && view.request)
          .map((view) => view.request as UiDialogRequest),
      );
    };
    const off = bridge.onUpdate((update: DomainUpdate) => {
      if (update.domain !== 'shell' || update.resource !== dialogs) return;
      if (update.type === 'snapshot') apply(update.data as DialogView[]);
    });
    void bridge
      .subscribe('shell', dialogs)
      .then((value) => apply((value as DialogView[]) ?? []));
    return () => {
      off();
      bridge.unsubscribe('shell', dialogs);
    };
  }, []);

  const respond = (
    dialog: UiDialogRequest,
    response: { cancelled?: boolean; value?: string; confirmed?: boolean },
  ): void => {
    const wsId = window.workStudio.workspaceId;
    if (!wsId) return;
    void window.workStudio.command('shell', `${wsId}/dialogs`, 'respond', {
      id: dialog.id,
      ...(response.value !== undefined ? { value: response.value } : {}),
      ...(response.confirmed !== undefined
        ? { confirmed: response.confirmed }
        : {}),
      cancelled: response.cancelled === true,
    });
    setDialogs((prev) => prev.filter((d) => d.id !== dialog.id));
  };

  const current = dialogs[0];
  return current ? (
    <DialogCard dialog={current} onRespond={(r) => respond(current, r)} />
  ) : null;
}

createRoot(document.getElementById('root')!).render(<Overlay />);
