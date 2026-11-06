import type { PluginInstallTask } from '../../../shared/plugin-install';
import type { SessionTask } from '../../../shared/session-task';
/** 资料常驻：来源就地展开；管理页面在内容区打开。 */
import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FileText,
  FolderOpen,
  Plus,
  Puzzle,
  Search,
  Settings,
} from 'lucide-react';
import type { ListGroup, ListItem } from '../../../shared/lists';
import { cmd } from '../../api/appCommands';
import { notifyError } from '../../state/notifications';
import { setUiState, useUiStore } from '../../state/ui';
import { useWorkspaceStore } from '../../state/workspace';
import { FindList } from './FindList';
import { rendererIcon } from '../titlebar/icons';

async function openItem(item: ListItem): Promise<void> {
  const result = await cmd('list.action', { action: 'open', item });
  if (!result.ok) notifyError(result.error.message, 'open');
}
function openSettings(pageId: string): void {
  void cmd('views.open', { input: { type: 'settings', pageId } });
}
function ResourceIcon({
  name,
  source = false,
}: {
  name?: string;
  source?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const Icon = rendererIcon(name ?? '') ?? (source ? FolderOpen : FileText);
  if (name && /^(data:|https?:|app:)/.test(name) && !broken)
    return (
      <img
        src={name}
        alt=""
        width={16}
        height={16}
        className="shrink-0 object-contain"
        onError={() => setBroken(true)}
      />
    );
  return <Icon size={source ? 16 : 14} />;
}
export function Sidebar() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const groups = useWorkspaceStore((s) => s.groups).filter(
    (g) => g.section === 'resources',
  );
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const workspace = useRef<string | null>(null);
  const [install, setInstall] = useState<PluginInstallTask | null>(null);
  const [task, setTask] = useState<SessionTask | null>(null);
  useEffect(() => {
    const bridge = window.appBridge;
    if (!bridge) return;
    const off = bridge.on((frame) => {
      if (frame.type !== 'state') return;
      if (frame.path === '/plugins/task')
        setInstall(frame.value as PluginInstallTask | null);
      if (frame.path === '/workspaces/current') {
        workspace.current = (frame.value as { id: string } | null)?.id ?? null;
        setTask(null);
        setQuery('');
        setClosed(new Set());
        if (workspace.current)
          void bridge.watch([`/workspaces/${workspace.current}/sessions/task`]);
      }
      if (
        workspace.current &&
        frame.path === `/workspaces/${workspace.current}/sessions/task`
      )
        setTask(frame.value as SessionTask | null);
    });
    void bridge.watch(['/plugins/task', '/workspaces/current']);
    return off;
  }, []);
  const focusSearch = (): void => {
    setUiState({ sidebarCollapsed: false });
    setTimeout(() => input.current?.focus(), 30);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        focusSearch();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const toggle = async (group: ListGroup): Promise<void> => {
    if (collapsed) {
      const r = await window.appBridge?.call<string | null>(
        '/native/popup-menu',
        {
          items: group.items.map((item, i) => ({
            id: String(i),
            label: item.title,
            disabled: item.state?.disabled,
          })),
        },
      );
      if (r?.ok && r.data !== null) {
        const item = group.items[Number(r.data)];
        if (item) await openItem(item);
      }
      return;
    }
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(group.id)) next.delete(group.id);
      else next.add(group.id);
      return next;
    });
  };
  return (
    <aside className="wb-sidebar" data-testid="sidebar" aria-label="工作区资料">
      <div className="wb-sidebar-heading">
        {!collapsed && <strong>工作区资料</strong>}
        <button
          className="wb-icon"
          title="新建资料"
          aria-label="新建资料"
          onClick={() => openSettings('welcome')}
        >
          <Plus size={16} />
        </button>
      </div>
      {collapsed ? (
        <button
          className="wb-icon mx-auto"
          aria-label="查找资料"
          onClick={focusSearch}
        >
          <Search size={16} />
        </button>
      ) : (
        <label className="wb-search">
          <Search size={14} />
          <input
            ref={input}
            data-testid="sidebar-find-input"
            type="search"
            aria-label="按名称或路径查找资料"
            placeholder="按名称或路径查找…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('');
            }}
          />
        </label>
      )}
      <div className="wb-tree">
        {query.trim() ? (
          <FindList query={query} hideInput />
        ) : (
          groups.map((group) => {
            const expanded = !closed.has(group.id);
            return (
              <section key={group.id}>
                <button
                  className="wb-source"
                  data-testid="resource-group"
                  aria-label={group.label}
                  aria-expanded={!collapsed && expanded}
                  onClick={() => void toggle(group)}
                  title={group.label}
                >
                  {!collapsed &&
                    (expanded ? (
                      <ChevronDown size={12} />
                    ) : (
                      <ChevronRight size={12} />
                    ))}
                  <ResourceIcon name={group.icon} source />
                  {!collapsed && (
                    <>
                      <span>{group.label}</span>
                      <small>{group.count}</small>
                    </>
                  )}
                </button>
                {!collapsed &&
                  expanded &&
                  (group.state === 'error' ? (
                    <p className="wb-tree-note" role="alert">
                      {group.diagnostics?.join('；') ?? '资料加载失败'}
                    </p>
                  ) : group.items.length ? (
                    group.items.map((item) => (
                      <button
                        key={item.key}
                        className={`wb-file ${item.state?.active ? 'is-active' : ''}`}
                        data-testid="resource-item"
                        disabled={item.state?.disabled}
                        onClick={() => void openItem(item)}
                        title={item.subtitle ?? item.title}
                      >
                        <ResourceIcon name={item.icon} />
                        <span>{item.title}</span>
                        {item.state?.dirty && (
                          <small aria-label="未保存">●</small>
                        )}
                      </button>
                    ))
                  ) : (
                    <p className="wb-tree-note">
                      {group.empty?.text ?? '还没有资料'}
                    </p>
                  ))}
              </section>
            );
          })
        )}
      </div>
      <nav className="wb-sidebar-footer" aria-label="应用管理">
        {task &&
          ['running', 'stopping', 'failed', 'unconfirmed'].includes(
            task.status,
          ) && (
            <button
              title="查看助手任务"
              onClick={() => {
                setUiState({ aiOpen: true });
                if (task.sessionFile && workspace.current)
                  void window.appBridge?.call(
                    `/workspaces/${workspace.current}/sessions/current/open`,
                    { sessionId: encodeURIComponent(task.sessionFile) },
                  );
              }}
            >
              <FileText size={16} />
              {!collapsed && (
                <span>
                  {task.status === 'running'
                    ? '助手执行中'
                    : task.status === 'stopping'
                      ? '助手正在停止'
                      : task.status === 'failed'
                        ? '助手任务需要处理'
                        : '助手停止待确认'}
                </span>
              )}
            </button>
          )}
        {install &&
          install.status !== 'done' &&
          (install.status !== 'cancelled' || install.installed) && (
            <button
              title="查看插件安装任务"
              onClick={() => openSettings('plugins')}
            >
              <Puzzle size={16} />
              {!collapsed && (
                <span>
                  {install.status === 'running'
                    ? '插件安装中'
                    : install.status === 'cancelling'
                      ? '插件正在取消'
                      : '插件安装需要处理'}
                </span>
              )}
            </button>
          )}

        <button
          data-testid="sidebar-nav-plugins"
          title="能力管理"
          onClick={() => openSettings('plugins')}
        >
          <Puzzle size={16} />
          {!collapsed && <span>能力管理</span>}
        </button>
        <button
          data-testid="sidebar-nav-settings"
          title="设置"
          onClick={() => openSettings('appearance')}
        >
          <Settings size={16} />
          {!collapsed && <span>设置</span>}
        </button>
      </nav>
    </aside>
  );
}
