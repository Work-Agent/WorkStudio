/**
 * 密钥库：App 级、按域（owner）分文件的加密存储。
 *
 * - 落盘用 Electron safeStorage，密文直写，不建明文索引、不 base64；
 * - 每个 owner 一份 `secrets.bin`，目录 0700 / 文件 0600；
 * - 一个 owner 内的读写串行化，解密失败时把损坏文件改名保留、返回空；
 * - 调用方只拿 `scope(owner)` 得到的能力，不能跨域读写。
 *
 * owner 约定：`plugin:<pluginId>`（插件私有）、`provider:<host>`（每个供应商一个域，
 * 用它的域名做 key）、`agent`（旧版供应商凭证域，仅迁移用）。
 */

import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { safeStorage } from 'electron';
import type { SecretsAvailability } from '@work-studio/sdk';

interface SecretsFile {
  version: 1;
  entries: Record<string, string>;
}

export interface VaultScope {
  readonly owner: string;
  availability(): SecretsAvailability;
  get(key: string): Promise<string | null>;
  /** value === null 删除该 key。 */
  set(key: string, value: string | null): Promise<void>;
  /** 本域已有的 key（不含值），用于状态枚举。 */
  keys(): Promise<string[]>;
}

export class SecretVault {
  /** 同一 owner 的读写串行化，避免并发覆盖。 */
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(private readonly dataRoot: string) {}

  availability(): SecretsAvailability {
    if (!safeStorage.isEncryptionAvailable()) {
      return { available: false, reason: '系统加密存储不可用' };
    }
    if (process.platform !== 'linux') return { available: true };
    // Linux 上 safeStorage 可能退化到 basic_text（明文）后端；按不可用处理。
    let backend = '';
    try {
      backend = safeStorage.getSelectedStorageBackend();
    } catch {
      return { available: false, reason: '无法读取系统密钥后端' };
    }
    if (backend === 'basic_text') {
      return {
        available: false,
        backend,
        reason: 'Linux 未配置 libsecret/kwallet，safeStorage 退化为明文后端',
      };
    }
    return backend ? { available: true, backend } : { available: true };
  }

  /** 插件域：调用方只给插件 id，域前缀由这里拼，插件拿不到别的域。 */
  forPlugin(pluginId: string): VaultScope {
    if (!/^[A-Za-z0-9._@-]+$/.test(pluginId)) {
      throw new Error(`插件 id 非法：${pluginId}`);
    }
    return this.scopeOf(`plugin:${pluginId}`);
  }

  /** 供应商域：key 是它的域名（host[:port]），一个供应商一份文件。 */
  forProvider(host: string): VaultScope {
    const value = host.trim().toLowerCase();
    if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/.test(value)) {
      throw new Error(`供应商域名非法：${host}`);
    }
    return this.scopeOf(`provider:${value}`);
  }

  /** 旧版供应商凭证域：只用于迁移到 `provider:<host>`。 */
  forAgent(): VaultScope {
    return this.scopeOf('agent');
  }

  /** 域内能力；owner 里不允许出现路径穿越字符。 */
  private scopeOf(owner: string): VaultScope {
    if (!/^[A-Za-z0-9._:@+-]+$/.test(owner)) {
      throw new Error(`密钥域非法：${owner}`);
    }
    return {
      owner,
      availability: () => this.availability(),
      get: (key) => this.get(owner, key),
      set: (key, value) => this.set(owner, key, value),
      keys: async () => {
        if (!this.availability().available) return [];
        return Object.keys(await this.readUnlocked(owner));
      },
    };
  }

  private async get(owner: string, key: string): Promise<string | null> {
    if (!this.availability().available) return null;
    const entries = await this.readUnlocked(owner);
    return entries[key] ?? null;
  }

  private async set(
    owner: string,
    key: string,
    value: string | null,
  ): Promise<void> {
    const availability = this.availability();
    if (!availability.available) {
      throw new Error(`密钥存储不可用：${availability.reason ?? '未知原因'}`);
    }
    await this.enqueue(owner, async () => {
      const entries = await this.readUnlocked(owner);
      if (value === null) delete entries[key];
      else entries[key] = value;
      await this.writeUnlocked(owner, entries);
    });
  }

  private enqueue<T>(owner: string, run: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(owner) ?? Promise.resolve();
    const next = previous.then(run, run);
    this.queues.set(
      owner,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }

  /**
   * `plugin:<id>` 落在插件数据目录（`plugins/data/<id>`，老安装零迁移），
   * 其它域落在 `secrets/<owner>`。
   */
  private fileOf(owner: string): string {
    const [kind, id] = owner.split(':', 2);
    const dir =
      kind === 'plugin' && id
        ? join(this.dataRoot, 'plugins', 'data', id)
        : join(this.dataRoot, 'secrets', owner.replace(/[:@+]/g, '_'));
    return join(dir, 'secrets.bin');
  }

  private async readUnlocked(owner: string): Promise<Record<string, string>> {
    const file = this.fileOf(owner);
    const raw = await readFile(file).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    });
    if (!raw) return {};
    try {
      const decrypted = safeStorage.decryptString(raw);
      const parsed = JSON.parse(decrypted) as Partial<SecretsFile>;
      if (
        parsed.version !== 1 ||
        typeof parsed.entries !== 'object' ||
        parsed.entries === null
      ) {
        return {};
      }
      const entries: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed.entries)) {
        if (typeof value === 'string') entries[key] = value;
      }
      return entries;
    } catch {
      await this.quarantine(owner);
      return {};
    }
  }

  private async writeUnlocked(
    owner: string,
    entries: Record<string, string>,
  ): Promise<void> {
    const file = this.fileOf(owner);
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const payload: SecretsFile = { version: 1, entries };
    const encrypted = safeStorage.encryptString(JSON.stringify(payload));
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, encrypted, { mode: 0o600 });
    await chmod(temp, 0o600).catch(() => undefined);
    await rename(temp, file);
    await chmod(file, 0o600).catch(() => undefined);
  }

  private async quarantine(owner: string): Promise<void> {
    const file = this.fileOf(owner);
    const target = `${file}.corrupt-${Date.now()}`;
    await rename(file, target).catch(() => undefined);
  }
}
