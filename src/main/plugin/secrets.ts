/**
 * 插件密钥存储：每个插件一份 secrets.bin。
 *
 * safeStorage 加密后直接写二进制，不建明文索引、不 base64。
 * 写入按 pluginId 串行化，目录 0700 / 文件 0600；解密失败时把损坏文件
 * 改名保留，返回空，不静默覆盖。Linux 的 basic_text 后端视为不可用。
 */

import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { safeStorage } from 'electron';
import type { SecretsAvailability } from '@workstudio/sdk';

interface SecretsFile {
  version: 1;
  entries: Record<string, string>;
}

export class SecretsService {
  /** 同一 pluginId 的读写串行化，避免并发覆盖。 */
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

  async get(pluginId: string, key: string): Promise<string | null> {
    if (!this.availability().available) return null;
    const entries = await this.readUnlocked(pluginId);
    return entries[key] ?? null;
  }

  /** value === null 删除该 key。 */
  async set(
    pluginId: string,
    key: string,
    value: string | null,
  ): Promise<void> {
    const availability = this.availability();
    if (!availability.available) {
      throw new Error(`密钥存储不可用：${availability.reason ?? '未知原因'}`);
    }
    await this.enqueue(pluginId, async () => {
      const entries = await this.readUnlocked(pluginId);
      if (value === null) delete entries[key];
      else entries[key] = value;
      await this.writeUnlocked(pluginId, entries);
    });
  }

  private enqueue<T>(pluginId: string, run: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(pluginId) ?? Promise.resolve();
    const next = previous.then(run, run);
    this.queues.set(
      pluginId,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }

  private fileOf(pluginId: string): string {
    // pluginId 来自插件清单；拒绝路径分隔符等可穿越字符。
    if (!/^[A-Za-z0-9._@-]+$/.test(pluginId)) {
      throw new Error(`插件 id 非法：${pluginId}`);
    }
    return join(this.dataRoot, pluginId, 'secrets.bin');
  }

  private async readUnlocked(
    pluginId: string,
  ): Promise<Record<string, string>> {
    const file = this.fileOf(pluginId);
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
      await this.quarantine(pluginId);
      return {};
    }
  }

  private async writeUnlocked(
    pluginId: string,
    entries: Record<string, string>,
  ): Promise<void> {
    const file = this.fileOf(pluginId);
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const payload: SecretsFile = { version: 1, entries };
    const encrypted = safeStorage.encryptString(JSON.stringify(payload));
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, encrypted, { mode: 0o600 });
    await chmod(temp, 0o600).catch(() => undefined);
    await rename(temp, file);
    await chmod(file, 0o600).catch(() => undefined);
  }

  private async quarantine(pluginId: string): Promise<void> {
    const file = this.fileOf(pluginId);
    const target = `${file}.corrupt-${Date.now()}`;
    await rename(file, target).catch(() => undefined);
  }
}
