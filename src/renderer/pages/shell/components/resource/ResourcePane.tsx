/**
 * S3 资源面板（DOM 部分）—— docs/architecture.md §2.4 / §2.5。
 *
 * DOM 只承载 chrome：标签栏与空态；全部视图内容一律由原生视图（WebContentsView）承载。
 * 矩形全部取主进程 layout（`tabbar` / `resourceContent`）；本组件不渲染内容、不丈量容器、
 * 不做分栏——文档与网页内容由主进程的原生视图承载（`layout.resourceContent`）。
 */
import { useEffect, useRef } from 'react';
import { FileText } from 'lucide-react';
import { command } from '../../../../shared/api/bridge.ts';
import { useViewCommands, useViews } from '../../domains/views.ts';
import { typeIcon } from './typeIcon.ts';
import { TabsBar } from './TabsBar.tsx';

export function ResourcePane() {
  const views = useViews();
  const runViewCommand = useViewCommands();
  const restoring = useRef(false);

  // 工作区入口：没有任何内容视图时恢复唯一欢迎页。
  useEffect(() => {
    if (views.length > 0 || restoring.current) return;
    restoring.current = true;
    void command('settings', 'pages', 'open', { pageId: 'welcome' })
      .catch(() => undefined)
      .finally(() => {
        restoring.current = false;
      });
  }, [views.length]);

  const active = views.find((v) => v.active) ?? null;

  return (
    <>
      {/* ── 统一标签栏 ── */}
      <div className="shell-tabbar">
        <TabsBar
          testId="doc-tabs"
          onAdd={() =>
            void command('settings', 'pages', 'open', { pageId: 'welcome' })
          }
          items={views.map((v) => ({
            id: v.id,
            label: v.title,
            icon: typeIcon(v.type),
            dirty: v.dirty,
            missing: v.missing,
            conflict: v.conflict,
            pinned: v.pinned,
            error: v.state === 'error',
          }))}
          active={active?.id ?? ''}
          onSelect={(id) => runViewCommand('views.activate', { id })}
          onClose={(id) => runViewCommand('views.close', { id })}
          onTogglePin={(id) => runViewCommand('views.togglePin', { id })}
          onMove={(fromId, toId) =>
            runViewCommand('views.move', { fromId, toId })
          }
          onRetry={(id) => runViewCommand('views.reload', { id })}
          bulkClose={{
            closeOthers: (id) => runViewCommand('views.closeOthers', { id }),
            closeLeft: (id) => runViewCommand('views.closeToLeft', { id }),
            closeRight: (id) => runViewCommand('views.closeToRight', { id }),
            closeAll: () => runViewCommand('views.closeAll'),
          }}
        />
      </div>

      {/* ── 内容区：仅空态占位；视图内容全部由 WebContentsView 覆盖 ── */}
      <div className="shell-resource-content overflow-hidden">
        {views.length === 0 && (
          <div className="pointer-events-none h-full flex flex-col items-center justify-center text-zinc-400 dark:text-zinc-600 text-[12px] gap-2 px-6 text-center">
            <FileText className="w-6 h-6 opacity-50" />
            <span>从左侧打开文档后，将在此处编辑</span>
          </div>
        )}
      </div>
    </>
  );
}
