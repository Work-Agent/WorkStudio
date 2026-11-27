/**
 * System 模块的唯一组合入口。
 *
 * App 不直接认识任何具体模块或域；这里把模块注册进 DomainRegistry，
 * 由注册表负责 attach / start / stop / revoke。
 */

import type { AppearanceStore } from './platform/appearance.ts';
import type { StorageLayout } from './platform/paths.ts';
import type { SecretVault } from './platform/vault.ts';
import type { ResourceNode } from '../shared/resources.ts';
import type { TransportRouter } from './transport/router.ts';
import type { WebCache } from './transport/web-cache.ts';
import { BrowserCapability } from './domains/browser/capability.ts';
import { BrowserModule } from './domains/browser/module.ts';
import { tabsResourceName } from './domains/browser/domains.ts';
import { AgentModule } from './domains/agent/module.ts';
import { ToolSurface } from './domains/agent/tools.ts';
import { PluginModule } from './domains/plugin/module.ts';
import type { SettingsPage } from './domains/settings/domains.ts';
import { DEFAULT_SETTINGS_PAGES } from './domains/settings/pages.ts';
import { SettingsModule } from './domains/settings/module.ts';
import { snapshotTitle } from '../shared/snapshots.ts';
import { ShellModule } from './domains/shell/module.ts';
import type { ShellHost } from './domains/shell/native.ts';
import { WorkspaceModule } from './domains/workspace/module.ts';
import { WorkspaceRepository } from './domains/workspace/repo.ts';
import type { Protocols } from './protocols.ts';
import type { PluginFiles } from './plugin/files.ts';
import type { PluginLifecycle } from './plugin/lifecycle.ts';
import type { PluginManager } from './plugin/manager.ts';
import type { PluginService } from './plugin/service.ts';
import type { PluginStore } from './plugin/store.ts';
import type { ResourceForestService } from './domains/workspace/resources.ts';
import type { DomainRegistry } from './registry/registry.ts';
import { createLog } from './log.ts';

export type { SettingsPage };

export interface SystemModulesOptions {
  storage: StorageLayout;
  /** 运行档目录（userData）：数据根指针写在这里，不再自行推导。 */
  profileDir: string;
  /** App 级密钥库：插件域与供应商凭证共用一份。 */
  vault: SecretVault;
  /** 已有工作区的默认目录（开发模式 = cwd）；缺省时首次启动会先询问目录。 */
  workspaceRoot?: string;
  protocols: Protocols;
  transport: TransportRouter;
  cache: WebCache;
  plugins: PluginManager;
  lifecycle: PluginLifecycle;
  pluginStore: PluginStore;
  pluginService: PluginService;
  pluginFiles: PluginFiles;
  resources: ResourceForestService;
  builtinPluginIds?: ReadonlySet<string>;
  appearance: AppearanceStore;
  shellHost?: ShellHost;
  openNode?: (node: ResourceNode, workspaceId: string) => Promise<unknown>;
  openLocation?: (ref: string, locator?: string) => Promise<unknown>;
  /** 首次启动选目录（原生面板，顺带完成目录授权）。 */
  pickWorkspace?: () => Promise<string | null>;
  settingsPages?: SettingsPage[];
}

export function registerSystemModules(
  registry: DomainRegistry,
  options: SystemModulesOptions,
): void {
  const browser = new BrowserCapability(
    options.shellHost,
    async (windowId, input) => {
      const result = await registry.dispatchCommand(
        { domain: 'shell', resource: `${windowId}/views` },
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
    },
  );
  const tools = new ToolSurface(
    options.transport,
    registry,
    browser,
    options.cache,
    options.openLocation,
  );
  const repo = new WorkspaceRepository(options.storage, options.workspaceRoot);

  registry.registerModule(
    new ShellModule({
      protocols: options.protocols,
      appearance: options.appearance,
      storage: options.storage,
      files: options.pluginFiles,
      ...(options.shellHost ? { host: options.shellHost } : {}),
    }),
  );
  registry.registerModule(
    new WorkspaceModule(
      repo,
      options.transport,
      options.resources,
      options.openNode,
      options.pickWorkspace,
      () =>
        options.cache.list().map((doc) => ({
          ...doc,
          title: snapshotTitle(doc),
          ref: doc.fileRef ?? options.cache.refOf(doc.url),
        })),
    ),
  );
  registry.registerModule(
    new PluginModule(
      options.pluginStore,
      options.pluginService,
      options.lifecycle,
      options.builtinPluginIds ?? new Set(),
    ),
  );
  registry.registerModule(
    new SettingsModule({
      layout: options.storage,
      profileDir: options.profileDir,
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
  const agent = new AgentModule(
    tools,
    options.storage,
    browser,
    options.vault,
    options.plugins,
    createPageOpener(registry, options.shellHost),
  );
  registry.registerModule(agent);
  // 技能层是插件引擎命令的开关：技能未选中时，它的域不进命令表也拒绝执行。
  tools.bindSkillOwners(() => agent.activeSkillOwners());
  // 插件写凭证走这里：provider 存在性由 agent 校验，范围由插件清单声明。
  options.plugins?.bindCredentials({
    write: (providerId, input) => agent.writeCredential(providerId, input),
    clear: (providerId) => agent.clearCredential(providerId),
  });
}

/**
 * 授权页走应用自己的标签页：浏览器能力已经是宿主的一部分，
 * 没有理由再交给系统浏览器（会话上下文、关闭时机、回跳都无法控制）。
 */
function createPageOpener(
  registry: DomainRegistry,
  shellHost: ShellHost | undefined,
): ((url: string) => Promise<void>) | undefined {
  if (!shellHost) return undefined;
  const log = createLog('agent');
  return async (url: string): Promise<void> => {
    const windowId = shellHost.activeWindow();
    if (!windowId) throw new Error('没有活动窗口，无法打开授权页');
    const result = await registry.dispatchCommand(
      { domain: 'browser', resource: tabsResourceName(windowId) },
      'open',
      { url },
      {
        origin: { type: 'service', id: 'agent' },
        changed: (ref, type) => registry.changed(ref, type),
        log,
      },
    );
    if (!result.ok) {
      throw new Error(`打开授权页失败：${result.error.message}`);
    }
  };
}
