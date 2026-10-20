/**
 * SettingsList —— 设置列表形态（TitleBar 设置入口的独立 sidebar，与插件列表分离）。
 *
 * 设置面全部由插件贡献（config 页 = 插件的设置/内容页）：
 * 清单来自 `plugins.list`（manifest 扫描结果），行点击 = `views.open({kind:'plugin'})`
 * ——与资源面板内容一样由 WebContentsView 渲染，渲染层不承载设置 UI。
 */
import { useEffect } from 'react';
import {
  BookOpen,
  Cpu,
  FolderOpen,
  FolderTree,
  HardDrive,
  MessagesSquare,
  Puzzle,
  SlidersHorizontal,
} from 'lucide-react';
import { usePluginsStore, openPluginView } from '../../state/plugins';
import { useUiStore } from '../../state/uiState';
import { SubListView } from './SubListView';

/** 设置域成员（插件 id → manifest；顺序即展示顺序）。 */
const SETTINGS_PLUGINS = [
  {
    id: 'settings-manager',
    title: '偏好设置',
    desc: 'App 默认 / 本工作区两层配置',
    icon: SlidersHorizontal,
  },
  {
    id: 'model-config',
    title: '模型配置',
    desc: '供应商登录 · 模型目录 · API Key',
    icon: Cpu,
  },
  {
    id: 'extension-manager',
    title: '扩展管理',
    desc: '社区包安装 · 本机插件',
    icon: Puzzle,
  },
  {
    id: 'skills',
    title: '技能',
    desc: '已加载清单 · 装载诊断',
    icon: BookOpen,
  },
  {
    id: 'session-manager',
    title: '会话管理',
    desc: '会话列表 · 切换 · 删除与停止',
    icon: MessagesSquare,
  },
  {
    id: 'workspaces',
    title: '工作区',
    desc: '注册表 · 切换 / 打开目录',
    icon: FolderOpen,
  },
  {
    id: 'storage',
    title: '存储与数据',
    desc: '落盘位置 · 会话目录 · 版本信息',
    icon: HardDrive,
  },
  {
    id: 'resources',
    title: '资源索引',
    desc: '资源地图 · 重新索引',
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
                if (plugin) openPluginView(plugin);
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
            设置页与视图内容一律由插件页（WebContentsView）承载
          </p>
        )}
      </div>
    </SubListView>
  );
}
