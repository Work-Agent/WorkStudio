/**
 * SettingsList —— 设置列表形态（TitleBar 设置入口的独立 sidebar，与插件列表分离）。
 *
 * 分组规则：偏好设置 / 模型配置 / 会话管理 / 资源索引 = 应用级设置面（常驻）；
 * 行点击 = 打开该插件的 config 页（与 PluginList 同一打开管道）。
 */
import { useEffect } from 'react';
import {
  Cpu,
  FolderTree,
  MessagesSquare,
  SlidersHorizontal,
} from 'lucide-react';
import { usePluginsStore } from '../../state/plugins';
import { useTabServiceStore } from '../../state/tabService';
import { useUiStore } from '../../state/uiState';
import { SubListView } from './SubListView';

/** 设置域成员（静态注册：应用级设置面，插件 id 对应 manifest）。 */
const SETTINGS_PLUGINS = [
  {
    id: 'settings-manager',
    title: '偏好设置',
    desc: 'App 默认 / 工作区 / 运行时覆盖',
    icon: SlidersHorizontal,
  },
  {
    id: 'model-config',
    title: '模型配置',
    desc: '供应商与模型目录',
    icon: Cpu,
  },
  {
    id: 'session-manager',
    title: '会话管理',
    desc: '会话列表 · 按域归档 · 删除与停止',
    icon: MessagesSquare,
  },
  {
    id: 'resources',
    title: '资源索引',
    desc: '资源地图（AGENTS.md）同步与预览',
    icon: FolderTree,
  },
] as const;

export function SettingsList() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const plugins = usePluginsStore((s) => s.plugins);
  const load = usePluginsStore((s) => s.load);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SubListView title="设置" count={SETTINGS_PLUGINS.length}>
      <div className="space-y-1">
        {SETTINGS_PLUGINS.map((entry) => {
          const plugin = plugins.find((p) => p.id === entry.id);
          const Icon = entry.icon;
          return (
            <div
              key={entry.id}
              onClick={() => {
                if (plugin)
                  void useTabServiceStore.getState().openPluginConfig(plugin);
              }}
              className={`group flex items-center px-2 py-1.5 rounded-lg transition-colors min-h-[42px] ${
                plugin
                  ? 'cursor-pointer hover:bg-zinc-200/60 dark:hover:bg-[#2a2d2e]'
                  : 'opacity-50 cursor-default'
              }`}
              title={entry.title}
            >
              <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-zinc-500 text-zinc-50 dark:bg-zinc-600 dark:text-zinc-100">
                <Icon className="w-4 h-4" />
              </div>
              {!collapsed && (
                <div className="ml-2 flex-1 overflow-hidden min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h4 className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100 truncate leading-none">
                      {entry.title}
                    </h4>
                  </div>
                  <div className="mt-[5px] text-[12px] truncate text-zinc-400 dark:text-zinc-500 leading-none">
                    {entry.desc}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {!collapsed && (
          <p className="text-[10px] text-zinc-400 dark:text-zinc-600 italic px-2 pt-2 border-t border-zinc-200/60 dark:border-zinc-700/40 mt-2">
            能力插件的自身设置在 📦 插件列表内
          </p>
        )}
      </div>
    </SubListView>
  );
}
