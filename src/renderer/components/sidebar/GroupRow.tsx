/**
 * GroupRow —— 主列表分组行 + 打开项聚拢卡片（views-design.md §12.3）。
 *
 * 有打开项时：分组头 + 展开项包裹在同一背景卡片内（聚拢语义）；
 * 收起态：仅隐藏文字块（图标/间距/行高/卡片结构与展开态一致，图标不跳动）。
 */
import { useState, type ComponentType, type ReactNode } from 'react';
import { Pin } from 'lucide-react';
import { formatTime } from './time';

export function GroupRow({
  title,
  icon: Icon,
  iconUrl,
  groupKey,
  bg,
  count,
  countLabel,
  countLabelClass,
  latest,
  pinned,
  onTogglePin,
  onClick,
  active,
  activeRow,
  collapsed,
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  /** 图片图标（域 favicon data-url）；提供时优先于 lucide 图标。 */
  iconUrl?: string;
  groupKey?: string;
  bg: string;
  count: number;
  countLabel?: string;
  countLabelClass?: string;
  latest: number;
  pinned: boolean;
  onTogglePin: () => void;
  onClick: () => void;
  active?: boolean;
  activeRow: ReactNode;
  /** 收起态：仅隐藏文字块，图标、内边距、行高、卡片全部与展开态一致。 */
  collapsed?: boolean;
}) {
  /** 图片加载失败（站无 favicon / 字节非法）→ 回退 lucide 图标。 */
  const [iconBroken, setIconBroken] = useState(false);
  const showImage = !!iconUrl && !iconBroken;
  const label = countLabel ?? (count > 0 ? `${count} 项` : '暂无');

  const header = (
    <div
      onClick={onClick}
      data-testid="sidebar-group"
      data-group={groupKey}
      className={`group relative flex items-center px-2 py-[5px] min-h-[45px] cursor-pointer hover:bg-zinc-200/60 dark:hover:bg-[#2a2d2e] transition-colors rounded-lg ${
        active ? 'bg-zinc-200/60 dark:bg-[#2a2d2e]' : ''
      }`}
    >
      {active && (
        <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-[#4F6BED] rounded-r" />
      )}
      <div
        className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center overflow-hidden ${bg}`}
      >
        {showImage ? (
          <img
            src={iconUrl}
            alt=""
            className="w-full h-full object-contain p-1"
            onError={() => setIconBroken(true)}
          />
        ) : (
          <Icon className="w-4.5 h-4.5" />
        )}
      </div>
      {/* 文字块：展开态显示；收起态隐藏（图标/间距不变） */}
      {!collapsed && (
        <div className="ml-2 flex-1 overflow-hidden min-w-0">
          <div className="flex justify-between items-center gap-1">
            <h4 className="text-[12px] font-semibold text-zinc-900 dark:text-zinc-100 truncate leading-none">
              {title}
            </h4>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onTogglePin();
              }}
              title={pinned ? '取消顶置' : '顶置分组'}
              className={`shrink-0 p-0.5 rounded transition-opacity ${
                pinned
                  ? 'text-[#4F6BED] opacity-100'
                  : 'text-zinc-300 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400 opacity-0 group-hover:opacity-100'
              }`}
            >
              <Pin className={`w-3.5 h-3.5 ${pinned ? 'fill-current' : ''}`} />
            </button>
          </div>
          <div className="flex justify-between items-center mt-[5px]">
            <p
              className={`text-[12px] truncate text-zinc-400 dark:text-zinc-500 leading-none ${countLabelClass ?? ''}`}
            >
              {label}
            </p>
            <span className="text-[11px] text-zinc-400 dark:text-zinc-500 shrink-0 leading-none">
              {latest > 0 ? formatTime(latest) : '—'}
            </span>
          </div>
        </div>
      )}
    </div>
  );

  if (!activeRow) {
    return <div className="rounded-lg">{header}</div>;
  }
  return (
    <div className="rounded-lg bg-zinc-200/60 dark:bg-[#2a2d2e] overflow-hidden">
      <div className="rounded-t-lg">{header}</div>
      {activeRow}
    </div>
  );
}
