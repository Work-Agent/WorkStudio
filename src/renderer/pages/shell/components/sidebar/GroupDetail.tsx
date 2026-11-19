/**
 * GroupDetail —— 资源二级列表（按 ListGroup 渲染）。
 *
 * 与主列表共享同一份 ListSnapshot：返回主列表、行点击经 list.action。
 */
import { useState } from 'react';
import {
  Database,
  FileText,
  FolderOpen,
  Globe,
  Hourglass,
  type LucideIcon,
} from 'lucide-react';
import type { ListGroup, ListItem } from '../../../../../shared/lists.ts';
import { openListItem } from '../../../../shared/domains/lists.ts';
import { notifyError } from '../../../../shared/domains/notices.ts';
import { useScene } from '../../domains/scene.ts';
import { rendererIcon } from '../titlebar/icons.ts';
import { EmptyState, SubListView } from './SubListView.tsx';
import { formatTime } from './time.ts';

const ICONS: Record<string, LucideIcon> = {
  folder: FolderOpen,
  globe: Globe,
  hourglass: Hourglass,
  database: Database,
};

async function activate(item: ListItem): Promise<void> {
  // 列表行可以声明「不可打开」（例：没有配置页的插件行）：
  // 灰掉并给出行内原因，而不是发一次必定失败的打开请求。
  if (item.state?.disabled === true) return;
  try {
    await openListItem(item);
  } catch (error) {
    notifyError(error instanceof Error ? error.message : String(error), 'open');
  }
}

function itemTime(item: ListItem): number {
  const value = item.meta?.['updatedAt'];
  return typeof value === 'number' ? value : 0;
}

function ItemRow({ item, group }: { item: ListItem; group: ListGroup }) {
  const { scene } = useScene();
  const collapsed = scene.sidebarCollapsed ?? false;
  const [iconBroken, setIconBroken] = useState(false);
  const source = String(item.meta?.['source'] ?? '');
  const isWeb = source === 'web';
  const isData = item.itemType === 'data';
  const iconUrl =
    item.icon ??
    (isWeb && /^(data:|https?:)/.test(group.icon ?? '')
      ? group.icon
      : undefined);
  const semantic =
    item.icon && !/^(data:|https?:|app:)/.test(item.icon)
      ? rendererIcon(item.icon)
      : null;
  const Icon =
    semantic ??
    (isData
      ? Database
      : isWeb
        ? Globe
        : (ICONS[group.icon ?? 'folder'] ?? FileText));
  const active = item.state?.active === true;
  const disabled = item.state?.disabled === true;
  const time = itemTime(item);
  return (
    <div
      onClick={() => void activate(item)}
      className={`group relative flex items-center px-2 py-1.5 rounded-lg transition-colors min-h-[42px] ${
        disabled
          ? 'cursor-not-allowed opacity-50'
          : 'cursor-pointer hover:bg-zinc-200 dark:hover:bg-[#2a2c2d]'
      } ${active ? '' : ''}`}
      title={disabled ? `${item.title}（无可用入口）` : item.title}
      aria-disabled={disabled || undefined}
    >
      {active && (
        <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-[#4F6BED] rounded-r" />
      )}
      <div
        className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center overflow-hidden ${
          group.tone && group.section !== 'resources'
            ? group.tone
            : isData
              ? 'bg-teal-100 dark:bg-[#1a2a25] text-teal-600 dark:text-teal-500'
              : isWeb
                ? 'bg-sky-100 dark:bg-[#1a2430] text-sky-600 dark:text-sky-500'
                : 'bg-zinc-200 dark:bg-[#32363a] text-zinc-500 dark:text-zinc-400'
        }`}
      >
        {iconUrl && !iconBroken ? (
          <img
            src={iconUrl}
            alt=""
            className="w-full h-full object-contain p-1"
            onError={() => setIconBroken(true)}
          />
        ) : (
          <Icon className="w-4 h-4" />
        )}
      </div>
      <div className="ml-2 flex-1 overflow-hidden min-w-0">
        {!collapsed && (
          <>
            <h4 className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100 truncate leading-none">
              {item.title}
            </h4>
            <div className="flex items-center justify-between mt-[5px]">
              <span className="text-[12px] truncate text-zinc-400 dark:text-zinc-500 leading-none">
                {isData
                  ? 'schema-only · 数据经工具查询'
                  : (item.subtitle ?? '')}
              </span>
              {time > 0 && (
                <span className="text-[11px] text-zinc-400 dark:text-zinc-500 shrink-0 ml-1.5">
                  {formatTime(time)}
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function GroupDetail({
  group,
  onBack,
}: {
  group: ListGroup;
  onBack: () => void;
}) {
  const Icon = ICONS[group.icon ?? 'folder'] ?? FolderOpen;
  return (
    <SubListView title={group.label} count={group.count} onBack={onBack}>
      {group.state === 'error' ? (
        <div
          className="px-2 py-2 text-[11px] text-red-500"
          title={group.diagnostics?.join('\n')}
        >
          列表加载失败
        </div>
      ) : group.items.length === 0 ? (
        <EmptyState
          icon={Icon}
          text={group.empty?.text ?? `暂无${group.label}`}
        />
      ) : (
        group.items.map((item) => (
          <ItemRow key={item.key} item={item} group={group} />
        ))
      )}
    </SubListView>
  );
}
