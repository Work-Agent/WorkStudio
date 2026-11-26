/**
 * ResourceTree —— 资源侧栏森林。
 *
 * 每个 ResourceGroup 是一棵树；整个侧栏是森林。
 * 分组、目录可折叠，文件/条目点击走 workspace/<wsId>/resources 的 open action。
 */
import { useState } from 'react';
import {
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Globe,
  X,
} from 'lucide-react';
import type {
  ResourceGroup,
  ResourceNode,
} from '../../../../../shared/resources.ts';
import { command } from '../../../../shared/api/bridge.ts';
import { openResourceNode } from '../../../../shared/domains/resources.ts';
import { notifyError } from '../../../../shared/domains/notices.ts';
import { useActiveWorkspaceId } from '../../domains/windows.ts';
import { groupIconOf } from './groupIcon.ts';
import { formatTime } from './time.ts';

function openNode(node: ResourceNode): void {
  if (node.state?.disabled === true) return;
  void openResourceNode(node).catch((error: unknown) =>
    notifyError(error instanceof Error ? error.message : String(error), 'open'),
  );
}

function closeNode(node: ResourceNode, wsId: string | null): void {
  const viewId = node.meta?.['viewId'];
  if (typeof viewId === 'string' && wsId) {
    void command('shell', `${wsId}/views`, 'close', { id: viewId }).catch(
      () => undefined,
    );
  }
}

function NodeIcon({
  node,
  group,
  expanded,
}: {
  node: ResourceNode;
  group: ResourceGroup;
  expanded: boolean;
}) {
  if (node.type === 'dir') {
    return expanded ? (
      <FolderOpen className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
    ) : (
      <Folder className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
    );
  }
  if (String(node.meta?.['source'] ?? '') === 'web') {
    return <Globe className="w-4 h-4 text-zinc-400 dark:text-zinc-500" />;
  }
  if (group.definitionId === 'settings') {
    return <FileText className="w-4 h-4 text-zinc-400 dark:text-zinc-500" />;
  }
  return <FileText className="w-4 h-4 text-zinc-400 dark:text-zinc-500" />;
}

