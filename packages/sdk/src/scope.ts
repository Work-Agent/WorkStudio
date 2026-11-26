/**
 * 插件作用域：激活期由宿主创建，承载跨命令、跨后台任务的全局上下文。
 *
 * 与 `PluginContext`（每条命令一份快照）不同，scope 在
 * `lifecycle.activate(scope)` 时注入，`deactivate(scope)` 后失效。
 * 这里没有进程对象、窗口或任意文件系统；路径只限插件自己的数据目录，
 * 外部文件必须走宿主签发的不透明 token。
 */

import type { Log } from './context.ts';
import type { PluginCredentials } from './credentials.ts';

export interface SecretsAvailability {
  available: boolean;
  backend?: string;
  reason?: string;
}

/** 插件设置：按键读写，写入会同步落盘并发布 `<pluginId>/settings`。 */
export interface PluginScopeSettings {
  get<T>(key: string, fallback: T): T;
  set(patch: Record<string, unknown>): void;
  /** 监听某个键的变化；返回取消订阅。 */
  watch<T>(key: string, callback: (next: T) => void): () => void;
}

/** 插件密钥：业务代码只拿到明文，密文由宿主的 safeStorage 管理。 */
export interface PluginSecrets {
  availability(): SecretsAvailability;
  get(key: string): Promise<string | null>;
  set(key: string, value: string | null): Promise<void>;
}

/** 插件事件：发布到 `<pluginId>/events`，页面与列表依赖可订阅。 */
export interface PluginEvents {
  emit(name: string, data?: unknown): void;
}

/**
 * 文件 token 解析：
 *   - `resolveInput` 只接受页面通过 `fileToken()` 导入的 `in:` token；
 *   - `resolveSave` 只接受 `saveFile` 对话框签发的 `save:` token。
 * 插件自己的临时文件由插件在 `tempDir` 内自行管理。
 */
export interface PluginFiles {
  resolveInput(token: string): string;
  resolveSave(token: string): string;
}

export interface PluginScope {
  readonly pluginId: string;
  /** 插件私有数据目录（DB / 缓存 / settings / secrets）。 */
  readonly dataDir: string;
  /** 插件私有临时目录；卸载时随数据目录一起清理。 */
  readonly tempDir: string;
  readonly settings: PluginScopeSettings;
  readonly secrets: PluginSecrets;
  /** 供应商凭证：只写不读，范围由清单 `credentials` 声明。 */
  readonly credentials: PluginCredentials;
  readonly events: PluginEvents;
  readonly files: PluginFiles;
  readonly log: Log;
}
