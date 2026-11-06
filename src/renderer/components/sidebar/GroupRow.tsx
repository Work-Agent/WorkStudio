/**
 * GroupRow —— 主列表分组行 + 打开项聚拢卡片（architecture.md §2.3）。
 *
 * 有打开项时：分组头 + 展开项包裹在同一背景卡片内（聚拢语义）；
 * 收起态：仅隐藏文字块（图标/间距/行高/卡片结构与展开态一致，图标不跳动）。
 */
import { useState, type ComponentType, type ReactNode } from 'react';
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
      className={`group relative flex items-center px-2 py-[5px] min-h-[45px] cursor-pointer hover:bg-[var(--biz-surface)] dark:hover:bg-[var(--biz-surface)] transition-colors rounded-lg ${
        active ? 'bg-[var(--biz-surface)] bg-[var(--biz-surface)]' : ''
      }`}
    >
      {active && (
        <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-[var(--biz-accent)] rounded-r" />
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
            <h4 className="text-[12px] font-semibold text-[var(--biz-text)] truncate leading-none">
              {title}
            </h4>
          </div>
          <div className="flex justify-between items-center mt-[5px]">
            <p
              className={`text-[12px] truncate text-[var(--biz-text-muted)] leading-none ${countLabelClass ?? ''}`}
            >
              {label}
            </p>
            <span className="text-[11px] text-[var(--biz-text-muted)] shrink-0 leading-none">
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
    <div className="rounded-lg bg-[var(--biz-surface)] overflow-hidden">
      <div className="rounded-t-lg">{header}</div>
      {activeRow}
    </div>
  );
}