function NodeRow({
  node,
  group,
  depth,
  wsId,
  expanded,
  onToggle,
}: {
  node: ResourceNode;
  group: ResourceGroup;
  depth: number;
  wsId: string | null;
  expanded: (key: string, fallback: boolean) => boolean;
  onToggle: (key: string, next: boolean) => void;
}) {
  const branch = node.type === 'dir' && Boolean(node.children?.length);
  const isOpen = branch ? expanded(`n:${node.key}`, false) : false;
  const active = node.state?.active === true;
  const opened = node.state?.open === true;
  const indent = 8 + depth * 12;

  return (
    <div role="treeitem" aria-expanded={branch ? isOpen : undefined}>
      <div
        data-testid={
          node.type === 'dir' ? 'sidebar-tree-dir' : 'sidebar-tree-item'
        }
        onClick={() =>
          branch ? onToggle(`n:${node.key}`, !isOpen) : openNode(node)
        }
        className={`group relative flex items-center pr-1.5 min-h-[32px] rounded-md cursor-pointer transition-colors ${
          active
            ? 'bg-zinc-200/70 dark:bg-[#2a2d2e]'
            : 'hover:bg-zinc-200/60 dark:hover:bg-[#2a2d2e]'
        }`}
        style={{ paddingLeft: indent }}
        title={node.title}
      >
        {active && (
          <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-[#4F6BED] rounded-r" />
        )}
        <span className="shrink-0 w-4 flex items-center justify-center">
          {branch && (
            <ChevronRight
              className={`w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500 transition-transform ${
                isOpen ? 'rotate-90' : ''
              }`}
            />
          )}
        </span>
        <span className="shrink-0 w-5 flex items-center justify-center">
          <NodeIcon node={node} group={group} expanded={isOpen} />
        </span>
        <span className="ml-1.5 flex-1 min-w-0 truncate text-[13px] text-zinc-700 dark:text-zinc-200">
          {node.title}
        </span>
        {node.badge && (
          <span className="ml-1 shrink-0 rounded bg-zinc-100 px-1 text-[10px] text-zinc-500 dark:bg-[#23272a] dark:text-zinc-400">
            {node.badge}
          </span>
        )}
        {node.type === 'item' && opened && (
          <button
            type="button"
            title="关闭"
            onClick={(event) => {
              event.stopPropagation();
              closeNode(node, wsId);
            }}
            className="ml-1 shrink-0 w-5 h-5 rounded flex items-center justify-center text-zinc-400 opacity-0 group-hover:opacity-100 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {branch && isOpen && (
        <div role="group">
          {node.children?.map((child) => (
            <NodeRow
              key={child.key}
              node={child}
              group={group}
              depth={depth + 1}
              wsId={wsId}
              expanded={expanded}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function GroupIcon({ group }: { group: ResourceGroup }) {
  const { Icon, iconUrl } = groupIconOf(group);
  if (iconUrl) {
    return <img src={iconUrl} alt="" className="w-4 h-4 object-contain" />;
  }
  return <Icon className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />;
}

function GroupBlock({
  group,
  wsId,
  expanded,
  onToggle,
}: {
  group: ResourceGroup;
  wsId: string | null;
  expanded: (key: string, fallback: boolean) => boolean;
  onToggle: (key: string, next: boolean) => void;
}) {
  const key = `g:${group.id}`;
  const isOpen = expanded(key, true);
  return (
    <div role="treeitem" aria-expanded={isOpen} data-group={group.id}>
      <div
        data-testid="sidebar-tree-group"
        data-group={group.id}
        onClick={() => onToggle(key, !isOpen)}
        className="group relative flex items-center min-h-[32px] rounded-md cursor-pointer px-1.5 transition-colors hover:bg-zinc-200/60 dark:hover:bg-[#2a2d2e]"
      >
        <span className="shrink-0 w-4 flex items-center justify-center">
          <ChevronRight
            className={`w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500 transition-transform ${
              isOpen ? 'rotate-90' : ''
            }`}
          />
        </span>
        <span className="shrink-0 w-5 flex items-center justify-center">
          <GroupIcon group={group} />
        </span>
        <span className="ml-1.5 flex-1 min-w-0 truncate text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">
          {group.label}
        </span>
        <span className="ml-1 shrink-0 text-[11px] text-zinc-400 dark:text-zinc-500">
          {group.countLabel}
        </span>
        {group.updatedAt > 0 && (
          <span className="ml-1.5 shrink-0 text-[11px] text-zinc-400 dark:text-zinc-500">
            {formatTime(group.updatedAt)}
          </span>
        )}
      </div>
      {isOpen && (
        <div role="group">
          {group.state === 'error' ? (
            <div
              className="px-2 py-2 text-[11px] text-red-500"
              title={group.diagnostics?.join('\n')}
            >
              列表加载失败
            </div>
          ) : group.roots.length === 0 ? (
            <div className="px-2 py-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
              {group.empty?.text ?? `暂无${group.label}`}
            </div>
          ) : (
            group.roots.map((node) => (
              <NodeRow
                key={node.key}
                node={node}
                group={group}
                depth={1}
                wsId={wsId}
                expanded={expanded}
                onToggle={onToggle}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function ResourceTree({
  groups,
  collapsed = false,
}: {
  groups: ResourceGroup[];
  collapsed?: boolean;
}) {
  const wsId = useActiveWorkspaceId();
  const [state, setState] = useState<Record<string, boolean>>({});
  const expanded = (key: string, fallback: boolean): boolean =>
    state[key] ?? fallback;
  const onToggle = (key: string, next: boolean): void => {
    setState((current) => ({ ...current, [key]: next }));
  };
  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1">
        {groups.map((group) => (
          <div
            key={group.id}
            data-testid="sidebar-tree-group"
            data-group={group.id}
            title={group.label}
            className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-[#2a2d2e]"
          >
            <GroupIcon group={group} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div role="tree" className="space-y-0.5">
      {groups.map((group) => (
        <GroupBlock
          key={group.id}
          group={group}
          wsId={wsId}
          expanded={expanded}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}
