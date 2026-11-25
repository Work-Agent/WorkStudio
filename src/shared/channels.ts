/** preload / 主进程之间的 bridge 通道单一事实源。 */
export const BRIDGE_CHANNELS = {
  subscribe: 'workstudio:subscribe',
  unsubscribe: 'workstudio:unsubscribe',
  command: 'workstudio:command',
  notify: 'workstudio:notify',
  update: 'workstudio:update',
} as const;
