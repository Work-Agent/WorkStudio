/**
 * S4 右栏 会话面板 —— architecture.md §2.5。
 *
 * tabs 数据源 = openPaths（≠ 全部会话）；关闭标签 ≠ 删除数据；
 * streaming 脉冲点随标题居中；自动滚动（距底 <80px 才跟随）。
 */
import { useEffect, useRef, useState } from 'react';
import { MessageCirclePlus, PictureInPicture2, X } from 'lucide-react';
import type { PopupMenuItem } from '../../../shared/types';
import { popupMenu } from '../../api/runtime';
import { useAppStore } from '../../state/app';
import { useConversationStore } from '../../state/conversation';
import { setUiState, useUiStore } from '../../state/uiState';
import { AssistantInput } from './AssistantInput';
import { MessageBubble } from './MessageBubble';
import { SessionInfoPanel } from './SessionInfoPanel';

/** popup 菜单 source 标识。 */
const MENU_SOURCE = 'chat-tabs';

export function AssistantPanel() {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const openPaths = useUiStore((s) => s.openPaths);
  const activePath = useUiStore((s) => s.activePath);
  const aiFloating = useUiStore((s) => s.aiFloating);
  const sessions = useConversationStore((s) => s.sessions);
  const streamingSessions = useConversationStore((s) => s.streamingSessions);
  const messages = useConversationStore(
    (s) => s.messagesBySession[activePath ?? '__new__'] ?? [],
  );
  const configured = useAppStore((s) => s.status.configured);

  // 消息变化自动滚动（距底时）
  const prevLenRef = useRef(0);
  useEffect(() => {
    const len = messages.length;
    if (len !== prevLenRef.current) {
      prevLenRef.current = len;
      if (autoScroll && scrollRef.current) {
        queueMicrotask(() => {
          if (scrollRef.current)
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        });
      }
    }
  }, [messages.length, autoScroll]);

  const handleScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  };

  const openTabs = openPaths
    .map((p) => sessions.find((s) => s.path === p))
    .filter((s): s is NonNullable<typeof s> => Boolean(s));

  // ── 右键菜单（关闭/关闭其他/关闭全部/关闭左侧/关闭右侧）──
  useEffect(() => {
    const off = popupMenu.onSelect((e) => {
      if (e.source !== MENU_SOURCE) return;
      const [action, id] = e.actionId.split(':');
      const state = useUiStore.getState();
      const conversation = useConversationStore.getState();
      const closeMany = (paths: string[]): void => {
        for (const p of paths) void conversation.close(p);
      };
      if (action === 'close' && id) void conversation.close(id);
      else if (action === 'closeOthers' && id)
        closeMany(state.openPaths.filter((p) => p !== id));
      else if (action === 'closeLeft' && id)
        closeMany(state.openPaths.slice(0, state.openPaths.indexOf(id)));
      else if (action === 'closeRight' && id)
        closeMany(state.openPaths.slice(state.openPaths.indexOf(id) + 1));
      else if (action === 'closeAll') closeMany([...state.openPaths]);
    });
    return off;
  }, []);

  const openChatMenu = (anchorPath: string): void => {
    const idx = openPaths.indexOf(anchorPath);
    const items: PopupMenuItem[] = [
      { id: `close:${anchorPath}`, label: '关闭' },
    ];
    items.push({
      id: `closeOthers:${anchorPath}`,
      label: '关闭其他',
      disabled: openPaths.length <= 1,
    });
    items.push({
      id: 'closeAll',
      label: '关闭全部',
      disabled: openPaths.length === 0,
    });
    items.push({
      id: `closeLeft:${anchorPath}`,
      label: '关闭左侧',
      disabled: idx <= 0,
    });
    items.push({
      id: `closeRight:${anchorPath}`,
      label: '关闭右侧',
      disabled: idx < 0 || idx >= openPaths.length - 1,
    });
    void popupMenu.show({ source: MENU_SOURCE, items });
  };

  return (
    <div className="h-full w-full flex flex-col bg-zinc-100 dark:bg-[#1E2021]">
      {/* ── 会话标签栏 ── */}
      <div className="h-9 shrink-0 flex items-stretch border-b border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-[#1E2021] select-none">
        <div
          className="flex flex-1 items-stretch overflow-x-auto min-w-0 tab-scroll"
          data-testid="chat-tabs"
        >
          {openTabs.map((s) => {
            const isActive = s.path === activePath;
            const isStreaming = streamingSessions.has(s.path);
            return (
              <div
                key={s.path}
                onClick={() =>
                  void useConversationStore.getState().select(s.path)
                }
                onContextMenu={(e) => {
                  e.preventDefault();
                  openChatMenu(s.path);
                }}
                title={s.name}
                className={`group relative flex items-center justify-center gap-1.5 px-5 shrink-0 cursor-pointer border-r border-zinc-200 dark:border-zinc-800/60 transition-colors max-w-52 min-w-0 ${
                  isActive
                    ? 'bg-zinc-50 dark:bg-[#262829] text-zinc-900 dark:text-zinc-100'
                    : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-[#252829] hover:text-zinc-700 dark:hover:text-zinc-200'
                }`}
              >
                {isActive && (
                  <span className="absolute inset-x-0 top-0 h-0.5 bg-[#4F6BED] rounded-b" />
                )}
                {isStreaming && (
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-[#4F6BED] animate-pulse shrink-0"
                    title="正在执行"
                  />
                )}
                <span className="text-[12px] whitespace-nowrap overflow-hidden text-ellipsis min-w-0">
                  {s.name}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void useConversationStore.getState().close(s.path);
                  }}
                  className="absolute right-0.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-zinc-400 hover:text-red-500 hover:bg-zinc-200 dark:hover:bg-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="关闭标签"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
          {openPaths.length === 0 && (
            <div className="flex items-center px-3 text-[12px] text-zinc-400 dark:text-zinc-500">
              暂无会话
            </div>
          )}
        </div>

        {/* 浮动按钮（停靠态显示；浮动态由浮层标题栏提供停靠入口） */}
        {!aiFloating && (
          <button
            onClick={() => setUiState({ aiFloating: true })}
            className="shrink-0 px-2.5 flex items-center border-l border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-300 hover:text-[#4F6BED] dark:hover:text-[#4F6BED] hover:bg-zinc-100 dark:hover:bg-[#252829] transition-colors"
            title="浮动为独立窗口"
            data-testid="assistant-float"
          >
            <PictureInPicture2 className="w-3.5 h-3.5" />
          </button>
        )}

        {/* 新会话（tabs 栏右端常驻）：切新任务态，首条消息建会话 */}
        <button
          onClick={() => useConversationStore.getState().createNew()}
          disabled={!configured}
          className="shrink-0 px-2.5 flex items-center border-l border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-300 hover:text-[#4F6BED] dark:hover:text-[#4F6BED] hover:bg-zinc-100 dark:hover:bg-[#252829] transition-colors disabled:opacity-40"
          title={configured ? '新会话' : '配置模型后可用'}
          data-testid="new-session"
        >
          <MessageCirclePlus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* ── 消息流 ── */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-5 py-5"
      >
        {messages.length === 0 && configured && (
          <div className="h-full flex flex-col items-center justify-center text-zinc-400 dark:text-zinc-600 gap-2">
            <span className="text-[13px]">描述一个业务任务开始工作</span>
            <span className="text-[11px] text-zinc-400 dark:text-zinc-600">
              例如：查询已提交的订单，给南洋实业的订单走审批流程
            </span>
          </div>
        )}
        {messages.length === 0 && !configured && (
          <div className="h-full flex flex-col items-center justify-center text-zinc-400 dark:text-zinc-600 gap-1.5">
            <span className="text-[13px]">模型尚未配置</span>
            <span className="text-[11px]">
              点击下方输入框「去配置」打开模型设置
            </span>
          </div>
        )}
        {messages.map((msg, i) => {
          const prev = i > 0 ? messages[i - 1] : null;
          const gap = !prev ? '' : prev.role === msg.role ? 'mt-2' : 'mt-5';
          return (
            <div key={msg.id} className={gap}>
              <MessageBubble msg={msg} />
            </div>
          );
        })}
      </div>

      <AssistantInput />
      <SessionInfoPanel />
    </div>
  );
}
