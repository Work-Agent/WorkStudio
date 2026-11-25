/** Electron 内容策略：所有窗口 / 视图共用的导航与权限基线。 */
import { shell } from 'electron';
import type { WebContents } from 'electron';

export interface HardenOptions {
  /** 允许的页面内导航；缺省放行 http(s) / work / plugin。 */
  allowNavigation?: (url: string) => boolean;
  /** 拦截 window.open / target=_blank；返回 true 表示宿主已处理。 */
  onWindowOpen?: (url: string) => boolean;
}

function defaultNavigation(url: string): boolean {
  return /^https?:/i.test(url) || /^work:/i.test(url) || /^plugin:/i.test(url);
}

export function hardenWebContents(
  wc: WebContents,
  options: HardenOptions = {},
): void {
  const allow = options.allowNavigation ?? defaultNavigation;
  const guard = (event: { preventDefault(): void }, url: string): void => {
    if (!allow(url)) event.preventDefault();
  };
  wc.on('will-navigate', guard);
  wc.on('will-redirect', guard);
  wc.on('will-attach-webview', (event) => event.preventDefault());
  wc.setWindowOpenHandler(({ url }) => {
    if (options.onWindowOpen?.(url)) return { action: 'deny' };
    // 只把真正的网页交给系统浏览器；file/work/plugin 等协议一律拒绝。
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.session.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );
}
