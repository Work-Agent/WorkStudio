/**
 * 浮层视图（独立渲染进程）—— 模态 / 扩展 UI 对话框。
 *
 * 主进程是唯一的对话框宿主（pending 表在 DialogHost）；本页只是渲染与应答：
 * 收到 dialog 请求 → 展示模态卡片；用户操作 → overlay.respond；
 * 收到 dialogResolved（超时 / 会话关闭等主进程裁决）→ 撤卡。
 */
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { UiDialogRequest } from '../../shared/types';
import '../index.css';

interface Props {
  dialog: UiDialogRequest;
  onRespond: (response: {
    cancelled?: boolean;
    value?: string;
    confirmed?: boolean;
  }) => void;
}

function DialogCard({ dialog, onRespond }: Props) {
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    card.current?.querySelector<HTMLElement>('input,textarea,button')?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, [dialog.id]);
  const [text, setText] = useState(dialog.prefill ?? '');

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Tab') {
        const nodes = Array.from(
          card.current?.querySelectorAll<HTMLElement>(
            'button,input,textarea',
          ) ?? [],
        );
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
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

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/35">
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        className="w-[min(560px,calc(100vw-48px))] rounded-xl border border-[var(--biz-border)] bg-[var(--biz-surface)] shadow-2xl"
      >
        <div
          id="dialog-title"
          className="px-4 py-3 border-b border-[var(--biz-border)] text-[13px] font-medium text-[var(--biz-text)]"
        >
          {dialog.title}
        </div>
        <div className="px-4 py-3 text-[12px] text-[var(--biz-text)] space-y-2">
          {dialog.message && (
            <div className="whitespace-pre-wrap">{dialog.message}</div>
          )}
          {dialog.dialogType === 'select' && (
            <div className="flex flex-col gap-1">
              {(dialog.options ?? []).map((option) => (
                <button
                  key={option}
                  className="text-left px-2 py-1.5 rounded hover:bg-[var(--biz-surface)] dark:hover:bg-[var(--biz-surface)]"
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
              className="w-full rounded-md border border-[var(--biz-border)] bg-[var(--biz-surface)] px-2 py-1.5 outline-none focus:border-[var(--biz-accent)]"
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
              className="w-full h-48 resize-none rounded-md border border-[var(--biz-border)] bg-[var(--biz-surface)] px-2 py-1.5 outline-none focus:border-[var(--biz-accent)]"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          )}
        </div>
        <div className="px-4 py-3 border-t border-[var(--biz-border)] flex justify-end gap-2">
          <button
            className="px-3 py-1 rounded-md text-[12px] text-[var(--biz-text-muted)] text-[var(--biz-text)] hover:bg-[var(--biz-surface)] dark:hover:bg-[var(--biz-surface)]"
            onClick={() => onRespond({ cancelled: true })}
          >
            取消
          </button>
          {dialog.dialogType === 'confirm' && (
            <button
              className="px-3 py-1 rounded-md text-[12px] bg-[var(--biz-accent)] text-[var(--biz-primary-ink)] hover:bg-[var(--biz-accent-hover)]"
              onClick={() => onRespond({ confirmed: true })}
            >
              确认
            </button>
          )}
          {(dialog.dialogType === 'input' ||
            dialog.dialogType === 'editor') && (
            <button
              className="px-3 py-1 rounded-md text-[12px] bg-[var(--biz-accent)] text-[var(--biz-primary-ink)] hover:bg-[var(--biz-accent-hover)]"
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
    const bridge = window.appBridge;
    if (!bridge) return;
    const off = bridge.on((frame) => {
      if (frame.type !== 'state' || frame.path !== '/dialogs') return;
      const views = frame.value as DialogView[];
      setDialogs(
        views
          .filter((view) => view.status === 'open' && view.request)
          .map((view) => view.request as UiDialogRequest),
      );
    });
    void bridge.watch(['/dialogs']);
    return off;
  }, []);

  const respond = (
    dialog: UiDialogRequest,
    response: { cancelled?: boolean; value?: string; confirmed?: boolean },
  ): void => {
    void window.appBridge?.call(
      `/dialogs/${encodeURIComponent(dialog.id)}/respond`,
      { response: { id: dialog.id, ...response } },
    );
    setDialogs((prev) => prev.filter((d) => d.id !== dialog.id));
  };

  const current = dialogs[0];
  return current ? (
    <DialogCard dialog={current} onRespond={(r) => respond(current, r)} />
  ) : null;
}

createRoot(document.getElementById('root')!).render(<Overlay />);
