/**
 * ListHost —— 按 ListSnapshot 渲染分组、行与状态（Phase 4）。
 *
 * 行模板只消费 ListItem；未知 itemType 回落通用行。
 */

import {
  FileText,
  FolderOpen,
  Globe,
  Hourglass,
  MessagesSquare,
  Package,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import type { ListGroup, ListItem } from '../../../shared/lists';
import { useUiStore } from '../../state/ui';

const ICONS: Record<string, LucideIcon> = {
  folder: FolderOpen,
  globe: Globe,
  hourglass: Hourglass,
  messages: MessagesSquare,
  package: Package,
  sliders: Settings,
};

function iconFor(item: ListItem): LucideIcon {
  if (item.itemType === 'session') return MessagesSquare;
  if (item.itemType === 'plugin') return Package;
  if (item.itemType === 'settings') return Settings;
  if (item.itemType === 'link') return Hourglass;
  if (item.meta?.['source'] === 'web') return Globe;
  return FileText;
}

async function activate(item: ListItem): Promise<void> {
  await window.workbench?.cmd('list.action', { action: 'open', item });
}

function Row({ item, collapsed }: { item: ListItem; collapsed: boolean }) {
  const semantic = item.icon && !/^(data:|https?:|app:)/.test(item.icon);
  const Icon = semantic ? (ICONS[item.icon!] ?? iconFor(item)) : iconFor(item);
  const active = item.state?.active === true;
  return (
    <div
      onClick={() => void activate(item)}
      className="group relative flex items-center px-2 py-1.5 rounded-lg cursor-pointer hover:bg-zinc-200 dark:hover:bg-[#2a2c2d] transition-colors min-h-[42px]"
      title={item.title}
    >
      {active && (
        <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-[#4F6BED] rounded-r" />
      )}
      <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center overflow-hidden bg-zinc-200 dark:bg-[#32363a]">
        {item.icon && !semantic ? (
          <img src={item.icon} alt="" className="w-5 h-5 object-contain" />
        ) : (
          <Icon className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
        )}
      </div>
      {!collapsed && (
        <div className="ml-2 flex-1 overflow-hidden min-w-0">
          <div className="flex items-center gap-1.5">
            <h4 className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100 truncate leading-none">
              {item.title}
            </h4>
            {item.badge && (
              <span className="text-[9px] text-zinc-400 dark:text-zinc-500 shrink-0">
                {item.badge}
              </span>
            )}
          </div>
          {item.subtitle && (
            <div className="mt-[5px] text-[12px] truncate text-zinc-400 dark:text-zinc-500 leading-none">
              {item.subtitle}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ListHost({ groups }: { groups: ListGroup[] }) {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const visible = groups.filter(
    (group) =>
      group.items.length > 0 ||
      group.state === 'loading' ||
      group.state === 'error' ||
      group.empty !== undefined,
  );
  return (
    <div className="space-y-2">
      {visible.map((group) => {
        const Icon = ICONS[group.icon ?? 'folder'] ?? FolderOpen;
        return (
          <section key={group.id}>
            {!collapsed && (
              <div className="flex items-center gap-1.5 px-2 pt-1 pb-0.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                <Icon className="w-3.5 h-3.5" />
                <span className="truncate">{group.label}</span>
                <span className="ml-auto text-[10px] text-zinc-400 dark:text-zinc-500">
                  {group.count}
                </span>
              </div>
            )}
            {group.state === 'error' ? (
              <div className="px-2 py-1 text-[11px] text-red-500">
                列表加载失败
              </div>
            ) : group.items.length === 0 ? (
              <div className="px-2 py-1 text-[11px] text-zinc-400 dark:text-zinc-600 italic">
                {group.empty?.text ?? '暂无'}
              </div>
            ) : (
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <Row key={item.key} item={item} collapsed={collapsed} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
