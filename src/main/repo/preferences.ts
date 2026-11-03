/** 偏好与工作区策略（目前只有浏览器白名单）。 */

import { readBrowserAllowlist, writeBrowserAllowlist } from '../preferences';

export class PreferencesRepo {
  readAllowlist(wsId: string): string[] {
    return readBrowserAllowlist(wsId);
  }

  writeAllowlist(wsId: string, list: string[]): string[] {
    return writeBrowserAllowlist(wsId, list);
  }
}
