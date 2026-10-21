/**
 * PluginList —— 插件列表形态（配置即插件）。
 *
 * 行 = Package 图标（青色系）+ 名称 + v 版本 + 贡献点计数 meta；
 * 行点击 = 打开该插件自己的 config 页（介绍 + 设置一体，每个插件必有）。
 */
import { useEffect } from 'react';
import { Package } from 'lucide-react';
import { openPluginView, usePluginsStore } from '../../state/plugins';
import { useUiStore } from '../../state/uiState';
import { SubListView } from './SubListView';

export function PluginList() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const plugins = usePluginsStore((s) => s.plugins);
  const load = usePluginsStore((s) => s.load);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SubListView title="插件" count={plugins.length}>
      <div className="space-y-1">
        {plugins.length > 0
          ? plugins.map((p) => (
              <div
                key={p.id}
                onClick={() => openPluginView(p)}
                className="group flex items-center px-2 py-1.5 rounded-lg cursor-pointer hover:bg-zinc-200/60 dark:hover:bg-[#2a2d2e] transition-colors min-h-[42px]"
                title={p.name}
              >
                <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-cyan-500 text-cyan-50 dark:bg-cyan-600 dark:text-cyan-100 overflow-hidden">
                  {p.iconUrl ? (
                    <img
                      src={p.iconUrl}
                      alt=""
                      className="w-5 h-5 object-contain"
                      onError={(event) => {
                        event.currentTarget.style.display = 'none';
                      }}
                    />
                  ) : (
                    <Package className="w-4 h-4" />
                  )}
                </div>
                {!collapsed && (
                  <div className="ml-2 flex-1 overflow-hidden min-w-0">
                    <div className="flex items-center gap-1.5">
                      <h4 className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100 truncate leading-none">
                        {p.name}
                      </h4>
                      <span className="text-[9px] text-zinc-400 dark:text-zinc-500 shrink-0">
                        v{p.version}
                      </span>
                    </div>
                    <div className="mt-[5px] text-[12px] truncate text-zinc-400 dark:text-zinc-500 leading-none">
                      {[
                        p.extensionCount > 0
                          ? p.extensionCount + ' 视图'
                          : null,
                        p.skillCount > 0 ? p.skillCount + ' Skill' : null,
                        p.toolCount > 0 ? p.toolCount + ' 工具' : null,
                      ]
                        .filter(Boolean)
                        .join(' · ') || p.id}
                    </div>
                  </div>
                )}
              </div>
            ))
          : !collapsed && (
              <p className="text-[11px] text-zinc-400 dark:text-zinc-600 italic px-2 py-2">
                暂无已安装插件。
              </p>
            )}
      </div>
    </SubListView>
  );
}
