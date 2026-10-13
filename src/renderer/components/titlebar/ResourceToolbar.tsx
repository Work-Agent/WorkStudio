/**
 * TitleBar 中央资源地址栏（浏览器地址栏语义）—— tabs-design.md §4.3。
 *
 *   - 地址分层：本地文档 = 工作区相对路径 / 应用内资源 = app:// scheme
 *   - spinner 只在激活 tab 未就绪时出现在此（tabs 内不出 spinner）
 *   - 按类型动作区：通用「刷新」+ 声明式贡献（manifest titlebarActions）
 */
import { useMemo } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CodeXml,
  Columns2,
  Eye,
  LoaderCircle,
  MousePointerClick,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react';
import { agentAPI } from '../../api/bridge';
import { useTabServiceStore } from '../../state/tabService';
import { useTabsStore } from '../../state/tabs';

/** 动作描述符：按类型注册（渲染图标 + 行为）。 */
interface ToolbarAction {
  id: string;
  title: string;
  icon: LucideIcon;
  run: () => void;
  /** 激活态（动作有开关语义时，高亮当前开态）。 */
  active?: boolean;
}

const LAYOUT_ORDER: Record<
  string,
  { next: string; label: string; icon: LucideIcon }
> = {
  preview: { next: 'split', label: '预览', icon: Eye },
  split: { next: 'source', label: '分屏', icon: Columns2 },
  source: { next: 'preview', label: '源码', icon: CodeXml },
};

export function ResourceToolbar() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const defs = useTabServiceStore((s) => s.defs);

  const activeTab =
    activeId != null
      ? (tabs.find((t) => t.instanceId === activeId) ?? null)
      : null;
  const url = activeTab?.url ?? '';
  const loading =
    activeTab != null &&
    activeTab.state !== 'ready' &&
    activeTab.state !== 'contentDelivered';

  const actions = useMemo<ToolbarAction[]>(() => {
    if (!activeTab || !activeId) return [];
    const list: ToolbarAction[] = [];

    // raw 网页面板：后退 / 前进 / 可交互元素开关（浏览器导航语义）
    if (activeTab.raw) {
      list.push({
        id: 'go-back',
        title: '后退',
        icon: ArrowLeft,
        run: () => void agentAPI.extensions.goBack(activeId),
      });
      list.push({
        id: 'go-forward',
        title: '前进',
        icon: ArrowRight,
        run: () => void agentAPI.extensions.goForward(activeId),
      });
      const shown = activeTab.interactiveElements === true;
      list.push({
        id: 'toggle-refs',
        title: shown ? '隐藏可交互元素' : '显示可交互元素',
        icon: MousePointerClick,
        active: shown,
        run: () => {
          // 乐观更新（view:annotated 广播会对齐）
          useTabServiceStore
            .getState()
            .setInteractiveElements(activeId, !shown);
          void agentAPI.extensions.setInteractiveElements(activeId, !shown);
        },
      });
    }

    // 通用：刷新（真实 reload：FSM RELOAD → webContents.reload → 内容重投，无白屏）
    list.push({
      id: 'reload',
      title: '重新加载',
      icon: RefreshCw,
      run: () => void useTabServiceStore.getState().reloadInstance(activeId),
    });

    // 声明式贡献：按激活 tab 的扩展定义（manifest titlebarActions）追加
    const def = defs.find((d) => d.id === activeTab.extensionId) ?? null;
    for (const actionId of def?.titlebarActions ?? []) {
      if (actionId === 'layout-switch') {
        const cur = activeTab.layout ?? 'preview';
        const meta = LAYOUT_ORDER[cur] ?? LAYOUT_ORDER.preview;
        list.push({
          id: 'layout-switch',
          title: `布局：${meta.label}（点击切换为${LAYOUT_ORDER[meta.next].label}）`,
          icon: meta.icon,
          active: cur !== 'preview',
          run: () => {
            void agentAPI.extensions.sendToView(activeId, 'action:layout', {
              layout: meta.next,
            });
            // 乐观更新（event:layout 回报会对齐）
            useTabsStore.getState().patch(activeId, { layout: meta.next });
          },
        });
      }
    }
    return list;
  }, [activeTab, activeId, defs]);

  if (url === '') return null;

  return (
    <div
      data-testid="resource-url-bar"
      className="flex items-center gap-1 w-full max-w-[680px] h-8 pl-4 pr-1.5 rounded-full bg-white dark:bg-[#202124] border border-zinc-300/80 dark:border-zinc-700/60 shadow-sm shadow-black/[0.04] dark:shadow-none transition-colors"
      title="资源地址"
    >
      <span
        className="flex-1 min-w-0 text-[12px] font-mono text-zinc-700 dark:text-zinc-300 truncate select-text"
        title={url}
      >
        {url}
      </span>
      {loading && (
        <span title="加载中…">
          <LoaderCircle className="w-3.5 h-3.5 animate-spin text-[#4F6BED] shrink-0" />
        </span>
      )}
      {actions.map((action) => (
        <button
          key={action.id}
          onClick={() => action.run()}
          className={`h-6 w-6 shrink-0 rounded-full flex items-center justify-center transition-colors ${
            action.active
              ? 'text-[#4F6BED] dark:text-[#6c86f0]'
              : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-[#2f3233] hover:text-zinc-900 dark:hover:text-zinc-100'
          }`}
          title={action.title}
          data-testid={`url-action-${action.id}`}
        >
          <action.icon className="w-3.5 h-3.5" />
        </button>
      ))}
    </div>
  );
}
