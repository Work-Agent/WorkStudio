/**
 * 插件域 store（zustand）—— 插件清单投影（插件列表 / 设置列表 / 模型配置入口共用）。
 *
 * 新架构（window.workbench 存在）：清单来自主进程 `plugins.list`（manifest 扫描结果），
 * 行点击 = `views.open({type:'plugin'})` 打开该插件 config 页；旧路径（mock / 无桥）保留。
 */
import { create } from 'zustand';
import type { PluginInfo } from '../../shared/types';
import { agentAPI } from '../api/bridge';
import { useTabServiceStore } from './tabService';

const mainBridge = typeof window !== 'undefined' ? window.workbench : undefined;

interface PluginsState {
  plugins: PluginInfo[];
  loaded: boolean;
  load: () => Promise<PluginInfo[]>;
}

export const usePluginsStore = create<PluginsState>()((set, get) => ({
  plugins: [],
  loaded: false,

  load: async () => {
    if (get().loaded) return get().plugins;
    try {
      let plugins: PluginInfo[];
      if (mainBridge) {
        const response = await mainBridge.cmd<PluginInfo[]>('plugins.list');
        plugins = response.ok ? response.data : [];
      } else {
        plugins = await agentAPI.plugins.list();
      }
      set({ plugins, loaded: true });
      return plugins;
    } catch (e) {
      console.error('Failed to load plugins:', e);
      return [];
    }
  },
}));

/** 打开插件 config 页（新架构走主进程视图集合；mock 走旧 tabService 路径）。 */
export function openPluginView(plugin: PluginInfo): void {
  if (mainBridge) {
    void mainBridge.cmd('views.open', {
      input: { type: 'plugin', pluginId: plugin.id, settings: true },
    });
    return;
  }
  void useTabServiceStore.getState().openPluginConfig(plugin);
}
