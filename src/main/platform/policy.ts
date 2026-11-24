/** Electron 内容策略：所有窗口 / 视图共用的导航与权限基线。 */
import { shell } from 'electron';
import type { WebContents } from 'electron';

export function hardenWebContents(wc: WebContents): void {
  wc.on('will-navigate', (event, url) => {
    if (/^https?:/i.test(url) || /^work:/i.test(url) || /^plugin:/i.test(url)) {
      return;
    }
    event.preventDefault();
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
