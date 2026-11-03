/**
 * HarnessExtension —— 业务能力的 pi 扩展形态（InlineExtension）。
 *
 * 工具经 pi.registerTool 官方语义注册；资源管理型工具是 URA 门面的薄封装，
 * 操作型工具（浏览器族）走各自契约。插件不注册工具。
 */
import { createHash } from 'node:crypto';
import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { fileRef } from '../../shared/ura';
import type { Ura } from '../ura/facade';
import type { PluginHost } from '../plugins/host';
import type { BrowserAutomationContract } from './browser-contract';
import { SiteSnapshots } from '../service/sites/snapshots';
import { createBrowserTools } from './browser-tools';
import { createUraTools } from './ura-tools';

export interface HarnessBusinessDeps {
  ura: Ura;
  plugins: PluginHost;
  workspace: () => string;
  /** 浏览器自动化（懒取：raw 视图在 ViewHost 就绪后才可用）。 */
  getBrowserAutomation(): BrowserAutomationContract | null;
}

export function createHarnessExtension(
  deps: HarnessBusinessDeps,
): InlineExtension {
  return (pi) => {
    const snapshots = new SiteSnapshots(deps.ura, deps.workspace);
    const browser = (): BrowserAutomationContract => {
      const automation = deps.getBrowserAutomation();
      if (!automation) throw new Error('browser automation is not ready');
      return automation;
    };
    const automation: BrowserAutomationContract = {
      open: (...args) => browser().open(...args),
      read: (...args) => browser().read(...args),
      click: (...args) => browser().click(...args),
      type: (...args) => browser().type(...args),
      back: (...args) => browser().back(...args),
      screenshot: (...args) => browser().screenshot(...args),
      snapshot: (...args) => browser().snapshot(...args),
      activeViewId: () => browser().activeViewId(),
    };
    const tools = [
      ...createUraTools(deps.ura),
      ...createBrowserTools(automation, {
        capture: (page) => snapshots.capture(page),
      }),
    ];
    for (const tool of tools) {
      pi.registerTool(tool as never);
    }

    // AGENTS.md（URA 托管地图）：首轮注入；版本变化时以命名 section 替换。
    const mapRef = (): string => `${fileRef(deps.workspace())}/AGENTS.md`;
    const readMap = async (): Promise<string | null> => {
      const opened = await deps.ura
        .read(mapRef(), { as: 'agent' })
        .catch(() => null);
      return opened && opened.presentation.type === 'text'
        ? opened.presentation.content
        : null;
    };
    let lastMapVersion = '';
    pi.on('context', async (event) => {
      const text = await readMap();
      if (!text) return;
      const version = digest(text);
      if (version === lastMapVersion) return;
      lastMapVersion = version;
      return {
        messages: [
          ...event.messages,
          {
            role: 'system',
            content: '',
            sections: { 'workstudio-resource-map': text },
            timestamp: Date.now(),
          } as never,
        ],
      };
    });
  };
}

function digest(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 16);
}
