/**
 * 页面打开契约：业务 domain 声明 open target，provider 解析成 ViewSpec。
 *
 * Views 只消费解析结果；provider 不碰 tab 状态和原生视图。
 */

import type { ViewRecord } from './views.ts';

/** 打开一页的意图；provider 按 type 认领。 */
export type OpenTarget =
  | { type: 'settings'; pageId: string }
  | { type: 'plugin'; pluginId: string; surface?: 'page' | 'settings' }
  | { type: 'resource'; ref: string }
  | { type: 'web'; url: string; title?: string }
  | { type: 'welcome' }
  | {
      type: 'page';
      url: string;
      title?: string;
      contentPath?: string;
      preload?: string;
      sessionId?: string;
    };

/** provider 解析后交给 tabs 的视图规格。 */
export interface ViewSpec {
  type: 'page' | 'web';
  url: string;
  title: string;
  /** 逻辑地址：tabKey 与复用依据；缺省用 `${type}:${url}`。 */
  contentPath?: string | null;
  sessionId?: string | null;
  preload?: string;
  partition?: string;
  reuseKey?: string | null;
}

export interface ViewProvider {
  /** 认领的 target 判别值。 */
  type: OpenTarget['type'];
  /** 归属 service；只有该 service 能打开。 */
  owner?: string;
  resolve(target: OpenTarget): ViewSpec | Promise<ViewSpec>;
  release?(contentPath: string): void;
  refresh?(contentPath: string): void | Promise<void>;
}

/** provider 注册表；只负责按 type 找到归属。 */
export class ViewProviders {
  private readonly byType = new Map<string, ViewProvider>();

  register(provider: ViewProvider): void {
    if (this.byType.has(provider.type)) {
      throw new Error(`duplicate view provider "${provider.type}"`);
    }
    this.byType.set(provider.type, provider);
  }

  get(type: string): ViewProvider | null {
    return this.byType.get(type) ?? null;
  }

  release(record: ViewRecord): void {
    if (!record.providerType || !record.contentPath) return;
    this.byType.get(record.providerType)?.release?.(record.contentPath);
  }

  async refresh(record: ViewRecord): Promise<void> {
    if (!record.providerType || !record.contentPath) return;
    await this.byType.get(record.providerType)?.refresh?.(record.contentPath);
  }
}
