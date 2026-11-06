/**
 * TabsBar —— 中栏统一标签栏（architecture.md §2.4）。
 *
 * 纯视图（不触达宿主）：滚动 / 激活标 / 脏点 / 错误标 / 固定 Pin / 拖拽排序 /
 * 右键菜单（关闭族 + 固定/取消固定）。集合语义在主进程，本组件只回调。
 */
import { useEffect, useRef, useState, type ComponentType } from 'react';
import { ChevronLeft, ChevronRight, Pin, Plus, X } from 'lucide-react';
import type { PopupMenuItem } from '../../../shared/types';
import { popupMenu } from '../../api/runtime';
import { displayPath } from '../../api/pathDisplay';

export interface TabsBarItem {
  id: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  /** 徽章（如待办数；>0 显示）。 */
  badge?: number;
  /** 脏点（未保存时显示；冲突时变红）。 */
  dirty?: boolean;
  /** 文件已删除或重命名（名称删除线 + 红色）。 */
  missing?: boolean;
  /** 未保存且外部内容已变化。 */
  conflict?: boolean;
  /** 固定（显示 Pin，稳定排在未固定之前）。 */
  pinned?: boolean;
  /** 生命周期 error（红色错误标，点击重试）。 */
  error?: boolean;
}

/** 右键菜单批量关闭回调集（提供哪些就显示哪些菜单项）。 */
export interface TabsBarBulkClose {
  closeOthers?: (id: string) => void;
  closeLeft?: (id: string) => void;
  closeRight?: (id: string) => void;
  closeAll?: () => void;
}

/** popup 菜单 source 标识（多菜单源共存时路由回正确处理器）。 */
const MENU_SOURCE = 'tabs';

