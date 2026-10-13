/**
 * DialogHost —— 扩展 UI 对话框族渲染。
 *
 * select/confirm/input/editor 四类；应答经 pi:ui-response 结构化回传；Esc/遮罩 = cancelled。
 */
import { useEffect, useRef, useState } from 'react';
import { usePiUIStore } from '../../state/piUI';

export function DialogHost() {
  const dialog = usePiUIStore((s) => s.pendingDialog);
  const [selectIdx, setSelectIdx] = useState(0);
  const [inputVal, setInputVal] = useState('');
  const [editorVal, setEditorVal] = useState('');
  const layerRef = useRef<HTMLDivElement | null>(null);
  const lastIdRef = useRef('');

  // 对话框更换时重置局部态 + focus
  useEffect(() => {
    if (!dialog || dialog.id === lastIdRef.current) return;
    lastIdRef.current = dialog.id;
    setSelectIdx(0);
    setInputVal('');
    setEditorVal(dialog.prefill ?? '');
    queueMicrotask(() => {
      const first = layerRef.current?.querySelector<HTMLInputElement>(
        'input, textarea, [tabindex]',
      );
      first?.focus();
    });
  }, [dialog]);

  if (!dialog) return null;

  const submit = (value?: unknown): void => {
    usePiUIStore.getState().respond({ id: dialog.id, ok: true, value });
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      usePiUIStore.getState().cancel();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      if (dialog.kind === 'select') {
        e.preventDefault();
        submit(dialog.options?.[selectIdx]);
      } else if (dialog.kind === 'input') {
        e.preventDefault();
        submit(inputVal);
      } else if (dialog.kind === 'confirm') {
        e.preventDefault();
        submit(true);
      }
      // editor：Enter 允许换行，Ctrl/Cmd+Enter 提交
    }
    if (
      e.key === 'Enter' &&
      (e.metaKey || e.ctrlKey) &&
      dialog.kind === 'editor'
    ) {
      e.preventDefault();
      submit(editorVal);
    }
    if (
      dialog.kind === 'select' &&
      (e.key === 'ArrowDown' || e.key === 'ArrowUp')
    ) {
      e.preventDefault();
      const opts = dialog.options ?? [];
      setSelectIdx((i) =>
        e.key === 'ArrowDown'
          ? Math.min(i + 1, opts.length - 1)
          : Math.max(i - 1, 0),
      );
    }
  };

  return (
    <div
      ref={layerRef}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-[1px]"
      onKeyDown={onKeyDown}
      onClick={(e) => {
        if (e.target === layerRef.current) usePiUIStore.getState().cancel();
      }}
    >
      <div className="w-[400px] max-w-[90vw] bg-white dark:bg-[#252829] border border-zinc-300 dark:border-zinc-700 rounded-xl shadow-2xl overflow-hidden">
        {/* 标题栏 */}
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <span className="text-[13px] font-medium">{dialog.title}</span>
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-mono">
            {dialog.kind === 'select'
              ? '↑↓ 选择 · Enter 确认'
              : dialog.kind === 'editor'
                ? '⌘/Ctrl+Enter 提交'
                : 'Enter 确认 · Esc 取消'}
          </span>
        </div>

        {dialog.kind === 'select' && (
          <div className="max-h-72 overflow-y-auto py-1.5">
            {(dialog.options ?? []).map((opt, i) => (
              <button
                key={opt}
                className={`w-full text-left px-4 py-2 text-[12.5px] transition-colors ${
                  i === selectIdx
                    ? 'bg-[#4F6BED]/10 text-[#4F6BED]'
                    : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-[#2a2d2e]'
                }`}
                onClick={() => submit(opt)}
                onMouseEnter={() => setSelectIdx(i)}
              >
                {opt}
              </button>
            ))}
          </div>
        )}

        {dialog.kind === 'confirm' && (
          <div className="px-4 py-4">
            <p className="text-[12.5px] text-zinc-600 dark:text-zinc-300 leading-relaxed">
              {dialog.message}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="px-3.5 py-1.5 text-[12px] rounded-lg border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-[#2a2d2e]"
                onClick={() =>
                  usePiUIStore
                    .getState()
                    .respond({ id: dialog.id, ok: true, value: false })
                }
              >
                取消
              </button>
              <button
                className="px-3.5 py-1.5 text-[12px] rounded-lg bg-[#4F6BED] text-white hover:brightness-110"
                onClick={() => submit(true)}
              >
                确认
              </button>
            </div>
          </div>
        )}

        {dialog.kind === 'input' && (
          <div className="px-4 py-4">
            <input
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              placeholder={dialog.placeholder}
              className="w-full px-3 py-2 text-[12.5px] border border-zinc-300 dark:border-zinc-600 rounded-lg bg-transparent outline-none focus:border-[#4F6BED]"
            />
            <div className="mt-3 flex justify-end">
              <button
                className="px-3.5 py-1.5 text-[12px] rounded-lg bg-[#4F6BED] text-white hover:brightness-110 disabled:opacity-40"
                disabled={!inputVal.trim()}
                onClick={() => submit(inputVal)}
              >
                提交
              </button>
            </div>
          </div>
        )}

        {dialog.kind === 'editor' && (
          <div className="px-4 py-4">
            <textarea
              value={editorVal}
              onChange={(e) => setEditorVal(e.target.value)}
              rows={8}
              className="w-full px-3 py-2 text-[12px] font-mono border border-zinc-300 dark:border-zinc-600 rounded-lg bg-transparent outline-none focus:border-[#4F6BED] resize-y"
            />
            <div className="mt-3 flex justify-end">
              <button
                className="px-3.5 py-1.5 text-[12px] rounded-lg bg-[#4F6BED] text-white hover:brightness-110"
                onClick={() => submit(editorVal)}
              >
                提交
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
