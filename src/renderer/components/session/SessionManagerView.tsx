/**
 * SessionManagerView —— 会话管理设置页（设置域「会话管理」入口，与模型设置同一打开管道）。
 *
 * 承载：按访问域归档的会话列表 / 搜索 / 当前会话高亮 / 切换会话 / 真删除 / 执行中停止。
 * 由资源面板作为内建视图渲染在统一中栏 tab 内（扩展实例 id = 'session-manager'）。
 */
import { useMemo, useState } from 'react';
import {
  BotMessageSquare,
  ChevronRight,
  Globe,
  MessageCirclePlus,
  Search,
  Trash,
  X,
} from 'lucide-react';
import type { SessionMeta, UraGroupInfo } from '../../../shared/types';
import { useConversationStore } from '../../state/conversation';
import { useDocumentsStore } from '../../state/documents';
import { useUiStore } from '../../state/uiState';
import { SessionStatusAction } from '../sidebar/SessionStatusAction';
import { formatTime } from '../sidebar/time';

/** 会话行（当前项高亮；行点击 = 切换会话）。 */
function SessionRow({
  session,
  isActive,
  isStreaming,
  justSettled,
  onPick,
}: {
  session: SessionMeta;
  isActive: boolean;
  isStreaming: boolean;
  justSettled: boolean;
  onPick: () => void;
}) {
  return (
    <div
      data-testid="session-manager-row"
      data-active={isActive ? 'true' : 'false'}
      onClick={onPick}
      className={`group relative flex items-center px-3 py-2.5 cursor-pointer transition-colors ${
        isActive
          ? 'bg-[#4F6BED]/[0.06]'
          : 'hover:bg-zinc-50 dark:hover:bg-[#2a2c2d]'
      }`}
      title={session.name}
    >
      {isActive && (
        <span className="absolute left-0 top-2 bottom-2 w-0.5 bg-[#4F6BED] rounded-r" />
      )}
      <div
        className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-medium ${
          isActive
            ? 'bg-zinc-300 dark:bg-[#3a3d3e] text-zinc-600 dark:text-zinc-300'
            : 'bg-zinc-200 dark:bg-[#32363a] text-zinc-500 dark:text-zinc-400'
        }`}
      >
        {(session.name || '?').trim().charAt(0).toUpperCase()}
      </div>
      <div className="ml-3 flex-1 overflow-hidden min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <h4
            className={`text-[13px] font-medium truncate leading-none ${
              isStreaming
                ? 'text-zinc-600 dark:text-zinc-300'
                : 'text-zinc-900 dark:text-zinc-100'
            }`}
          >
            {session.name}
          </h4>
          {isActive && (
            <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium text-[#4F6BED] bg-[#4F6BED]/10">
              当前
            </span>
          )}
        </div>
        <div className="flex items-center justify-between mt-[5px] gap-2">
          <p
            className={`text-[12px] truncate flex items-center gap-1 ${
              isStreaming
                ? 'text-[#4F6BED]'
                : 'text-zinc-400 dark:text-zinc-500'
            }`}
          >
            {isStreaming && (
              <span className="w-1.5 h-1.5 rounded-full bg-[#4F6BED] animate-pulse shrink-0" />
            )}
            {isStreaming
              ? session.preview || '执行中'
              : session.preview || '新任务'}
          </p>
        </div>
      </div>
      <span className="text-[11px] text-zinc-400 dark:text-zinc-500 shrink-0 mr-6">
        {formatTime(session.createdAt)}
      </span>
      <SessionStatusAction
        isStreaming={isStreaming}
        justSettled={justSettled}
        IdleIcon={Trash}
        onIdle={() => void useConversationStore.getState().remove(session.path)}
        idleTitle="删除"
        idleClass="text-zinc-400 hover:text-red-500"
        onStop={() => void useConversationStore.getState().abort(session.path)}
      />
    </div>
  );
}

/** 域分组头（favicon + 站点标题 + 域名 + 计数；点击折叠）。 */
function DomainHeader({
  group,
  domain,
  count,
  collapsed,
  onToggle,
}: {
  group: UraGroupInfo | undefined;
  domain: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const [broken, setBroken] = useState(false);
  const title = group?.title || domain;
  const showImage = !!group?.icon && !broken;
  return (
    <div
      onClick={onToggle}
      className="flex items-center gap-2 px-3 py-2 cursor-pointer bg-zinc-50/80 dark:bg-[#252829] hover:bg-zinc-100 dark:hover:bg-[#2a2d2e] transition-colors select-none"
      data-testid="session-domain-group"
      data-domain={domain}
    >
      <ChevronRight
        className={`w-3 h-3 shrink-0 text-zinc-400 transition-transform ${collapsed ? '' : 'rotate-90'}`}
      />
      <span className="shrink-0 w-5 h-5 rounded flex items-center justify-center overflow-hidden bg-zinc-200 dark:bg-[#32363a]">
        {showImage ? (
          <img
            src={group?.icon}
            alt=""
            className="w-full h-full object-contain"
            onError={() => setBroken(true)}
          />
        ) : (
          <Globe className="w-3 h-3 text-sky-600 dark:text-sky-500" />
        )}
      </span>
      <span className="text-[12px] font-medium text-zinc-700 dark:text-zinc-200 truncate">
        {title}
      </span>
      <span className="text-[10px] text-zinc-400 dark:text-zinc-500 truncate">
        {title === domain ? '' : domain}
      </span>
      <span className="flex-1" />
      <span className="text-[10px] text-zinc-400 dark:text-zinc-500 shrink-0">
        {count} 个会话
      </span>
    </div>
  );
}

export function SessionManagerView() {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const sessions = useConversationStore((s) => s.sessions);
  const sessionDomains = useConversationStore((s) => s.sessionDomains);
  const streamingSessions = useConversationStore((s) => s.streamingSessions);
  const settledFlash = useConversationStore((s) => s.settledFlash);
  const activePath = useUiStore((s) => s.activePath);
  const groups = useDocumentsStore((s) => s.groups);

  const toggle = (key: string): void =>
    setCollapsed((c) => ({ ...c, [key]: !c[key] }));

  /** 列表数据源：已落盘会话 + 未落盘 streaming 会话临时行。 */
  const sorted = useMemo(() => {
    const list = [...sessions];
    for (const path of streamingSessions) {
      if (!list.some((s) => s.path === path)) {
        list.push({ path, name: '新任务', createdAt: Date.now(), preview: '' });
      }
    }
    return list.sort((a, b) => b.createdAt - a.createdAt);
  }, [sessions, streamingSessions]);

  /** 搜索过滤（标题 / 预览，大小写不敏感）。 */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.preview ?? '').toLowerCase().includes(q),
    );
  }, [sorted, query]);

  /** web 域元数据（favicon / 站点标题）。 */
  const groupsByDomain = useMemo(() => {
    const map = new Map<string, UraGroupInfo>();
    for (const g of groups) {
      if (g.source === 'web') map.set(g.id, g);
    }
    return map;
  }, [groups]);

  /** 按域归档：域分组（最近会话时间倒序）+ 尾部「其他会话」。 */
  const grouped = useMemo(() => {
    const byDomain = new Map<string, SessionMeta[]>();
    const rest: SessionMeta[] = [];
    for (const s of filtered) {
      const domain = sessionDomains[s.path];
      if (!domain) {
        rest.push(s);
        continue;
      }
      const list = byDomain.get(domain) ?? [];
      list.push(s);
      byDomain.set(domain, list);
    }
    const domainGroups = [...byDomain.entries()]
      .map(([domain, list]) => ({
        key: `domain:${domain}`,
        domain,
        group: groupsByDomain.get(domain),
        sessions: list,
        latest: Math.max(...list.map((s) => s.createdAt)),
      }))
      .sort((a, b) => b.latest - a.latest);
    return { domainGroups, rest };
  }, [filtered, sessionDomains, groupsByDomain]);

  const rowFor = (s: SessionMeta) => (
    <SessionRow
      key={s.path}
      session={s}
      isActive={s.path === activePath}
      isStreaming={streamingSessions.has(s.path)}
      justSettled={settledFlash.has(s.path)}
      onPick={() => void useConversationStore.getState().select(s.path)}
    />
  );

  return (
    <div className="h-full w-full overflow-y-auto bg-zinc-50 dark:bg-[#1E2021]">
      <div className="max-w-3xl mx-auto px-8 py-8">
        {/* 页头：标题 + 说明 + 新任务 */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center bg-[#4F6BED] text-white">
              <BotMessageSquare className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-[17px] font-semibold text-zinc-900 dark:text-zinc-100 leading-tight">
                会话管理
              </h1>
              <p className="mt-1 text-[12px] text-zinc-400 dark:text-zinc-500">
                按访问域归档 · 点击行切换当前会话 · 删除为真删除（执行中可停止）
              </p>
            </div>
          </div>
          <button
            onClick={() => useConversationStore.getState().createNew()}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-white bg-[#4F6BED] hover:bg-[#3D56E0] transition-colors"
            title="新建任务（首条消息建会话）"
          >
            <MessageCirclePlus className="w-3.5 h-3.5" />
            新任务
          </button>
        </div>

        {/* 工具条：搜索 + 计数 */}
        <div className="mt-6 flex items-center gap-3">
          <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-white dark:bg-[#252829] border border-zinc-200 dark:border-zinc-700 focus-within:border-zinc-300 dark:focus-within:border-zinc-600 transition-colors">
            <Search className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索会话（标题 / 预览）…"
              className="flex-1 min-w-0 bg-transparent text-[12px] text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="p-0.5 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
                title="清除"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <span className="text-[11px] text-zinc-400 dark:text-zinc-500 shrink-0 tabular-nums">
            {filtered.length} / {sorted.length}
          </span>
        </div>

        {/* 会话列表卡片 */}
        <div className="mt-4 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-[#252829] overflow-hidden">
          {sorted.length === 0 ? (
            <div className="h-40 flex flex-col items-center justify-center text-zinc-400 dark:text-zinc-600 text-[12px] gap-2">
              <BotMessageSquare className="w-5 h-5 opacity-60" />
              <span>暂无会话</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-zinc-400 dark:text-zinc-600 text-[12px]">
              无匹配会话
            </div>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {grouped.domainGroups.map((g) => (
                <div key={g.key}>
                  <DomainHeader
                    group={g.group}
                    domain={g.domain}
                    count={g.sessions.length}
                    collapsed={!!collapsed[g.key]}
                    onToggle={() => toggle(g.key)}
                  />
                  {!collapsed[g.key] && g.sessions.map((s) => rowFor(s))}
                </div>
              ))}
              {grouped.rest.length > 0 && (
                <div>
                  <DomainHeader
                    group={undefined}
                    domain="其他会话"
                    count={grouped.rest.length}
                    collapsed={!!collapsed['rest']}
                    onToggle={() => toggle('rest')}
                  />
                  {!collapsed['rest'] && grouped.rest.map((s) => rowFor(s))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
