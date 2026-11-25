/**
 * 插件文件托管：页面永远拿不到绝对路径。
 *
 *   in:<uuid>   页面选择的文件 → 复制进插件临时区，逻辑层按 token 读取
 *   save:<uuid> 保存对话框 → 内存 token，逻辑层按 token 写出
 *
 * 复制件与令牌都绑定 pluginId；卸载时清理复制件与内存令牌。
 */

import { chmod, copyFile, lstat, mkdir, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const MAX_IMPORT_BYTES = 40 * 1024 * 1024;
const SAVE_TOKEN_TTL = 15 * 60 * 1000;
const PLUGIN_ID = /^[A-Za-z0-9._@-]+$/;
const INPUT_TOKEN = /^in:([0-9a-f-]{36})$/;
const SAVE_TOKEN = /^save:([0-9a-f-]{36})$/;

interface SaveToken {
  pluginId: string;
  path: string;
  expiresAt: number;
}

export interface ImportedFile {
  token: string;
  name: string;
  size: number;
}

function checkPluginId(pluginId: string): void {
  if (!PLUGIN_ID.test(pluginId)) throw new Error(`插件 id 非法：${pluginId}`);
}

/** 只保留文件名，去掉控制字符与路径分隔符。 */
function safeName(value: string): string {
  const name = basename(value)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 200);
  return name || '文件';
}

export class PluginFiles {
  private readonly saveTokens = new Map<string, SaveToken>();

  constructor(private readonly tempRoot: string) {}

  /** 页面选择的文件：复制到插件临时区，返回逻辑层可解析的 token。 */
  async importFile(
    pluginId: string,
    sourcePath: string,
    suggestedName?: string,
  ): Promise<ImportedFile> {
    checkPluginId(pluginId);
    if (!sourcePath || sourcePath.includes('\u0000')) {
      throw new Error('文件路径不可用');
    }
    const info = await lstat(sourcePath);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error('只能导入普通文件');
    }
    if (info.size > MAX_IMPORT_BYTES) {
      throw new Error('文件超过 40MB');
    }
    const directory = this.incomingDir(pluginId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const id = randomUUID();
    const target = join(directory, id);
    await copyFile(sourcePath, target);
    await chmod(target, 0o600).catch(() => undefined);
    const name = safeName(suggestedName || sourcePath);
    return { token: `in:${id}`, name, size: info.size };
  }

  /** 页面导入的 token → 绝对路径；只接受宿主签发的 in: token。 */
  resolveInput(pluginId: string, token: string): string {
    checkPluginId(pluginId);
    const match = INPUT_TOKEN.exec(token);
    if (!match) throw new Error('文件 token 无效');
    return join(this.incomingDir(pluginId), match[1]!);
  }

  /** 保存对话框返回的路径 → 内存 token（15 分钟有效，可重试）。 */
  issueSaveToken(
    pluginId: string,
    path: string,
  ): { token: string; name: string } {
    checkPluginId(pluginId);
    if (!path || path.includes('\u0000')) throw new Error('保存路径不可用');
    const token = `save:${randomUUID()}`;
    this.saveTokens.set(token, {
      pluginId,
      path,
      expiresAt: Date.now() + SAVE_TOKEN_TTL,
    });
    return { token, name: safeName(path) };
  }

  resolveSave(pluginId: string, token: string): string {
    checkPluginId(pluginId);
    const match = SAVE_TOKEN.exec(token);
    if (!match) throw new Error('文件 token 无效');
    const entry = this.saveTokens.get(`save:${match[1]}`);
    if (!entry || entry.pluginId !== pluginId) {
      throw new Error('文件 token 无效或已过期');
    }
    if (entry.expiresAt < Date.now()) {
      this.saveTokens.delete(token);
      throw new Error('文件 token 已过期');
    }
    return entry.path;
  }

  /** 卸载：删除导入复制件与内存令牌；数据/临时目录由 PluginStore 统一清理。 */
  async removePlugin(pluginId: string): Promise<void> {
    checkPluginId(pluginId);
    for (const [token, entry] of this.saveTokens) {
      if (entry.pluginId === pluginId) this.saveTokens.delete(token);
    }
    await rm(this.tempDirOf(pluginId), { recursive: true, force: true }).catch(
      () => undefined,
    );
  }

  private tempDirOf(pluginId: string): string {
    return join(this.tempRoot, pluginId);
  }

  private incomingDir(pluginId: string): string {
    return join(this.tempDirOf(pluginId), 'incoming');
  }
}
