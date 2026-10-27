/**
 * 模型选择器（/model 命令入口）：打开事件由命令域派发，本组件只订阅。
 * 浮层经 Floating UI 定位 + Portal（脱离右栏 overflow 裁剪）。
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useAppStore } from '../../state/app';
import { OPEN_MODEL_SWITCHER_EVT } from '../../state/commands';
import { FloatingPanel, useDropdownPosition } from '../FloatingMenu';

export function ModelSwitcher() {
  const [open, setOpen] = useState(false);
  const pos = useDropdownPosition<HTMLButtonElement>();
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const floatRef = useRef<HTMLDivElement | null>(null);

  const status = useAppStore((s) => s.status);
  const models = useAppStore((s) => s.models);

  useEffect(() => {
    const onCmdOpen = (): void => setOpen(true);
    document.addEventListener(OPEN_MODEL_SWITCHER_EVT, onCmdOpen);
    const handler = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || floatRef.current?.contains(t))
        return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && open) setOpen(false);
    };
    document.addEventListener('keydown', onEsc, true);
    return () => {
      document.removeEventListener(OPEN_MODEL_SWITCHER_EVT, onCmdOpen);
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', onEsc, true);
    };
  }, [open]);

  const current = models.find(
    (m) => m.modelId === status.modelId && m.provider === status.provider,
  );
  const currentLabel = current?.label ?? status.modelId ?? '未配置';

  return (
    <div ref={triggerRef}>
      <button
        ref={pos.refs.setReference}
        onClick={() => setOpen((v) => !v)}
        data-testid="model-switcher"
        className="flex items-center gap-1 px-1.5 py-0.5 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-[#2a2d2e] rounded transition-colors"
      >
        <span>{currentLabel}</span>
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <FloatingPanel
          pos={pos}
          floatingRef={(el) => {
            floatRef.current = el;
          }}
          className="w-44 bg-white dark:bg-[#252829] border border-zinc-300 dark:border-zinc-700 rounded-md shadow-lg py-1 max-h-60 overflow-y-auto"
        >
          {models.map((m) => (
            <button
              key={`${m.provider}/${m.modelId}`}
              onClick={() => {
                setOpen(false);
                void useAppStore
                  .getState()
                  .configure({ provider: m.provider, modelId: m.modelId });
              }}
              className={`w-full text-left px-2.5 py-1.5 text-[12px] hover:bg-zinc-100 dark:hover:bg-[#2a2d2e] transition-colors ${
                m.modelId === status.modelId && m.provider === status.provider
                  ? 'text-[#4F6BED] font-medium'
                  : 'text-zinc-700 dark:text-zinc-300'
              }`}
            >
              {m.label}
            </button>
          ))}
        </FloatingPanel>
      )}
    </div>
  );
}
