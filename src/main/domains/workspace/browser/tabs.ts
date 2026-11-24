/**
 * 浏览器模块对视图宿主的依赖面（端口）。
 *
 * 实现由组合根用 Views / Tabs 装配；浏览器模块不直接依赖 runtime，
 * 也不持有 WebContentsView —— 只按 view id 取 web tab 的原生句柄。
 */
import type { WebContents } from 'electron';

export interface BrowserTabs {
  /** 打开或复用 web tab 并激活，返回 raw view id。 */
  openWeb(url: string): Promise<{ id: string }>;
  /** tab 的原生 webContents；视图不存在或已销毁时返回 null。 */
  webContents(viewId: string): WebContents | null;
  /** 当前激活的 web tab id（无则 null）。 */
  activeViewId(): string | null;
}
