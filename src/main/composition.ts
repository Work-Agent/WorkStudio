/**
 * System 模块的唯一组合入口。
 *
 * App 不直接认识任何具体模块或域；这里把模块注册进 DomainRegistry，
 * 由注册表负责 attach / start / stop / revoke。
 */

import type { AppearanceStore } from './platform/appearance.ts';
import type { StorageLayout } from './platform/paths.ts';
import type { ListItem } from '../shared/lists.ts';
import type { TransportRouter } from './transport/router.ts';
import type { WebCache } from './transport/web-cache.ts';
import { BrowserCapability } from './domains/browser/capability.ts';
import { BrowserModule } from './domains/browser/module.ts';
import { AgentContext } from './domains/agent/context.ts';
import { AgentModule } from './domains/agent/module.ts';
import { ToolSurface } from './domains/agent/tools.ts';
import { PluginModule } from './domains/plugin/module.ts';
import type { SettingsPage } from './domains/settings/domains.ts';
import { DEFAULT_SETTINGS_PAGES } from './domains/settings/pages.ts';
import { SettingsModule } from './domains/settings/module.ts';
import { ShellModule } from './domains/shell/module.ts';
import type { ShellHost } from './domains/shell/native.ts';
import { WorkspaceModule } from './domains/workspace/module.ts';
import { WorkspaceRepository } from './domains/workspace/repo.ts';
import type { Protocols } from './protocols.ts';
import type { PluginLifecycle } from './plugin/lifecycle.ts';
import type { PluginManager } from './plugin/manager.ts';
import type { PluginService } from './plugin/service.ts';
import type { PluginStore } from './plugin/store.ts';
import type { DomainRegistry } from './registry/registry.ts';
import { createLog } from './log.ts';

export type { SettingsPage };

export interface SystemModulesOptions {
  storage: StorageLayout;
  workspaceRoot: string;
  protocols: Protocols;
  transport: TransportRouter;
  cache: WebCache;
  plugins: PluginManager;
  lifecycle: PluginLifecycle;
  pluginStore: PluginStore;
  pluginService: PluginService;
  appearance: AppearanceStore;
  shellHost?: ShellHost;
  openItem?: (item: ListItem) => Promise<unknown>;
  settingsPages?: SettingsPage[];
}

export function registerSystemModules(
  registry: DomainRegistry,
  options: SystemModulesOptions,
): void {
  const browser = new BrowserCapability(options.shellHost, async (input) => {
    const result = await registry.dispatchCommand(
      { domain: 'shell', resource: 'views' },
      'open',
      {
        id: input.id,
        type: 'web',
        title: input.title,
        url: input.url,
      },
      {
        origin: { type: 'service', id: 'browser' },
        changed: (ref, type) => registry.changed(ref, type),
        log: createLog('browser'),
      },
    );
    if (!result.ok) throw new Error(result.error.message);
    return result.data as { id: string; title: string; url?: string };
  });
  const context = new AgentContext();
  const tools = new ToolSurface(
    options.transport,
    registry,
    browser,
    options.cache,
  );
  const repo = new WorkspaceRepository(options.storage, options.workspaceRoot);

  registry.registerModule(
    new ShellModule({
      protocols: options.protocols,
      appearance: options.appearance,
      storage: options.storage,
      ...(options.shellHost ? { host: options.shellHost } : {}),
    }),
  );
  registry.registerModule(
    new WorkspaceModule(repo, options.transport, options.openItem),
  );
  registry.registerModule(
    new PluginModule(
      options.pluginStore,
      options.pluginService,
      options.lifecycle,
    ),
  );
  registry.registerModule(
    new SettingsModule({
      layout: options.storage,
      pages: options.settingsPages ?? DEFAULT_SETTINGS_PAGES,
    }),
  );
  registry.registerModule(
    new BrowserModule(
      browser,
      options.transport,
      options.cache,
      options.storage,
    ),
  );
  registry.registerModule(
    new AgentModule(context, tools, options.storage, browser, options.plugins),
  );
}
