/**
 * SubListView —— 二级列表容器（返回主列表键 + 标题 + 计数）与空态。
 * 收起态同样仅隐藏文字（返回键图标保留）。
 */
import type { ComponentType, ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useUiStore } from '../../state/ui';

export function SubListView({
  title,
  count,
  onBack,
  children,
}: {
  title: string;
  count: number;
  onBack: () => void;
  children: ReactNode;
}) {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  return (
    <div>
      <button
        type="button"
        data-testid="sidebar-back"
        onClick={onBack}
        className="w-full flex items-center gap-1 px-1.5 py-1.5 min-h-[30px] rounded-md hover:bg-[var(--biz-surface)] dark:hover:bg-[var(--biz-surface-hover)] transition-colors text-[var(--biz-text)]"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        {!collapsed && (
          <>
            <span className="text-[12px] font-medium">{title}</span>
            <span className="text-[10px] text-[var(--biz-text-muted)] ml-1">
              {count}
            </span>
          </>
        )}
      </button>
      <div className="mt-0.5 space-y-0.5">{children}</div>
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  text,
}: {
  icon: ComponentType<{ className?: string }>;
  text: string;
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-[var(--biz-text-muted)] text-[12px] px-4 text-center gap-1.5">
      <Icon className="w-5 h-5 opacity-60" />
      <span>{text}</span>
    </div>
  );
}
