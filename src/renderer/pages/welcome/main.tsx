/** 欢迎页：没有其他标签时作为工作区入口保留。 */
import { createRoot } from 'react-dom/client';
import { FolderOpen, Settings, Sparkles } from 'lucide-react';
import { command } from '../../shared/api/bridge.ts';
import { useWorkspaces } from '../../shared/domains/workspaces.ts';
import '../../shared/styles/index.css';

function Welcome() {
  const { list, current, open } = useWorkspaces();
  const pickWorkspace = async (): Promise<void> => {
    const path = await command<string | null>(
      'shell',
      'native',
      'pickDirectory',
      {},
    );
    if (path) await open(path);
  };
  return (
    <div
      data-testid="welcome-page"
      className="h-screen overflow-y-auto bg-zinc-100 text-zinc-900 dark:bg-[#1a1c1d] dark:text-zinc-100"
    >
      <div className="mx-auto flex min-h-full max-w-[920px] flex-col justify-center px-8 py-12">
        <div className="mb-8 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#4F6BED] text-white">
            <Sparkles className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-[20px] font-semibold">WorkStudio</h1>
            <p className="text-[12px] text-zinc-500 dark:text-zinc-400">
              {current?.name ?? '选择一个工作区开始'}
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            data-testid="welcome-open-workspace"
            onClick={() => void pickWorkspace()}
            className="rounded-xl border border-zinc-200 bg-white p-4 text-left transition-colors hover:border-[#4F6BED]/60 dark:border-[#2c3039] dark:bg-[#141618]"
          >
            <FolderOpen className="mb-3 h-5 w-5 text-[#4F6BED]" />
            <div className="text-[13px] font-medium">打开工作区…</div>
            <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
              选择本地目录作为当前工作区
            </div>
          </button>
          <button
            type="button"
            data-testid="welcome-open-settings"
            onClick={() =>
              void command('settings', 'pages', 'open', {
                pageId: 'appearance',
              })
            }
            className="rounded-xl border border-zinc-200 bg-white p-4 text-left transition-colors hover:border-[#4F6BED]/60 dark:border-[#2c3039] dark:bg-[#141618]"
          >
            <Settings className="mb-3 h-5 w-5 text-zinc-500" />
            <div className="text-[13px] font-medium">打开设置</div>
            <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
              外观、模型、插件与工作区
            </div>
          </button>
        </div>

        {list.length > 0 && (
          <div className="mt-8">
            <h2 className="mb-2 text-[12px] font-semibold text-zinc-600 dark:text-zinc-300">
              最近工作区
            </h2>
            <div className="space-y-1">
              {list.slice(0, 8).map((workspace) => (
                <button
                  key={workspace.id}
                  type="button"
                  onClick={() => void open(workspace.path)}
                  className="flex w-full items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left hover:border-[#4F6BED]/60 dark:border-[#2c3039] dark:bg-[#141618]"
                >
                  <FolderOpen className="h-4 w-4 shrink-0 text-zinc-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium">
                      {workspace.name}
                    </span>
                    <span className="block truncate font-mono text-[10px] text-zinc-400">
                      {workspace.path}
                    </span>
                  </span>
                  {workspace.id === current?.id && (
                    <span className="text-[10px] text-[#4F6BED]">当前</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Welcome />);
