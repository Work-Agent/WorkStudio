/**
 * 渲染层运行时桥（无 mock 回退）。
 *
 * 工作台与助手各自有 preload 桥；共享组件按可用桥调用。
 */

function bridge() {
  return window.workbench ?? window.assistant;
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
