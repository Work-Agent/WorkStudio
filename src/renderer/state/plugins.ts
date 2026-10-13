/**
 * 插件域 store（zustand）—— 插件清单投影（插件列表 / 设置列表 / 模型配置入口共用）。
 */
import { create } from 'zustand';
import type { PluginInfo } from '../../shared/types';
import { agentAPI } from '../api/bridge';

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
      const plugins = await agentAPI.plugins.list();
      set({ plugins, loaded: true });
      return plugins;
    } catch (e) {
      console.error('Failed to load plugins:', e);
      return [];
    }
  },
}));
