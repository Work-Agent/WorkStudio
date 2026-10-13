/**
 * OpenItem —— 主列表分组下方的打开项行（ui-design.md §4.4）。
 *
 * 「被打开 ≠ 当前」：多值展开项全部渲染，仅当前项带左缘靛蓝竖条 + 头像高亮；
 * 点击 → 切换为当前（不新增打开）；× = 关闭标签（≠ 删除）。
 * streaming 会话：图标区走状态过渡（旋转 → ✓ 完成动画 → 回 X）。
 */
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { useUiStore } from '../../state/uiState';
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
        active ? '' : 'hover:bg-zinc-200 dark:hover:bg-[#2a2c2d]'
      }`}
      title={label}
    >
      {active && (
        <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-[#4F6BED] rounded-r" />
      )}
      {avatar ? (
        <span
          className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-medium ${
            active
              ? 'bg-zinc-300 dark:bg-[#3a3d3e] text-zinc-600 dark:text-zinc-300'
              : 'bg-zinc-200 dark:bg-[#32363a] text-zinc-500 dark:text-zinc-400'
          }`}
        >
          {avatar}
        </span>
      ) : (
        <span className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-zinc-200 dark:bg-[#32363a] text-zinc-500 dark:text-zinc-400">
          {icon}
        </span>
      )}
      <div className="ml-2 flex-1 overflow-hidden min-w-0">
        {!collapsed && (
          <>
            <div className="flex justify-between items-center gap-1">
              <span className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100 truncate leading-none">
                {label}
              </span>
            </div>
            {meta && (
              <div className="flex justify-between items-center mt-[5px]">
                <span className="text-[12px] truncate text-zinc-400 dark:text-zinc-500 leading-none">
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
