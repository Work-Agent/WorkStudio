/** 原生动作：直接调用 native domain，不再经路径翻译层。 */
import { command } from './bridge.ts';

type PopupItem = { id: string; label: string; disabled?: boolean };
type PopupListener = (event: { source: string; actionId: string }) => void;

const listeners = new Set<PopupListener>();

export const popupMenu = {
  async show(input: { source: string; items: PopupItem[] }): Promise<boolean> {
    try {
      const selected = await command<string | null>(
        'shell',
        'native',
        'popupMenu',
        { items: input.items },
      );
      if (!selected) return false;
      for (const listener of listeners) {
        listener({ source: input.source, actionId: selected });
      }
      return true;
    } catch {
      return false;
    }
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
    try {
      await command('shell', 'native', 'openPath', { path });
      return '';
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  },
};
