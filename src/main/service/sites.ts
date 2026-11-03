/**
 * 站点业务：白名单 / 站点快照 / 采集。路径绑定在 routes.ts。
 */

import type { BrowserSnapshot } from '../harness/browser-contract';
import type { Ura } from '../ura/facade';
import { SiteSnapshots } from './sites/snapshots';
import { PreferencesRepo } from '../repo/preferences';
import { SitesRepo, type SiteEntryView } from '../repo/sites';

export type { SiteEntryView };

export interface SitesDeps {
  ura: Ura;
  workspace: () => string;
}

export class SitesService {
  private readonly changeListeners = new Set<(wsId: string) => void>();
  private readonly preferences = new PreferencesRepo();
  private readonly sitesRepo = new SitesRepo();

  constructor(private readonly deps: SitesDeps) {}

  onChange(listener: (wsId: string) => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  sites(_wsId: string): SiteEntryView[] {
    return this.sitesRepo.list(this.deps.workspace());
  }

  allowlist(wsId: string): string[] {
    return this.preferences.readAllowlist(wsId);
  }

  setAllowlist(wsId: string, list: string[]): string[] {
    const next = this.preferences.writeAllowlist(wsId, list);
    for (const listener of this.changeListeners) listener(wsId);
    return next;
  }

  capture(page: BrowserSnapshot): Promise<{ ref: string } | null> {
    return new SiteSnapshots(this.deps.ura, this.deps.workspace).capture(page);
  }
}
