/**
 * 渲染层运行时桥（无 mock 回退）。
 *
 * 工作台与助手各自有 preload 桥；共享组件按可用桥调用。
 */

import type { CommandResponse, PopupMenuItem } from '../../shared/types';

function bridge() {
  return window.workbench ?? window.assistant;
}

export function runtimeCmd<T = unknown>(
  command: string,
  params?: unknown,
): Promise<CommandResponse<T>> {
  const target = bridge();
  if (!target) {
    return Promise.resolve({
      ok: false,
      error: { code: 'no_bridge', message: 'preload bridge is unavailable' },
    });
  }
  return target.cmd<T>(command, params);
}

export const popupMenu = {
  show: (input: {
    source: string;
    items: Array<{ id: string; label: string; disabled?: boolean }>;
  }): Promise<boolean> =>
    bridge()?.shell.showPopup(input) ?? Promise.resolve(false),
  onSelect: (
    cb: (event: { source: string; actionId: string }) => void,
  ): (() => void) => bridge()?.onPopupSelect(cb) ?? (() => undefined),
};

export const electronAPI = {
  platform: bridge()?.platform ?? 'linux',
  openPath: (path: string): Promise<string> =>
    window.workbench?.openPath(path) ?? Promise.resolve(path),
};

export type { PopupMenuItem };
