/** 展示路径：相对 dataRoot / 当前工作区；不暴露本机绝对路径。 */
let dataRoot = '';
let workspacePath = '';
let workspaceId = '';
let appPath = '';

export async function initPathDisplay(): Promise<void> {
  const bridge = typeof window !== 'undefined' ? window.appBridge : undefined;
  if (!bridge) return;
  const [storage, workspace] = await Promise.all([
    bridge.peek<{ dataRoot?: string; appPath?: string }>('/settings/storage'),
    bridge.peek<{ id?: string; path?: string }>('/workspaces/current'),
  ]);
  dataRoot = storage?.dataRoot ?? '';
  workspacePath = workspace?.path ?? '';
}

function normalize(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '');
}

export function setDisplayWorkspace(
  id: string | null,
  path: string | null,
): void {
  workspaceId = id ?? '';
  workspacePath = path ?? '';
}

export function displayPath(value: unknown): string {
  const raw = String(value ?? '');
  if (!raw) return '';
  let path = raw;
  if (path.startsWith('file://')) {
    try {
      path = decodeURIComponent(path.slice('file://'.length));
    } catch {
      /* keep */
    }
  }
  path = normalize(path);
  const root = normalize(dataRoot);
  const workspaceData =
    root && workspaceId ? `${root}/workspaces/${workspaceId}` : '';
  for (const [label, current] of [
    ['workspace', normalize(workspacePath)],
    ['app/workspace', workspaceData],
    ['app', root],
    ['app', normalize(appPath)],
  ] as const) {
    if (!current) continue;
    if (path === current) return label;
    if (path.startsWith(`${current}/`))
      return `${label}/${path.slice(current.length + 1)}`;
  }
  return path;
}
