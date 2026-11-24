/**
 * 工作区注册表（architecture.md §5.3）—— 目录自描述，无独立「当前选中」文件。
 *
 * <data-root>/                        ← 即 pi 的 agent dir（数据根，可配置）
 *   models.json / auth.json / settings.json
 *   workspaces/<wsId>/workspace.json   ← { path, createdAt, lastOpenedAt }（唯一事实源）
 *     settings.json / sessions/ / ui-state.json
 *
 * 「当前工作区」= lastOpenedAt 最大且路径仍存在者；切换 = 注册（bump lastOpenedAt）。
 */
import { createHash } from 'crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { basename, join } from 'path';
import { homedir } from 'os';
import type { StoragePaths } from '../runtime/storage/storage-paths.ts';

let storage: StoragePaths | null = null;

/** 存储路径注入一次；工作区与 agentDir 从这里派生，不再读全局 data-root。 */
export function initWorkspaceStorage(paths: StoragePaths): void {
  storage = paths;
  mkdirSync(paths.dataRoot, { recursive: true });
}

export function getAgentDir(): string {
  if (!storage)
    throw new Error(
      'workspace storage not initialized — call initWorkspaceStorage() at bootstrap',
    );
  return storage.dataRoot;
}

/** workspace → 稳定短 id（目录名安全）。 */
export function getWorkspaceId(workspacePath: string): string {
  return createHash('sha1').update(workspacePath).digest('hex').slice(0, 12);
}

export interface WorkspaceMeta {
  path: string;
  createdAt: number;
  lastOpenedAt: number;
}

/** per-workspace 数据根目录（sessions / settings.json / ui-state.json 的父目录）。 */
export function getWorkspaceBase(wsId: string): string {
  if (!storage) throw new Error('workspace storage not initialized');
  return storage.workspaceBase(wsId);
}

export function getSessionsDir(wsId: string): string {
  if (!storage) throw new Error('workspace storage not initialized');
  return storage.sessionsDir(wsId);
}

/** 注册（= 打开）工作区：mkdir + 写自描述 workspace.json（幂等）。 */
export function registerWorkspace(workspacePath: string): string {
  const wsId = getWorkspaceId(workspacePath);
  const metaFile = join(getWorkspaceBase(wsId), 'workspace.json');
  mkdirSync(getSessionsDir(wsId), { recursive: true });
  const now = Date.now();
  let meta: WorkspaceMeta = {
    path: workspacePath,
    createdAt: now,
    lastOpenedAt: now,
  };
  try {
    const existing = JSON.parse(
      readFileSync(metaFile, 'utf-8'),
    ) as Partial<WorkspaceMeta>;
    meta = {
      ...existing,
      path: workspacePath,
      createdAt: existing.createdAt ?? now,
      lastOpenedAt: now,
    };
  } catch {
    /* 首开 */
  }
  writeFileSync(metaFile, JSON.stringify(meta, null, 2), 'utf-8');
  return wsId;
}

/** 全部已注册工作区（lastOpenedAt 降序；孤儿目录跳过）。 */
export function listWorkspaces(): WorkspaceMeta[] {
  if (!storage) throw new Error('workspace storage not initialized');
  const root = storage.workspacesRoot;
  let ids: string[];
  try {
    ids = readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
  const metas: WorkspaceMeta[] = [];
  for (const id of ids) {
    try {
      const raw = JSON.parse(
        readFileSync(join(root, id, 'workspace.json'), 'utf-8'),
      ) as Partial<WorkspaceMeta>;
      if (typeof raw.path === 'string') {
        metas.push({
          path: raw.path,
          createdAt: raw.createdAt ?? 0,
          lastOpenedAt: raw.lastOpenedAt ?? 0,
        });
      }
    } catch {
      /* 无 workspace.json = 孤儿目录，跳过 */
    }
  }
  return metas.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

/** 当前工作区 = 最近打开且仍存在者；无则抛错（调用方负责首装引导）。 */
export function getCurrentWorkspace(): string {
  for (const m of listWorkspaces()) {
    if (existsSync(m.path)) return m.path;
  }
  throw new Error('No registered workspace found');
}

/**
 * 首装引导：默认工作区建在用户目录（`~/WorkStudio`），三平台一致，不落入
 * macOS「文稿」等受 TCC 保护的位置；用户目录不可写时回落到数据根。
 */
export function ensureDefaultWorkspace(): {
  path: string;
  fallback: boolean;
} {
  const candidates = [
    { path: join(homedir(), 'WorkStudio'), fallback: false },
    {
      path: storage ? join(storage.dataRoot, 'WorkStudio') : '',
      fallback: true,
    },
  ];
  for (const candidate of candidates) {
    try {
      mkdirSync(candidate.path, { recursive: true });
      registerWorkspace(candidate.path);
      return candidate;
    } catch (error) {
      console.warn(
        `[workspace] default workspace unavailable at ${candidate.path}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  throw new Error('cannot create default workspace');
}

/** 工作区显示名（TitleBar 下拉用）。 */
export function workspaceLabel(path: string): string {
  return basename(path) || path;
}

/** 删除工作区的 UI 现场文件（工作区本身不删；预留）。 */
export function removeWorkspaceState(wsId: string): void {
  try {
    rmSync(join(getWorkspaceBase(wsId), 'ui-state.json'), { force: true });
  } catch {
    /* ignore */
  }
}
