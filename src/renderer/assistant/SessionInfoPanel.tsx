/** 会话信息面板：/session 命令与标签栏入口共用。 */
import { useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { bridge } from './bridge';

interface Stats {
  sessionFile: string | null;
  sessionId: string;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  totalMessages: number;
  tokens: { input: number; output: number; total: number };
}

function Row({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div className="flex justify-between items-center gap-4 py-[3px]">
      <span className="text-[11px] text-zinc-400 dark:text-zinc-500 shrink-0">
        {label}
      </span>
      <span className="text-[12px] text-zinc-800 dark:text-zinc-200 font-mono text-right truncate">
        {children}
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
        {title}
      </div>
      {children}
    </div>
  );
}

export function SessionInfoPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    void bridge?.cmd<Stats>('session.stats').then((response) => {
      if (response.ok) setStats(response.data);
      else setError(response.error.message);
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const fmt = (value: number): string => value.toLocaleString();
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center"
      data-testid="session-info"
    >
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-[380px] max-h-[70vh] overflow-y-auto bg-white dark:bg-[#252829] border border-zinc-300 dark:border-zinc-700 rounded-xl shadow-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">
            会话信息
          </span>
          <button
            onClick={onClose}
            className="p-1 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-[#2a2d2e] transition-colors"
            title="关闭"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        {error ? (
          <div className="text-[12px] text-red-500 py-4 text-center">
            {error}
          </div>
        ) : stats ? (
          <div className="flex flex-col gap-3.5">
            <Section title="会话">
              <Row label="文件">
                {(stats.sessionFile ?? '内存会话（未落盘）').split('/').pop()}
              </Row>
              <Row label="ID">{stats.sessionId.slice(0, 8)}…</Row>
            </Section>
            <Section title="消息">
              <Row label="总计">{fmt(stats.totalMessages)}</Row>
              <Row label="用户 / 助手">
                {fmt(stats.userMessages)} / {fmt(stats.assistantMessages)}
              </Row>
              <Row label="工具调用">
                {fmt(stats.toolCalls)} 次 · 结果 {fmt(stats.toolResults)}
              </Row>
            </Section>
            <Section title="Tokens">
              <Row label="输入">{fmt(stats.tokens.input)}</Row>
              <Row label="输出">{fmt(stats.tokens.output)}</Row>
              <Row label="合计">{fmt(stats.tokens.total)}</Row>
            </Section>
          </div>
        ) : null}
      </div>
    </div>
  );
}
