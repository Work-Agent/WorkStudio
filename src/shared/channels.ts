/** preload / 主进程之间的 bridge 通道单一事实源。 */
export const BRIDGE_CHANNELS = {
  subscribe: 'workstudio:subscribe',
  unsubscribe: 'workstudio:unsubscribe',
  command: 'workstudio:command',
  notify: 'workstudio:notify',
  update: 'workstudio:update',
} as const;

/** preload 启动首帧同步读取当前外观，避免白屏闪一下。 */
export const INITIAL_THEME_CHANNEL = 'workstudio:initial-theme';
