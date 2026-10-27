/**
 * SessionInfoPanel —— /session 会话信息面板。
 *
 * 信息结构：会话标识 · 消息统计 · Tokens（含缓存命中率）· 费用 · 上下文占用。
 * 打开：DOM 事件总线 wa:open-session-info（/session 命令派发）；Esc / × / 遮罩关闭。
 */
import { useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { runtimeCmd } from '../../api/runtime';
import type { AgentSnapshot } from '../../../shared/types';
import { OPEN_SESSION_INFO_EVT } from '../../state/commands';

interface SessionStatsData {
  sessionFile?: string;
  sessionId: string;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  totalMessages: number;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: number;
  contextUsage?: {
    tokens: number | null;
    contextWindow: number;
    percent: number | null;
  };
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

export function SessionInfoPanel() {
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState<SessionStatsData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = (): void => {
    setErr(null);
    void runtimeCmd<AgentSnapshot>('agent.status')
      .then((res) => {
        if (res.ok) {
          setStats({
            sessionFile: res.data.sessionFile ?? undefined,
            sessionId: res.data.sessionId ?? '',
            userMessages: 0,
            assistantMessages: 0,
            toolCalls: 0,
            toolResults: 0,
            totalMessages: res.data.messageCount,
            tokens: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
            cost: 0,
          });
          setOpen(true);
        } else {
          setErr('获取会话统计失败');
        }
      })
      .catch((e) => setErr(String(e)));
  };

  useEffect(() => {
    const onOpen = (): void => load();
    document.addEventListener(OPEN_SESSION_INFO_EVT, onOpen);
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && open) {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onEsc, true);
    return () => {
      document.removeEventListener(OPEN_SESSION_INFO_EVT, onOpen);
      document.removeEventListener('keydown', onEsc, true);
    };
  }, [open]);

  if (!open) return null;

  const file = (stats?.sessionFile ?? '内存会话（未落盘）').split('/').pop();
  const fmt = (n: number): string => n.toLocaleString();

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center"
      data-testid="session-info"
    >
      <div
        className="absolute inset-0 bg-black/30"
        onClick={() => setOpen(false)}
      />
      <div className="relative w-[380px] max-h-[70vh] overflow-y-auto bg-white dark:bg-[#252829] border border-zinc-300 dark:border-zinc-700 rounded-xl shadow-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">
            会话信息
          </span>
          <button
            onClick={() => setOpen(false)}
            className="p-1 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-[#2a2d2e] transition-colors"
            title="关闭"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {err ? (
          <div className="text-[12px] text-red-500 py-4 text-center">{err}</div>
        ) : stats ? (
          <div className="flex flex-col gap-3.5">
            <Section title="会话">
              <Row label="文件">{file}</Row>
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
              <Row label="输入（含缓存）">
                {fmt(
                  stats.tokens.input +
                    stats.tokens.cacheRead +
                    stats.tokens.cacheWrite,
                )}
                {stats.tokens.cacheRead > 0 && (
                  <span className="text-zinc-400">
                    （缓存命中{' '}
                    {(
                      (stats.tokens.cacheRead /
                        (stats.tokens.input + stats.tokens.cacheRead)) *
                      100
                    ).toFixed(1)}
                    %）
                  </span>
                )}
              </Row>
              <Row label="输出">{fmt(stats.tokens.output)}</Row>
              <Row label="合计">{fmt(stats.tokens.total)}</Row>
            </Section>
            <Section title="用量">
              <Row label="费用">${stats.cost.toFixed(4)}</Row>
              {stats.contextUsage?.tokens != null && (
                <Row label="上下文占用">
                  {fmt(stats.contextUsage.tokens)} /{' '}
                  {fmt(stats.contextUsage.contextWindow)}（
                  {((stats.contextUsage.percent ?? 0) * 100).toFixed(0)}%）
                </Row>
              )}
            </Section>
          </div>
        ) : null}
      </div>
    </div>
  );
}
