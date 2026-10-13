/**
 * S3 中栏 资源面板（工作台）—— docs/tabs-design.md。
 *
 * 组装层：tabs 集合（state/tabs.ts）→ TabsBar 属性；内容区按内置视图注册表分流——
 * builtin（如 session-manager）渲染 DOM 组件，其余走 ExtensionView（原生视图占位）。
 */
import { BotMessageSquare, FileText, Globe, Package } from 'lucide-react';
import { useTabServiceStore } from '../../state/tabService';
import { useTabsStore } from '../../state/tabs';
import { BUILTIN_VIEWS } from './builtinViews';
import { ExtensionView } from './ExtensionView';
import { TabsBar } from './TabsBar';

const KIND_ICON = {
  document: FileText,
  plugin: Package,
  builtin: BotMessageSquare,
  browser: Globe,
} as const;

export function ResourcePane() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const host = useTabServiceStore;

  const items = tabs.map((t) => ({
    id: t.instanceId,
    label: t.title,
    icon: KIND_ICON[t.kind],
    dirty: t.dirty,
    pinned: t.pinned,
    error: t.state === 'error',
  }));

  return (
    <div className="h-full w-full bg-zinc-200 dark:bg-[#1A1C1D] flex flex-col">
      {/* ── 统一标签栏（空时不渲染） ── */}
      {tabs.length > 0 && (
        <TabsBar
          testId="doc-tabs"
          items={items}
          active={activeId ?? ''}
          onSelect={(id) => void host.getState().selectInstance(id)}
          onClose={(id) => void host.getState().closeInstance(id)}
          onTogglePin={(id) => useTabsStore.getState().togglePin(id)}
          onMove={(fromId, toId) =>
            useTabsStore.getState().moveTab(fromId, toId)
          }
          onRetry={(id) => void host.getState().reloadInstance(id)}
          bulkClose={{
            closeOthers: (id) => void host.getState().closeOthers(id),
            closeLeft: (id) => void host.getState().closeToLeft(id),
            closeRight: (id) => void host.getState().closeToRight(id),
            closeAll: () => void host.getState().closeAll(),
          }}
        />
      )}

      {/* ── 内容区（内置 DOM 视图 / 原生视图占位 + 空态引导） ── */}
      <div className="relative flex-1 min-h-0">
        {tabs.length > 0 ? (
          tabs.map((tab) => {
            const Builtin = BUILTIN_VIEWS[tab.extensionId];
            const active = tab.instanceId === activeId;
            if (Builtin) {
              return (
                <div
                  key={tab.instanceId}
                  className={active ? 'absolute inset-0' : 'hidden'}
                >
                  <Builtin />
                </div>
              );
            }
            return (
              <ExtensionView
                key={tab.instanceId}
                instanceId={tab.instanceId}
                active={active}
              />
            );
          })
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-zinc-400 dark:text-zinc-600 text-[12px] gap-2 px-6 text-center">
            <FileText className="w-6 h-6 opacity-50" />
            <span>从左侧打开文档后，将在此处编辑</span>
          </div>
        )}
      </div>
    </div>
  );
}
