/**
 * Electron 内容策略：所有窗口 / 视图共用的导航与权限基线。
 *
 * 与 main 的 `ElectronCapability.attach` 一致：页面不得自行导航、不得开新窗，
 * 新窗需求一律交给系统浏览器；权限请求默认拒绝。
 */

import { shell } from 'electron';
import type { WebContents } from 'electron';

export function hardenWebContents(
  wc: WebContents,
  options: { allowHttp?: boolean; allowApp?: boolean } = {},
): void {
  wc.on('will-navigate', (event, url) => {
    const allowed =
      (options.allowHttp === true && /^https?:/i.test(url)) ||
      (options.allowApp === true && /^app:/i.test(url));
    if (!allowed) event.preventDefault();
  });
  wc.on('will-attach-webview', (event) => event.preventDefault());
  wc.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.session.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );
}
