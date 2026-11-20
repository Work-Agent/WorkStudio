import type { ListDefinition, ListItem } from '../../../../../shared/lists.ts';
import type { PluginHost } from '../../plugins/host.ts';
import type { ListProvider } from '../registry.ts';
import { OPEN_ACTION } from './common.ts';

export const pluginsDefinition: ListDefinition = {
  id: 'plugins',
  section: 'plugins',
  label: '插件',
  icon: 'package',
  tone: 'bg-cyan-500 text-cyan-50 dark:bg-cyan-600 dark:text-cyan-100',
  unit: '个',
  order: 50,
  sourceScope: 'app',
  itemType: 'plugin',
  fields: [
    { key: 'title', type: 'text' },
    { key: 'subtitle', type: 'text' },
  ],
  actions: [OPEN_ACTION],
  grouping: 'flat',
};

export function pluginsProvider(host: () => PluginHost): ListProvider {
  return () => {
    const items: ListItem[] = host()
      .pluginInfoList()
      .map((plugin) => ({
        key: plugin.id,
        itemType: 'plugin',
        title: plugin.name,
        subtitle: `v${plugin.version} · ${plugin.hasConfig ? '可配置' : '仅查看器'}`,
        ...(plugin.iconUrl ? { icon: plugin.iconUrl } : {}),
        meta: {
          pluginId: plugin.id,
          version: plugin.version,
          builtin: plugin.builtin,
          hasConfig: plugin.hasConfig,
        },
        ...(plugin.hasConfig ? {} : { state: { disabled: true } }),
      }));
    return [{ id: 'plugins', label: '插件', items }];
  };
}
