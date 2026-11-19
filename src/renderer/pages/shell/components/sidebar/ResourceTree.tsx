/**
 * ResourceTree —— 资源侧栏树。
 *
 * 分组是根节点；「本地文档」按 `relativePath` 继续展开目录 / 文件，
 * 其他资源（网站域、临时网页）保持分组下平铺。插件列表仍走列表视图。
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
import type { ListGroup, ListItem } from '../../../../../shared/lists.ts';
import { command } from '../../../../shared/api/bridge.ts';
import { openListItem } from '../../../../shared/domains/lists.ts';
import { notifyError } from '../../../../shared/domains/notices.ts';
import { useActiveWorkspaceId } from '../../domains/windows.ts';
import { groupIconOf } from './groupIcon.ts';
import { formatTime } from './time.ts';

type TreeNode =
  | {
      key: string;
      kind: 'group';
      label: string;
      group: ListGroup;
      children: TreeNode[];
    }
  | {
      key: string;
      kind: 'dir';
      label: string;
      children: TreeNode[];
    }
  | {
      key: string;
      kind: 'item';
      label: string;
      item: ListItem;
      children: TreeNode[];
    };

function itemNode(item: ListItem): TreeNode {
  return {
    key: `i:${item.key}`,
    kind: 'item',
    label: item.title,
    item,
    children: [],
  };
}

function relativeOf(item: ListItem): string {
  const value = item.meta?.['relativePath'];
  return typeof value === 'string' && value ? value : item.title;
}

function sortNodes(nodes: TreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) {
      if (a.kind === 'dir') return -1;
      if (b.kind === 'dir') return 1;
      return 0;
    }
    return a.label.localeCompare(b.label, 'zh-Hans-CN');
  });
  for (const node of nodes) sortNodes(node.children);
}

function buildNodes(group: ListGroup): TreeNode[] {
  if (group.definitionId !== 'docs') return group.items.map(itemNode);
  const roots: TreeNode[] = [];
  for (const item of group.items) {
    const parts = relativeOf(item)
      .split(/[\\/]+/)
      .filter(Boolean);
    if (parts.length < 2) {
      roots.push(itemNode(item));
      continue;
    }
    let level = roots;
    let prefix = '';
    for (const part of parts.slice(0, -1)) {
      prefix = prefix ? `${prefix}/${part}` : part;
      let dir = level.find(
        (node): node is Extract<TreeNode, { kind: 'dir' }> =>
          node.kind === 'dir' && node.label === part,
      );
      if (!dir) {
        dir = {
          key: `d:${group.id}:${prefix}`,
          kind: 'dir',
          label: part,
          children: [],
        };
        level.push(dir);
      }
      level = dir.children;
    }
    level.push(itemNode(item));
  }
  sortNodes(roots);
  return roots;
}

function openItem(item: ListItem): void {
  if (item.state?.disabled === true) return;
  void openListItem(item).catch((error: unknown) =>
    notifyError(error instanceof Error ? error.message : String(error), 'open'),
  );
}

function closeItem(item: ListItem, wsId: string | null): void {
  const viewId = item.meta?.['viewId'];
  if (typeof viewId === 'string' && wsId) {
    void command('tabs', wsId, 'close', viewId).catch(() => undefined);
  }
}

function TreeRow({
  node,
  depth,
  wsId,
  expanded,
  onToggle,
}: {
  node: TreeNode;
  depth: number;
  wsId: string | null;
  expanded: (key: string, fallback: boolean) => boolean;
  onToggle: (key: string, next: boolean) => void;
}) {
  const isItem = node.kind === 'item';
  const isOpen = expanded(node.key, node.kind === 'group');
  const active = isItem && node.item.state?.active === true;
  const opened = isItem && node.item.state?.open === true;

  const label = node.label;
  const indent = 8 + depth * 12;

  return (
    <div role="treeitem" aria-expanded={isItem ? undefined : isOpen}>
      <div
        data-testid={
          node.kind === 'group'
            ? 'sidebar-tree-group'
            : node.kind === 'dir'
              ? 'sidebar-tree-dir'
              : 'sidebar-tree-item'
        }
        data-group={node.kind === 'group' ? node.group.id : undefined}
        onClick={() =>
          isItem ? openItem(node.item) : onToggle(node.key, !isOpen)
        }
        className={`group relative flex items-center pr-1.5 min-h-[32px] rounded-md cursor-pointer transition-colors ${
          active
            ? 'bg-zinc-200/70 dark:bg-[#2a2d2e]'
            : 'hover:bg-zinc-200/60 dark:hover:bg-[#2a2d2e]'
        }`}
        style={{ paddingLeft: indent }}
        title={label}
      >
        {active && (
          <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-[#4F6BED] rounded-r" />
        )}
        <span className="shrink-0 w-4 flex items-center justify-center">
          {!isItem && (
            <ChevronRight
              className={`w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500 transition-transform ${
                isOpen ? 'rotate-90' : ''
              }`}
            />
          )}
        </span>
        <span className="shrink-0 w-5 flex items-center justify-center">
          {node.kind === 'group' ? (
            <GroupIcon group={node.group} />
          ) : node.kind === 'dir' ? (
            isOpen ? (
              <FolderOpen className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
            ) : (
              <Folder className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
            )
          ) : String(node.item.meta?.['source'] ?? '') === 'web' ? (
            <Globe className="w-4 h-4 text-zinc-400 dark:text-zinc-500" />
          ) : (
            <FileText className="w-4 h-4 text-zinc-400 dark:text-zinc-500" />
          )}
        </span>
        <span
          className={`ml-1.5 flex-1 min-w-0 truncate text-[13px] ${
            node.kind === 'group'
              ? 'font-semibold text-zinc-900 dark:text-zinc-100'
              : 'text-zinc-700 dark:text-zinc-200'
          }`}
        >
          {label}
        </span>
        {node.kind === 'group' && (
          <span className="ml-1 shrink-0 text-[11px] text-zinc-400 dark:text-zinc-500">
            {node.group.countLabel}
          </span>
        )}
        {node.kind === 'group' && node.group.updatedAt > 0 && (
          <span className="ml-1.5 shrink-0 text-[11px] text-zinc-400 dark:text-zinc-500">
            {formatTime(node.group.updatedAt)}
          </span>
        )}
        {isItem && opened && (
          <button
            type="button"
            title="关闭"
            onClick={(event) => {
              event.stopPropagation();
              closeItem(node.item, wsId);
            }}
            className="ml-1 shrink-0 w-5 h-5 rounded flex items-center justify-center text-zinc-400 opacity-0 group-hover:opacity-100 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {!isItem && isOpen && (
        <div role="group">
          {node.children.map((child) => (
            <TreeRow
              key={child.key}
              node={child}
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

function GroupIcon({ group }: { group: ListGroup }) {
  const { Icon, iconUrl } = groupIconOf(group);
  if (iconUrl) {
    return <img src={iconUrl} alt="" className="w-4 h-4 object-contain" />;
  }
  return <Icon className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />;
}

export function ResourceTree({ groups }: { groups: ListGroup[] }) {
  const wsId = useActiveWorkspaceId();
  const [state, setState] = useState<Record<string, boolean>>({});
  const expanded = (key: string, fallback: boolean): boolean =>
    state[key] ?? fallback;
  const onToggle = (key: string, next: boolean): void => {
    setState((current) => ({ ...current, [key]: next }));
  };
  const nodes = groups.map(
    (group): TreeNode => ({
      key: `g:${group.id}`,
      kind: 'group',
      label: group.label,
      group,
      children: buildNodes(group),
    }),
  );
  return (
    <div role="tree" className="space-y-0.5">
      {nodes.map((node) => (
        <TreeRow
          key={node.key}
          node={node}
          depth={0}
          wsId={wsId}
          expanded={expanded}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}
