/**
 * 浮层视图（独立渲染进程）—— 模态 / 扩展 UI 对话框。
 *
 * 主进程是唯一的对话框宿主（pending 表在 DialogHost）；本页只是渲染与应答：
 * 收到 dialog 请求 → 展示模态卡片；用户操作 → overlay.respond；
 * 收到 dialogResolved（超时 / 会话关闭等主进程裁决）→ 撤卡。
 */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { UiDialogRequest } from '../../shared/types';

interface ResolvedMessage {
  type: 'dialogResolved';
  id: string;
}

interface Props {
  dialog: UiDialogRequest;
  onRespond: (response: {
    cancelled?: boolean;
    value?: string;
    confirmed?: boolean;
  }) => void;
}

function DialogCard({ dialog, onRespond }: Props) {
  const [text, setText] = useState(dialog.prefill ?? dialog.placeholder ?? '');

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onRespond({ cancelled: true });
      if (
        e.key === 'Enter' &&
        (dialog.kind === 'input' || dialog.kind === 'editor') &&
        (e.metaKey || e.ctrlKey)
      ) {
        onRespond({ value: text });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, text, onRespond]);

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/35">
      <div className="w-[min(560px,calc(100vw-48px))] rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-[#1E2021] shadow-2xl">
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 text-[13px] font-medium text-zinc-900 dark:text-zinc-100">
          {dialog.title}
        </div>
        <div className="px-4 py-3 text-[12px] text-zinc-700 dark:text-zinc-200 space-y-2">
          {dialog.message && (
            <div className="whitespace-pre-wrap">{dialog.message}</div>
          )}
          {dialog.kind === 'select' && (
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
          {dialog.kind === 'input' && (
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
          {dialog.kind === 'editor' && (
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
          {dialog.kind === 'confirm' && (
            <button
              className="px-3 py-1 rounded-md text-[12px] bg-[#4F6BED] text-white hover:bg-[#3D56E0]"
              onClick={() => onRespond({ confirmed: true })}
            >
              确认
            </button>
          )}
          {(dialog.kind === 'input' || dialog.kind === 'editor') && (
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

function Overlay() {
  const [dialogs, setDialogs] = useState<UiDialogRequest[]>([]);

  useEffect(() => {
    const bridge = window.overlay;
    if (!bridge) return;
    return bridge.onUi((request) => {
      if ((request as unknown as ResolvedMessage).type === 'dialogResolved') {
        const id = (request as unknown as ResolvedMessage).id;
        setDialogs((prev) => prev.filter((d) => d.id !== id));
        return;
      }
      if (request.type === 'dialog') {
        setDialogs((prev) =>
          prev.some((d) => d.id === request.id) ? prev : [...prev, request],
        );
      }
    });
  }, []);

  const respond = (
    dialog: UiDialogRequest,
    response: { cancelled?: boolean; value?: string; confirmed?: boolean },
  ): void => {
    void window.overlay?.respond({ id: dialog.id, ...response });
    setDialogs((prev) => prev.filter((d) => d.id !== dialog.id));
  };

  const current = dialogs[0];
  return current ? (
    <DialogCard dialog={current} onRespond={(r) => respond(current, r)} />
  ) : null;
}

createRoot(document.getElementById('root')!).render(<Overlay />);
