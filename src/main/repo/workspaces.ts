/** 工作区持久化：注册表 / 当前工作区 / 恢复 / 命名。 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { WorkspaceMeta } from '../../shared/app';
import {
  ensureDefaultWorkspace,
  getCurrentWorkspace,
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
  restore(): WorkspaceMeta;
  list(): WorkspaceMeta[];
  readCurrent(): string | null;
  register(path: string): WorkspaceMeta;
  rename(id: string, name: string): WorkspaceMeta | null;
  remove(id: string): void;
  writeCurrent(id: string | null): void;
}

export class WorkspacesRepo implements WorkspacesStore {
  constructor(private readonly documentsDir: string) {}

  /** 首次启动创建默认工作区；恢复上次窗口工作区，失败回落到最近工作区。 */
  restore(): WorkspaceMeta {
    if (listWorkspaces().length === 0) {
      ensureDefaultWorkspace(this.documentsDir);
    }
    const restoredId = readWindowState().workspaceId;
    const restored = restoredId
      ? listWorkspaces().find(
          (meta) => getWorkspaceId(meta.path) === restoredId,
        )
      : undefined;
    const path =
      restored && existsSync(restored.path)
        ? restored.path
        : getCurrentWorkspace();
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
