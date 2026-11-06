/** 设置面读模型：内置页面清单 / 存储信息 / 数据根切换。 */

import { readFileSync } from 'node:fs';
import type { AgentHost } from '../agent/agent-host';
import { getWorkspaceBase, getWorkspaceId } from '../agent/workspace';
import { getDataRootSource, setDataRoot } from '../data-root';
import { pluginsRoot } from '../paths';
import type { StorageView } from '../../shared/types';
import { join } from 'node:path';

export class SettingsRepo {
  constructor(
    private readonly dataRoot: string,
    private readonly appPath: string,
  ) {}

  storage(workspacePath: string, agent: AgentHost): StorageView {
    const wsId = getWorkspaceId(workspacePath);
    return {
      dataRoot: this.dataRoot,
      dataRootSource: getDataRootSource(),
      workspacePath,
      workspaceId: wsId,
      agentDir: this.dataRoot,
      modelsJson: join(this.dataRoot, 'models.json'),
      authJson: join(this.dataRoot, 'auth.json'),
      globalSettings: join(this.dataRoot, 'settings.json'),
      workspaceSettings: join(getWorkspaceBase(wsId), 'settings.json'),
      sessionsDir: agent.resolveSessionsDir(),
      defaultSessionsDir: join(getWorkspaceBase(wsId), 'sessions'),
      sessionsDirConfigured: this.sessionsDirConfigured(),
      sceneFile: join(getWorkspaceBase(wsId), 'scene.json'),
      appPath: this.appPath,
      sitesDir: join(workspacePath, 'sites'),
      pluginsDirs: [
        join(this.appPath, 'src', 'plugins'),
        join(this.appPath, 'out', 'plugins'),
        pluginsRoot(),
      ],
      bootLog: join(this.dataRoot, 'logs', 'boot.log'),
      versions: {
        app: '',
        electron: process.versions['electron'] ?? '',
        chrome: process.versions['chrome'] ?? '',
        node: process.versions['node'] ?? '',
      },
    };
  }

  setDataRoot(path: string): void {
    setDataRoot(path);
  }

  private sessionsDirConfigured(): string | null {
    try {
      const raw = JSON.parse(
        readFileSync(join(this.dataRoot, 'settings.json'), 'utf-8'),
      ) as { sessionDir?: unknown };
      return typeof raw.sessionDir === 'string' && raw.sessionDir
        ? raw.sessionDir
        : null;
    } catch {
      return null;
    }
  }
}
