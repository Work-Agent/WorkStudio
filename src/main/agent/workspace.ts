/**
 * 工作区注册表（architecture.md §5.3）—— 目录自描述，无独立「当前选中」文件。
 *
 * <userData>/agent/                     ← agentDir（应用自持，与用户全局 pi 隔离）
 *   models.json / auth.json / settings.json
 *   ws/<wsId>/workspace.json            ← { path, createdAt, lastOpenedAt }（唯一事实源）
 *     settings.json / sessions/ / ui-state.json / resources/
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

let agentRoot: string | null = null;

/** agentDir 解析（L3 装配期注入一次；harness 不触 electron——依赖倒置）。 */
export function initAgentDir(dir: string): void {
  agentRoot = dir;
  mkdirSync(dir, { recursive: true });
}

export function getAgentDir(): string {
  if (!agentRoot)
    throw new Error(
      'agentDir not initialized — call initAgentDir() at bootstrap',
    );
  return agentRoot;
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
  return join(getAgentDir(), 'ws', wsId);
}

export function getSessionsDir(wsId: string): string {
  return join(getWorkspaceBase(wsId), 'sessions');
}

export function getWorkspaceResourcesDir(wsId: string): string {
  return join(getWorkspaceBase(wsId), 'resources');
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
  const root = join(getAgentDir(), 'ws');
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

/** 首装引导：在 Documents 下创建默认工作区并注册。 */
export function ensureDefaultWorkspace(documentsDir: string): string {
  const fallback = join(documentsDir, 'WorkStudio');
  mkdirSync(fallback, { recursive: true });
  registerWorkspace(fallback);
  return fallback;
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
