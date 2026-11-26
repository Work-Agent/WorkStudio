/**
 * @work-studio/sdk
 *
 * 插件作者只需要两个入口：
 *   - 引擎：`definePlugin` / `locator` / 契约类型
 *   - 页面：`import '@work-studio/sdk/global'`，直接使用 window.workStudio
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
  PluginResourceGroup,
  ResourceActionRequest,
  ResourceActionSpec,
  ResourceChildrenRequest,
  ResourceContext,
  ResourceFieldSpec,
  ResourceForest,
  ResourceGroup,
  ResourceGroupDefinition,
  ResourceNode,
  ResourceSection,
  ResourceSource,
  ResourceSourceScope,
} from './resource-tree.ts';
export type {
  PluginCatalogView,
  PluginRegistryEntry,
  PluginRegistrySnapshot,
  PluginRegistryState,
  PluginTaskView,
} from './plugin-registry.ts';
export type { WorkStudioManifest } from './manifest.ts';
export type {
  Claim,
  Entry,
  Item,
  ListOptions,
  Locator,
  OpenTarget,
  ReadOptions,
  ResourceAdapter,
  ResourceRoot,
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
