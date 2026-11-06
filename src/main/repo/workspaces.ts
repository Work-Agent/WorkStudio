/** 工作区持久化：注册表 / 当前工作区 / 恢复 / 命名。 */

import {
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import type { WorkspaceMeta } from '../../shared/app';
import {
  ensureDefaultWorkspace,
  getWorkspaceId,
  listWorkspaces,
  registerWorkspace,
  removeWorkspaceState,
  workspaceLabel,
} from '../agent/workspace';
import { join } from 'node:path';
import { getWorkspaceBase } from '../agent/workspace';
import { readWindowState, writeWindowState } from '../window-state';

export interface WorkspacesStore {
  /** 工作区回落 / 切换时的提示（无则 null）。 */
  readonly notice: string | null;
  restore(): WorkspaceMeta;
  list(): WorkspaceMeta[];
  readCurrent(): string | null;
  register(path: string): WorkspaceMeta;
  rename(id: string, name: string): WorkspaceMeta | null;
  remove(id: string): void;
  writeCurrent(id: string | null): void;
}

export class WorkspacesRepo implements WorkspacesStore {
  private fallbackNotice: string | null = null;

  get notice(): string | null {
    return this.fallbackNotice;
  }

  /** 恢复上次工作区；不可写（目录被删 / macOS 拒绝文稿访问）时选下一个可用者。 */
  restore(): WorkspaceMeta {
    const restoredId = readWindowState().workspaceId;
    const registered = listWorkspaces();
    const ordered = [
      ...registered.filter((meta) => getWorkspaceId(meta.path) === restoredId),
      ...registered.filter((meta) => getWorkspaceId(meta.path) !== restoredId),
    ];
    const path =
      ordered.find((meta) => isWritableWorkspace(meta.path))?.path ??
      this.defaultWorkspace(ordered[0]?.path);
    const id = registerWorkspace(path);
    writeWindowState({ workspaceId: id });
    const meta = this.metaOf(id);
    if (!meta) throw new Error(`workspace ${path} not registered`);
    return meta;
  }

  list(): WorkspaceMeta[] {
    return listWorkspaces().map((meta) => this.toView(meta));
  }

  readCurrent(): string | null {
    return readWindowState().workspaceId;
  }

  register(path: string): WorkspaceMeta {
    const id = registerWorkspace(path);
    const meta = this.metaOf(id);
    if (!meta) throw new Error(`workspace ${path} not registered`);
    return meta;
  }

  rename(id: string, name: string): WorkspaceMeta | null {
    const meta = this.metaOf(id);
    if (!meta) return null;
    const file = join(getWorkspaceBase(id), 'workspace.json');
    mkdirSync(getWorkspaceBase(id), { recursive: true });
    let raw: Record<string, unknown> = {};
    try {
      raw = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>;
    } catch {
      /* 首写 */
    }
    writeFileSync(file, JSON.stringify({ ...raw, name }, null, 2), 'utf-8');
    return { ...meta, name };
  }

  remove(id: string): void {
    removeWorkspaceState(id);
  }

  writeCurrent(id: string | null): void {
    writeWindowState({ workspaceId: id });
  }

  /** 默认工作区；无可写工作区时用提示说明原因（回落数据根 / 切换目录）。 */
  private defaultWorkspace(inaccessible?: string): string {
    const { path, fallback } = ensureDefaultWorkspace();
    if (fallback) {
      this.fallbackNotice = `无法写入用户目录，默认工作区已创建在 ${path}`;
    } else if (inaccessible) {
      this.fallbackNotice = `无法访问工作区 ${inaccessible}，已切换到 ${path}`;
    }
    return path;
  }

  private toView(meta: {
    path: string;
    createdAt: number;
    lastOpenedAt: number;
  }): WorkspaceMeta {
    const id = getWorkspaceId(meta.path);
    return {
      id,
      path: meta.path,
      name: this.nameOf(id, meta.path),
      createdAt: meta.createdAt,
      lastOpenedAt: meta.lastOpenedAt,
    };
  }

  private metaOf(id: string): WorkspaceMeta | null {
    const meta = listWorkspaces().find(
      (item) => getWorkspaceId(item.path) === id,
    );
    return meta ? this.toView(meta) : null;
  }

  private nameOf(id: string, path: string): string {
    try {
      const raw = JSON.parse(
        readFileSync(join(getWorkspaceBase(id), 'workspace.json'), 'utf-8'),
      ) as { name?: unknown };
      if (typeof raw.name === 'string' && raw.name) return raw.name;
    } catch {
      /* 无文件 */
    }
    return workspaceLabel(path);
  }
}

/** 工作区可用 = 是目录且可写；macOS 拒绝文稿访问会在探测写入时暴露。 */
function isWritableWorkspace(path: string): boolean {
  const probe = join(path, `.workstudio.${process.pid}.probe`);
  try {
    if (!statSync(path).isDirectory()) return false;
    writeFileSync(probe, '');
    rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}
