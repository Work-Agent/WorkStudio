/**
 * OpenItem —— 主列表分组下方的打开项行（architecture.md §2.3）。
 *
 * 「被打开 ≠ 当前」：多值展开项全部渲染，仅当前项带左缘靛蓝竖条 + 头像高亮；
 * 点击 → 切换为当前（不新增打开）；× = 关闭标签（≠ 删除）。
 * streaming 会话：图标区走状态过渡（旋转 → ✓ 完成动画 → 回 X）。
 */
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { useUiStore } from '../../state/ui';
import { SessionStatusAction } from './SessionStatusAction';

export function OpenItem({
  icon,
  avatar,
  label,
  meta,
  active,
  onClick,
  onClose,
  testId,
  isStreaming,
  justSettled,
  onStop,
}: {
  icon?: ReactNode;
  avatar?: string;
  label: string;
  meta?: string;
  active?: boolean;
  onClick?: () => void;
  onClose?: () => void;
  testId?: string;
  isStreaming?: boolean;
  justSettled?: boolean;
  onStop?: () => void;
}) {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  return (
    <div
      data-testid={testId}
      data-active={active ? 'true' : 'false'}
      onClick={onClick}
      className={`group relative flex items-center px-2 py-1.5 cursor-pointer transition-colors min-h-[42px] ${
        active
          ? ''
          : 'hover:bg-[var(--biz-surface)] dark:hover:bg-[var(--biz-surface)]'
      }`}
      title={label}
    >
      {active && (
        <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-[var(--biz-accent)] rounded-r" />
      )}
      {avatar ? (
        <span
          className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-medium ${
            active
              ? 'bg-[var(--biz-surface)] dark:bg-[var(--biz-surface-hover)] text-[var(--biz-text-muted)] text-[var(--biz-text)]'
              : 'bg-[var(--biz-surface)] text-[var(--biz-text-muted)] text-[var(--biz-text-muted)]'
          }`}
        >
          {avatar}
        </span>
      ) : (
        <span className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-[var(--biz-surface)] text-[var(--biz-text-muted)]">
          {icon}
        </span>
      )}
      <div className="ml-2 flex-1 overflow-hidden min-w-0">
        {!collapsed && (
          <>
            <div className="flex justify-between items-center gap-1">
              <span className="text-[13px] font-medium text-[var(--biz-text)] truncate leading-none">
                {label}
              </span>
            </div>
            {meta && (
              <div className="flex justify-between items-center mt-[5px]">
                <span className="text-[12px] truncate text-[var(--biz-text-muted)] leading-none">
                  {meta}
                </span>
              </div>
            )}
          </>
        )}
      </div>
      {onClose && (
        <SessionStatusAction
          isStreaming={isStreaming ?? false}
          justSettled={justSettled}
          IdleIcon={X}
          onIdle={() => onClose()}
          idleTitle="关闭标签"
          onStop={onStop}
        />
      )}
    </div>
  );
}
