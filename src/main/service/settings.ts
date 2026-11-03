/**
 * 设置业务：设置面（页面清单 / 存储信息 / 数据根）。
 * 路径绑定在 routes.ts。
 */

import type { StorageView } from '../../shared/types';
import type { AgentHost } from '../agent/agent-host';
import { SettingsRepo } from '../repo/settings';

export interface SettingsPageView {
  id: string;
  label: string;
  desc: string;
  icon: string;
  internal?: boolean;
}

export interface SettingsPageCatalog {
  pages(): SettingsPageView[];
  page(id: string): { id: string; label: string; page: string } | null;
}

export class SettingsService {
  private readonly repo: SettingsRepo;

  constructor(
    dataRoot: string,
    appPath: string,
    private readonly agent: () => AgentHost,
    private readonly workspacePath: () => string,
    private readonly catalog: SettingsPageCatalog,
  ) {
    this.repo = new SettingsRepo(dataRoot, appPath);
  }

  pages(): SettingsPageView[] {
    return this.catalog.pages();
  }

  page(id: string): { id: string; label: string; page: string } | null {
    return this.catalog.page(id);
  }

  storage(): StorageView {
    return this.repo.storage(this.workspacePath(), this.agent());
  }

  setDataRoot(path: string): void {
    this.repo.setDataRoot(path);
  }
}