export function TabsBar({
  items,
  active,
  onSelect,
  onClose,
  bulkClose,
  onTogglePin,
  onMove,
  onRetry,
  onAdd,
  testId,
}: {
  items: TabsBarItem[];
  active: string;
  onSelect: (id: string) => void;
  onClose?: (id: string) => void;
  bulkClose?: TabsBarBulkClose;
  /** 固定/取消固定（提供时右键菜单出现对应项）。 */
  onTogglePin?: (id: string) => void;
  /** 拖拽排序（仅同组内换位；集合侧保证）。 */
  onMove?: (fromId: string, toId: string) => void;
  /** error 状态点击重试。 */
  onRetry?: (id: string) => void;
  /** 新增标签（欢迎页 / 新建文件）。 */
  onAdd?: () => void;
  testId?: string;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  const updateScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 2);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  };

  const scrollByAmount = (dir: 1 | -1): void => {
    scrollRef.current?.scrollBy({ left: dir * 180, behavior: 'smooth' });
  };

  /** 激活 tab 自动滚入视野。 */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !active) return;
    el.querySelector(`[data-tab="${CSS.escape(active)}"]`)?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    });
  }, [active]);

  /** 右键菜单项（按回调存在性 + 锚点位置条件禁用）；actionId 编码锚点。 */
  const menuItemsFor = (anchorId: string): PopupMenuItem[] => {
    const idx = items.findIndex((i) => i.id === anchorId);
    const item = items[idx];
    const list: PopupMenuItem[] = [];
    if (onClose) list.push({ id: `close:${anchorId}`, label: '关闭' });
    if (bulkClose?.closeOthers)
      list.push({
        id: `closeOthers:${anchorId}`,
        label: '关闭其他',
        disabled: items.length <= 1,
      });
    if (bulkClose?.closeAll) list.push({ id: 'closeAll', label: '关闭全部' });
    if (bulkClose?.closeLeft)
      list.push({
        id: `closeLeft:${anchorId}`,
        label: '关闭左侧',
        disabled: idx <= 0,
      });
    if (bulkClose?.closeRight)
      list.push({
        id: `closeRight:${anchorId}`,
        label: '关闭右侧',
        disabled: idx < 0 || idx >= items.length - 1,
      });
    if (onTogglePin && item) {
      list.push({
        id: `togglePin:${anchorId}`,
        label: item.pinned ? '取消固定' : '固定标签页',
      });
    }
    return list;
  };

  const openMenu = (anchorId: string): void => {
    const list = menuItemsFor(anchorId);
    if (list.length === 0) return;
    void popupMenu.show({ source: MENU_SOURCE, items: list });
  };

  useEffect(() => {
    updateScroll();
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => updateScroll());
    ro.observe(el);
    el.addEventListener('scroll', updateScroll, { passive: true });
    const offSelect = popupMenu.onSelect((e) => {
      if (e.source !== MENU_SOURCE) return;
      const [action, id] = e.actionId.split(':');
      if (action === 'close' && id) onClose?.(id);
      else if (action === 'closeOthers' && id) bulkClose?.closeOthers?.(id);
      else if (action === 'closeLeft' && id) bulkClose?.closeLeft?.(id);
      else if (action === 'closeRight' && id) bulkClose?.closeRight?.(id);
      else if (action === 'closeAll') bulkClose?.closeAll?.();
      else if (action === 'togglePin' && id) onTogglePin?.(id);
    });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', updateScroll);
      offSelect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, onClose, bulkClose, onTogglePin]);

  return (
    <div className="h-9 shrink-0 flex items-stretch bg-[var(--biz-surface)] border-b border-[var(--biz-border)] select-none">
      <button
        onClick={() => scrollByAmount(-1)}
        disabled={!canLeft}
        className="w-8 shrink-0 flex items-center justify-center border-r border-[var(--biz-border)] text-[var(--biz-text-muted)] hover:bg-[var(--biz-surface)] dark:hover:bg-[var(--biz-surface-hover)] disabled:opacity-30 disabled:cursor-default transition-colors"
        title="向左滚动"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>

      <div
        ref={scrollRef}
        className="flex flex-1 items-stretch overflow-x-auto min-w-0 tab-scroll"
        data-testid={testId}
      >
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = item.id === active;
          const isDragging = dragId === item.id;
          return (
            <div
              key={item.id}
              data-tab={item.id}
              draggable={!!onMove}
              onDragStart={(e) => {
                setDragId(item.id);
                e.dataTransfer.setData('text/plain', item.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => {
                if (onMove && dragId) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                const fromId = e.dataTransfer.getData('text/plain') || dragId;
                if (fromId && fromId !== item.id) onMove?.(fromId, item.id);
                setDragId(null);
              }}
              onClick={() => onSelect(item.id)}
              onContextMenu={(e) => {
                if (!onClose && !bulkClose && !onTogglePin) return;
                e.preventDefault();
                openMenu(item.id);
              }}
              title={
                item.missing
                  ? `${displayPath(item.label)}（文件已被删除或重命名）`
                  : displayPath(item.label)
              }
              className={`group relative flex items-center justify-center gap-1.5 px-5 shrink-0 cursor-pointer border-r border-[var(--biz-border)] transition-colors min-w-0 max-w-32 ${
                isActive
                  ? 'bg-[var(--biz-surface)] text-[var(--biz-text)] text-[var(--biz-text)]'
                  : 'text-[var(--biz-text-muted)] hover:bg-[var(--biz-surface)] dark:hover:bg-[var(--biz-surface-hover)] hover:text-[var(--biz-text)] dark:hover:text-[var(--biz-text)]'
              } ${isDragging ? 'opacity-50' : ''}`}
            >
              {isActive && (
                <span className="absolute inset-x-0 top-0 h-0.5 bg-[var(--biz-accent)] rounded-b" />
              )}
              {Icon && (
                <span className="absolute left-1.5 top-1/2 -translate-y-1/2 shrink-0">
                  <Icon className="w-3 h-3 text-[var(--biz-text-muted)]" />
                </span>
              )}
              <span className="text-[12px] whitespace-nowrap truncate min-w-0 flex-1 text-center flex items-center justify-center gap-1">
                {item.pinned && (
                  <Pin className="w-3 h-3 shrink-0 text-[var(--biz-text-muted)]" />
                )}
                {item.dirty && (
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      item.conflict ? 'bg-red-500' : 'bg-amber-500'
                    }`}
                    title={item.conflict ? '未保存；外部内容已修改' : '未保存'}
                  />
                )}
                {item.error && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRetry?.(item.id);
                    }}
                    className="w-2 h-2 rounded-full bg-red-500 shrink-0 hover:bg-red-400"
                    title="加载失败，点击重试"
                  />
                )}
                <span
                  className={`truncate ${
                    item.missing
                      ? 'line-through text-red-500 dark:text-red-400'
                      : ''
                  }`}
                >
                  {displayPath(item.label)}
                </span>
                {(item.badge ?? 0) > 0 && (
                  <span className="px-1.5 py-0.5 text-[10px] font-medium bg-[var(--biz-accent)] text-[var(--biz-primary-ink)] rounded-full shrink-0">
                    {item.badge}
                  </span>
                )}
              </span>
              {onClose && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(item.id);
                  }}
                  className="absolute right-0.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-[var(--biz-text-muted)] hover:text-red-500 hover:bg-[var(--biz-surface)] dark:hover:bg-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="关闭"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <button
        onClick={() => scrollByAmount(1)}
        disabled={!canRight}
        className="w-8 shrink-0 flex items-center justify-center border-l border-[var(--biz-border)] text-[var(--biz-text-muted)] hover:bg-[var(--biz-surface)] dark:hover:bg-[var(--biz-surface-hover)] disabled:opacity-30 disabled:cursor-default transition-colors"
        title="向右滚动"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
      {onAdd && (
        <button
          onClick={onAdd}
          className="w-8 shrink-0 flex items-center justify-center border-l border-[var(--biz-border)] text-[var(--biz-text-muted)] hover:bg-[var(--biz-surface)] dark:hover:bg-[var(--biz-surface-hover)] transition-colors"
          title="新增"
        >
          <Plus className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
