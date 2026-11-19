/** 展示路径：相对 dataRoot / 当前工作区；不暴露本机绝对路径。 */
let dataRoot = '';
let workspacePath = '';
let workspaceId = '';
let appPath = '';

interface StorageRoots {
  dataRoot?: string;
  appPath?: string;
  workspacePath?: string;
  workspaceId?: string;
}

function applyRoots(value: StorageRoots | null | undefined): void {
  if (!value) return;
  dataRoot = value.dataRoot ?? dataRoot;
  appPath = value.appPath ?? appPath;
  if (value.workspacePath !== undefined)
    workspacePath = value.workspacePath ?? '';
  if (value.workspaceId !== undefined) workspaceId = value.workspaceId ?? '';
}

export async function initPathDisplay(): Promise<void> {
  const bridge = typeof window !== 'undefined' ? window.workStudio : undefined;
  if (!bridge) return;
  bridge.onUpdate((update) => {
    if (update.domain !== 'settings' || update.resource !== 'storage') return;
    if (update.type === 'snapshot') applyRoots(update.data as StorageRoots);
  });
  applyRoots((await bridge.subscribe('settings', 'storage')) as StorageRoots);
}

function normalize(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '');
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
