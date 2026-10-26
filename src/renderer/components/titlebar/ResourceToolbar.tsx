/**
 * TitleBar 中区资源地址栏 + 地址工具条（声明式动作，浏览器地址栏语义）—— architecture.md §2.2。
 *
 *   - 地址 = 激活视图的 `url`（本地文档 = 工作区路径 / 应用内资源 = app:// scheme / 网页 = 原 URL）
 *   - spinner 只在激活视图未就绪时出现在此（TabsBar 内不出 spinner）
 *   - 动作渲染进胶囊右端的地址工具条（可多个按钮）：
 *     插件 manifest `titlebarActions` 声明（按 actions.ts 语义目录渲染）
 *     + 网页类内建动作（后退 / 前进 / 可交互元素）+ 通用重新加载
 *
 * 数据源是主进程视图投影（`shell.views`），所以切换 tab、导航、重载都会同步反映到地址栏。
 */
import {
  ArrowLeft,
  ArrowRight,
  LoaderCircle,
  RefreshCw,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { typeIcon } from '../resource/typeIcon';
import { runViewCommand, useShellStore } from '../../state/shell';
import { FALLBACK_ACTION, TITLEBAR_ACTIONS } from './actions';
import { rendererIcon } from './icons';

/** 动作描述符：按类型注册（渲染图标 + 行为）。 */
interface ToolbarAction {
  id: string;
  title: string;
  icon: LucideIcon;
  run: () => void;
  /** 激活态（动作有开关语义时，高亮当前开态）。 */
  active?: boolean;
  /** 禁用态（如无脏改动的保存）。 */
  disabled?: boolean;
}

export function ResourceToolbar() {
  const views = useShellStore((s) => s.views);
  const active = views.find((v) => v.active) ?? null;

  if (!active) return null;

  const loading =
    active.state !== 'ready' && active.state !== 'contentDelivered';
  const url = active.url;
  const actions: ToolbarAction[] = [];

  // 插件声明的声明式动作（manifest titlebarActions → 语义目录渲染）
  const states = active.actionStates ?? {};
  for (const actionId of active.titlebarActions ?? []) {
    const spec = TITLEBAR_ACTIONS[actionId] ?? FALLBACK_ACTION;
    const state = states[actionId];
    actions.push({
      id: actionId,
      title: spec.title(state, active),
      icon: spec.icon(state),
      active: spec.active?.(state) ?? false,
      disabled: spec.disabled?.(state, active) ?? false,
      run: () =>
        runViewCommand('views.action', { id: active.id, action: actionId }),
    });
  }

  // 插件注册的地址栏动作（URA view action）
  for (const action of active.actions ?? []) {
    actions.push({
      id: action.id,
      title: action.label,
      icon: rendererIcon(action.icon) ?? Zap,
      active: action.active,
      run: () =>
        runViewCommand('views.runAction', {
          id: active.id,
          action: action.id,
        }),
    });
  }

  // 网页：后退 / 前进（浏览器导航语义）
  if (active.type === 'browser') {
    actions.push({
      id: 'go-back',
      title: '后退',
      icon: ArrowLeft,
      run: () => runViewCommand('views.goBack', { id: active.id }),
    });
    actions.push({
      id: 'go-forward',
      title: '前进',
      icon: ArrowRight,
      run: () => runViewCommand('views.goForward', { id: active.id }),
    });
  }

  actions.push({
    id: 'reload',
    title: '重新加载',
    icon: RefreshCw,
    run: () => runViewCommand('views.reload', { id: active.id }),
  });

  const KindIcon = rendererIcon(active.renderer?.icon) ?? typeIcon(active.type);

  return (
    <div
      data-testid="resource-url-bar"
      className="no-drag flex items-center gap-1.5 w-full max-w-[680px] h-8 pl-3 pr-1.5 rounded-full bg-white dark:bg-[#202124] border border-zinc-300/80 dark:border-zinc-700/60 shadow-sm shadow-black/[0.04] dark:shadow-none transition-colors"
      title={url}
    >
      {active.renderer?.iconUrl ? (
        <img
          src={active.renderer.iconUrl}
          alt=""
          className="w-3.5 h-3.5 shrink-0 rounded-sm object-contain"
          onError={(event) => {
            event.currentTarget.style.display = 'none';
          }}
        />
      ) : (
        <KindIcon className="w-3.5 h-3.5 shrink-0 text-zinc-400 dark:text-zinc-500" />
      )}
      <span className="flex-1 min-w-0 text-[12px] font-mono text-zinc-700 dark:text-zinc-300 truncate select-text">
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
          disabled={action.disabled}
          className={`h-6 w-6 shrink-0 rounded-full flex items-center justify-center transition-colors disabled:opacity-35 disabled:cursor-default ${
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
