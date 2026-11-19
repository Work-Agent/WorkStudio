import type { ListSnapshot } from '../../../shared/lists.ts';
import type { AgentHost } from '../agent/agent-host.ts';
import type { PluginHost } from '../plugins/host.ts';
import type { SettingsPage } from '../settings/registry.ts';
import type { ListContexts } from '../ura/contexts.ts';
import { docsDefinition, docsProvider } from './builtins/docs.ts';
import { pluginsDefinition, pluginsProvider } from './builtins/plugins.ts';
import { sessionsDefinition, sessionsProvider } from './builtins/sessions.ts';
import { settingsDefinition, settingsProvider } from './builtins/settings.ts';
import {
  tempDefinition,
  tempProvider,
  type TempView,
} from './builtins/temp.ts';
import { listRegistry } from './registry.ts';
import { buildListSnapshot } from './snapshot.ts';

export interface ListsRuntime {
  snapshot(workspaceEpoch?: number): Promise<ListSnapshot>;
}

export interface ListsRuntimeDeps {
  contexts: ListContexts;
  viewHost: { list(): TempView[] };
  sessions: () => {
    activePath: string | null;
    list: Array<{
      path: string;
      name: string;
      preview?: string;
      createdAt: number;
      messageCount?: number;
    }>;
  };
  plugins: () => PluginHost;
  settingsPages: () => SettingsPage[];
}

export type ViewsForLists = {
  list(): TempView[];
};

export function createListsRuntime(deps: ListsRuntimeDeps): ListsRuntime {
  // 内置 provider 仍注册到同一个 registry；插件通过 SDK 注册同一 registry。
  listRegistry.register(docsDefinition, docsProvider, 'system');
  listRegistry.register(
    tempDefinition,
    tempProvider(() => deps.viewHost.list()),
    'system',
  );
  listRegistry.register(
    sessionsDefinition,
    sessionsProvider(deps.sessions),
    'system',
  );
  listRegistry.register(
    pluginsDefinition,
    pluginsProvider(deps.plugins),
    'system',
  );
  listRegistry.register(
    settingsDefinition,
    settingsProvider(deps.settingsPages),
    'system',
  );
  return {
    snapshot: (epoch = 0) =>
      buildListSnapshot(
        {
          registry: listRegistry,
          contexts: deps.contexts,
          viewHost: deps.viewHost,
        },
        epoch,
      ),
  };
}

export type { AgentHost };
