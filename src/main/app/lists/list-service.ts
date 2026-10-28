/**
 * 列表服务：定义 + 当前工作区数据 → ListSnapshot。
 *
 * 内置列表与插件列表走同一份定义；渲染层只消费快照。
 */

import type {
  ListDefinition,
  ListGroup,
  ListItem,
  ListSnapshot,
} from '../../../shared/lists';
import type { AgentHost } from '../../agent/agent-host';
import type { ViewHost } from '../../capabilities/webview/host';
import { settingsPages } from '../../capabilities/settings/registry';
import type { PluginHost } from '../../plugins/host';
import type { ListContexts } from '../../ura/contexts';
import { listRegistry } from './list-registry';
import { OPEN_ACTION } from './builtins/common';

export interface ListServiceDeps {
  contexts: ListContexts;
  agent: AgentHost;
  plugins: PluginHost;
  viewHost: ViewHost;
}

function latestOf(items: ListItem[]): number {
  return items.reduce((latest, item) => {
    const value = item.meta?.['updatedAt'];
    return typeof value === 'number' ? Math.max(latest, value) : latest;
  }, 0);
}

function countLabelOf(
  count: number,
  unit: string | undefined,
  override: string | undefined,
): string {
  if (override) return override;
  return count > 0 ? `${count} ${unit ?? '项'}` : '暂无';
}

export class ListService {
  constructor(private readonly deps: ListServiceDeps) {
    for (const definition of builtinDefinitions()) {
      listRegistry.register(definition);
    }
  }

  /** 打开 / 激活态是 UI 覆盖：按 ref 合并当前视图集合。 */
  private applyViewStates(groups: ListGroup[]): void {
    const views = this.deps.viewHost.list();
    const byRef = new Map(
      views
        .map((view) => [view.document?.id ?? view.url, view] as const)
        .filter(([ref]) => Boolean(ref)),
    );
    for (const group of groups) {
      for (const item of group.items) {
        if (item.itemType !== 'document') continue;
        const ref = String(item.meta?.['ref'] ?? '');
        const view = byRef.get(ref);
        if (!view) continue;
        item.meta = { ...item.meta, viewId: view.id };
        item.state = { ...item.state, open: true, active: view.active };
      }
    }
  }

  async snapshot(workspaceEpoch: number): Promise<ListSnapshot> {
    const groups: ListGroup[] = [];
    for (const entry of listRegistry.providers()) {
      const definition = entry.definition;
      try {
        const ctx = this.deps.contexts.context(entry.owner);
        const custom = await entry.provider(ctx);
        for (const group of custom) {
          groups.push({
            id: `${definition.id}:${group.id}`,
            definitionId: definition.id,
            section: definition.section ?? 'resources',
            label: group.label,
            ...(group.icon || definition.icon
              ? { icon: group.icon ?? definition.icon }
              : {}),
            ...(group.tone || definition.tone
              ? { tone: group.tone ?? definition.tone }
              : {}),
            ...(group.unit || definition.unit
              ? { unit: group.unit ?? definition.unit }
              : {}),
            countLabel: countLabelOf(
              group.items.length,
              group.unit ?? definition.unit,
              group.countLabel ?? definition.countLabel,
            ),
            updatedAt: group.updatedAt ?? latestOf(group.items),
            order: group.order,
            count: group.items.length,
            state: 'ready',
            fields: definition.fields,
            actions: definition.actions,
            ...(group.empty || definition.empty
              ? { empty: group.empty ?? definition.empty }
              : {}),
            items: group.items,
          });
        }
      } catch (error) {
        groups.push({
          id: `${definition.id}:error`,
          definitionId: definition.id,
          section: definition.section ?? 'resources',
          label: definition.label,
          ...(definition.icon ? { icon: definition.icon } : {}),
          countLabel: '加载失败',
          updatedAt: 0,
          order: definition.order,
          count: 0,
          state: 'error',
          fields: definition.fields,
          actions: definition.actions,
          items: [],
          diagnostics: [error instanceof Error ? error.message : String(error)],
        });
      }
    }

    for (const [id, make] of [
      ['temp', () => this.tempGroup()],
      ['sessions', () => this.sessionsGroup()],
      ['plugins', () => this.pluginsGroup()],
      ['settings', () => this.settingsGroup()],
    ] as const) {
      try {
        const group = await make();
        if (group) groups.push(group);
      } catch (error) {
        const group = this.errorGroup(id, error);
        if (group) groups.push(group);
      }
    }

    this.applyViewStates(groups);

    groups.sort(
      (a, b) =>
        (listRegistry.get(a.definitionId)?.order ?? 0) -
        (listRegistry.get(b.definitionId)?.order ?? 0),
    );

    return { workspaceEpoch, groups };
  }

