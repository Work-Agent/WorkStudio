/**
 * 渲染层运行时桥：所有能力统一走 window.appBridge。
 *
 * 壳层、助手、浮层、插件页统一走 appBridge。
 */

type PopupItem = { id: string; label: string; disabled?: boolean };
type PopupListener = (event: { source: string; actionId: string }) => void;

const listeners = new Set<PopupListener>();

function appBridge(): NonNullable<Window['appBridge']> {
  if (!window.appBridge) throw new Error('app bridge unavailable');
  return window.appBridge;
}

export const popupMenu = {
  async show(input: { source: string; items: PopupItem[] }): Promise<boolean> {
    const result = await appBridge().call<string | null>('/native/popup-menu', {
      items: input.items,
    });
    if (!result.ok || !result.data) return false;
    for (const listener of listeners) {
      listener({ source: input.source, actionId: result.data });
    }
    return true;
  },
  onSelect(cb: PopupListener): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};

function platformName(): string {
  const raw =
    typeof navigator !== 'undefined' ? navigator.platform.toLowerCase() : '';
  if (raw.includes('mac')) return 'darwin';
  if (raw.includes('win')) return 'win32';
  return 'linux';
}

export const electronAPI = {
  platform: platformName(),
  async openPath(path: string): Promise<string> {
    const result = await appBridge().call('/native/open-path', { path });
    return result.ok ? '' : result.error.message;
  },
};
