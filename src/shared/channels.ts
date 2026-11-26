/** preload / 主进程之间的 bridge 通道单一事实源。 */
export const BRIDGE_CHANNELS = {
  subscribe: 'workstudio:subscribe',
  unsubscribe: 'workstudio:unsubscribe',
  command: 'workstudio:command',
  notify: 'workstudio:notify',
  update: 'workstudio:update',
  fileToken: 'workstudio:file-token',
} as const;

/** 网页标签回传授权凭证的专用通道（只写不读）。 */
export const OAUTH_CREDENTIAL_CHANNEL = 'workstudio:oauth-credential';

/** 窗口 → 渲染层的工作区绑定；窗口与工作区 1:1，值即该窗口的 wsId。 */
export const WORKSPACE_ARG = '--work-studio-workspace=';

export function workspaceIdOfArgv(
  argv: readonly string[] | null | undefined,
): string | null {
  if (!Array.isArray(argv)) return null;
  const arg = argv.find((item) => item.startsWith(WORKSPACE_ARG));
  return arg ? arg.slice(WORKSPACE_ARG.length) : null;
}