  private errorGroup(definitionId: string, error: unknown): ListGroup | null {
    const definition = listRegistry.get(definitionId);
    if (!definition) return null;
    return {
      id: definitionId,
      definitionId,
      section: definition.section ?? 'resources',
      label: definition.label,
      ...(definition.icon ? { icon: definition.icon } : {}),
      ...(definition.tone ? { tone: definition.tone } : {}),
      ...(definition.unit ? { unit: definition.unit } : {}),
      countLabel: '加载失败',
      updatedAt: 0,
      order: definition.order,
      count: 0,
      state: 'error',
      fields: definition.fields,
      actions: definition.actions,
      items: [],
      diagnostics: [error instanceof Error ? error.message : String(error)],
    };
  }

  private tempGroup(): ListGroup | null {
    const definition = listRegistry.get('temp');
    if (!definition) return null;
    const items: ListItem[] = this.deps.viewHost
      .list()
      .filter((view) => view.type === 'browser' && view.temporary)
      .map((view) => ({
        key: view.id,
        itemType: definition.itemType,
        title: view.title,
        subtitle: view.url,
        meta: { viewId: view.id, url: view.url },
        state: { open: true, active: view.active },
      }));
    if (items.length === 0) return null;
    return {
      id: 'temp',
      definitionId: definition.id,
      section: definition.section ?? 'resources',
      label: definition.label,
      ...(definition.icon ? { icon: definition.icon } : {}),
      ...(definition.tone ? { tone: definition.tone } : {}),
      ...(definition.unit ? { unit: definition.unit } : {}),
      countLabel: countLabelOf(
        items.length,
        definition.unit,
        definition.countLabel,
      ),
      updatedAt: latestOf(items),
      count: items.length,
      state: 'ready',
      fields: definition.fields,
      actions: definition.actions,
      items,
    };
  }

  private async sessionsGroup(): Promise<ListGroup> {
    const definition = listRegistry.get('sessions')!;
    const activePath = this.deps.agent.getSnapshot().sessionFile;
    const sessions = await this.deps.agent.listSessions();
    const items: ListItem[] = sessions.map((session) => ({
      key: session.path,
      itemType: definition.itemType,
      title: session.name,
      subtitle: session.preview ?? '',
      meta: {
        path: session.path,
        updatedAt: session.createdAt,
        messageCount: session.messageCount ?? 0,
      },
      state: { active: session.path === activePath },
    }));
    return {
      id: 'sessions',
      definitionId: definition.id,
      section: definition.section ?? 'resources',
      label: definition.label,
      ...(definition.icon ? { icon: definition.icon } : {}),
      ...(definition.tone ? { tone: definition.tone } : {}),
      ...(definition.unit ? { unit: definition.unit } : {}),
      countLabel: countLabelOf(
        items.length,
        definition.unit,
        definition.countLabel,
      ),
      updatedAt: latestOf(items),
      count: items.length,
      state: 'ready',
      fields: definition.fields,
      actions: definition.actions,
      ...(definition.empty ? { empty: definition.empty } : {}),
      items,
    };
  }

