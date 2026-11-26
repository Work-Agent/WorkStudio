/**
 * 收起侧栏的文件 rail：只展示已经打开的文件 / 视图。
 *
 * 完整资源森林只在展开状态渲染；收起后回到“打开项”图标列。
 */
import { FileText, Globe, Settings, Sparkles } from 'lucide-react';
import {
  command,
  useResource,
  useWorkspaceId,
} from '../../../../shared/api/bridge.ts';
import { notifyError } from '../../../../shared/domains/notices.ts';

interface ViewInfo {
  id: string;
  type: string;
  title: string;
  url?: string;
  active: boolean;
}

const BUTTON =
  'flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-transparent text-zinc-500 transition-colors hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-[#2a2d2e] dark:hover:text-zinc-100';

function iconOf(view: ViewInfo) {
  if (view.url?.startsWith('settings:')) return Settings;
  if (view.url?.startsWith('work://studio/welcome')) return Sparkles;
  return view.type === 'web' ? Globe : FileText;
}

export function OpenViewsRail() {
  const workspaceId = useWorkspaceId();
  const views = useResource<ViewInfo[]>(
    'shell',
    workspaceId ? `${workspaceId}/views` : null,
    [],
  );
  const open = views.filter(
    (view) => view.type === 'page' || view.type === 'web',
  );

  const activate = (id: string): void => {
    if (!workspaceId) return;
    void command('shell', `${workspaceId}/views`, 'activate', { id }).catch(
      (error: unknown) =>
        notifyError(
          error instanceof Error ? error.message : String(error),
          'open',
        ),
    );
  };

  return (
    <div
      data-testid="open-view-rail"
      className="flex flex-col items-center gap-1 pt-1"
    >
      {open.map((view) => {
        const Icon = iconOf(view);
        return (
          <button
            key={view.id}
            type="button"
            data-testid="open-view-rail-item"
            title={view.title}
            onClick={() => activate(view.id)}
            className={`${BUTTON} ${
              view.active
                ? 'border-[#4F6BED]/40 bg-[#4F6BED]/10 text-[#4F6BED] dark:text-[#8ea3f5]'
                : ''
            }`}
          >
            <Icon className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}
