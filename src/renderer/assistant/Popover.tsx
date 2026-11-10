import { useEffect, useRef, type ReactNode } from 'react';

/** 页面内配置浮层：保留原生 Tab 顺序，关闭时回到触发按钮。 */
export function Popover({
  label,
  onClose,
  children,
  align = 'left',
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
  align?: 'left' | 'right';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const panel = ref.current;
    ref.current?.querySelector<HTMLElement>('input, button, select')?.focus();
    const outside = (event: PointerEvent) => {
      if (ref.current?.parentElement?.contains(event.target as Node)) return;
      closeRef.current();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeRef.current();
      trigger?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key, true);
    return () => {
      if (panel?.contains(document.activeElement)) trigger?.focus();
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key, true);
    };
  }, []);
  return (
    <div
      ref={ref}
      className={`agent-popover align-${align}`}
      role="dialog"
      aria-label={label}
    >
      <div className="agent-popover-heading">
        <strong>{label}</strong>
        <button
          className="agent-text-button"
          onClick={onClose}
          aria-label={`关闭${label}`}
        >
          关闭
        </button>
      </div>
      {children}
    </div>
  );
}