  private pluginsGroup(): ListGroup {
    const definition = listRegistry.get('plugins')!;
    const items: ListItem[] = this.deps.plugins
      .pluginInfoList()
      .map((plugin) => ({
        key: plugin.id,
        itemType: definition.itemType,
        title: plugin.name,
        subtitle: `v${plugin.version}`,
        ...(plugin.iconUrl ? { icon: plugin.iconUrl } : {}),
        meta: {
          pluginId: plugin.id,
          version: plugin.version,
          builtin: plugin.builtin,
        },
      }));
    return {
      id: 'plugins',
      definitionId: definition.id,
      section: definition.section ?? 'resources',
      label: definition.label,
      ...(definition.icon ? { icon: definition.icon } : {}),
      ...(definition.tone ? { tone: definition.tone } : {}),
      ...(definition.unit ? { unit: definition.unit } : {}),
      countLabel: countLabelOf(
        items.length,
        definition.unit,
        definition.countLabel,
      ),
      updatedAt: latestOf(items),
      count: items.length,
      state: 'ready',
      fields: definition.fields,
      actions: definition.actions,
      ...(definition.empty ? { empty: definition.empty } : {}),
      items,
    };
  }

  private settingsGroup(): ListGroup {
    const definition = listRegistry.get('settings')!;
    const items: ListItem[] = settingsPages().map((page) => ({
      key: page.id,
      itemType: definition.itemType,
      title: page.label,
      subtitle: page.desc,
      icon: page.icon,
      meta: { pageId: page.id, ref: `settings://${page.id}` },
    }));
    return {
      id: 'settings',
      definitionId: definition.id,
      section: definition.section ?? 'resources',
      label: definition.label,
      ...(definition.icon ? { icon: definition.icon } : {}),
      ...(definition.tone ? { tone: definition.tone } : {}),
      ...(definition.unit ? { unit: definition.unit } : {}),
      countLabel: countLabelOf(
        items.length,
        definition.unit,
        definition.countLabel,
      ),
      updatedAt: latestOf(items),
      count: items.length,
      state: 'ready',
      fields: definition.fields,
      actions: definition.actions,
      ...(definition.empty ? { empty: definition.empty } : {}),
      items,
    };
  }
}

function builtinDefinitions(): ListDefinition[] {
  return [
    {
      id: 'temp',
      label: '临时网页',
      icon: 'hourglass',
      tone: 'bg-zinc-500 text-zinc-50 dark:bg-zinc-600 dark:text-zinc-100',
      unit: '个标签',
      order: 30,
      sourceScope: 'workspace',
      itemType: 'link',
      fields: [{ key: 'title', type: 'text' }],
      actions: [OPEN_ACTION],
      grouping: 'flat',
    },
    {
      id: 'sessions',
      section: 'hidden',
      label: '会话',
      icon: 'messages',
      tone: 'bg-violet-500 text-violet-50 dark:bg-violet-600 dark:text-violet-100',
      unit: '个会话',
      order: 40,
      sourceScope: 'workspace',
      itemType: 'session',
      fields: [
        { key: 'title', type: 'text' },
        { key: 'subtitle', type: 'text' },
      ],
      actions: [OPEN_ACTION],
      empty: { icon: 'messages', text: '暂无会话' },
      grouping: 'flat',
    },
    {
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
    },
    {
      id: 'settings',
      section: 'settings',
      label: '设置',
      icon: 'sliders',
      tone: 'bg-zinc-500 text-zinc-50 dark:bg-zinc-600 dark:text-zinc-100',
      unit: '项',
      order: 60,
      sourceScope: 'app',
      itemType: 'settings',
      fields: [
        { key: 'title', type: 'text' },
        { key: 'subtitle', type: 'text' },
      ],
      actions: [OPEN_ACTION],
      grouping: 'flat',
    },
  ];
}
