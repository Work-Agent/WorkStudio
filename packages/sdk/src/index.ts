/**
 * @workstudio/sdk
 *
 * 插件作者只需要两个入口：
 *   - 引擎：`definePlugin` / `locator` / 契约类型
 *   - 页面：`import '@workstudio/sdk/global'`，直接使用 window.workStudio
 */
export type {
  CallError,
  CallErrorCode,
  CallResult,
  ChangeType,
  DomainUpdate,
  FileToken,
  WorkStudioBridge,
} from './bridge.ts';
export type { ArgSpec, CommandDecl, CommandDescriptor } from './command.ts';
export type {
  Log,
  PluginContext,
  PluginFs,
  PluginSettings,
} from './context.ts';
export type {
  PluginCommand,
  PluginCommandExposure,
  PluginCommandInput,
  PluginContribution,
  PluginLifecycle,
} from './contribution.ts';
export type {
  ListActionSpec,
  ListDefinition,
  ListFieldSpec,
  ListGroup,
  ListItem,
  ListProviderContext,
  ListSection,
  ListSnapshot,
  ListSourceScope,
  PluginList,
} from './list.ts';
export type { WorkStudioManifest } from './manifest.ts';
export type {
  Claim,
  Entry,
  Item,
  ListOptions,
  Locator,
  ReadOptions,
  ResourceAdapter,
} from './resource.ts';
export type {
  PluginEvents,
  PluginFiles,
  PluginScope,
  PluginScopeSettings,
  PluginSecrets,
  SecretsAvailability,
} from './scope.ts';
export { locator } from './command.ts';
export { definePlugin } from './contribution.ts';
