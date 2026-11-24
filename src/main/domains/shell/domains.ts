/**
 * shell 服务的 resources：
 * windows · views · view/<id> · layout · pages · appearance · interaction ·
 * menu · dialogs · notices。
 *
 * Domain 是服务边界；每个 resource 对应窗口、视图、布局、对话框等聚合/读模型。
 * 这里不出现 Electron 对象，也不依赖 App。
 */

import type { AppearanceSettings } from '../../../shared/appearance.ts';
import type { ViewType } from '../../contract.ts';
import { CallFailure } from '../../contract.ts';
import type { Protocols } from '../../protocols.ts';
import type { ShellHost, ViewOpenInput } from './native.ts';
import type {
  InteractionPreview,
  LayoutSnapshot,
  UiState,
} from '../../../shared/types.ts';
import {
  beginInteraction,
  commitInteraction,
  computeLayout,
  previewInteraction,
  type InteractionInput,
  type InteractionSession,
  type NativeScene,
} from './interaction.ts';
import { DEFAULT_UI } from './layout.ts';
import { pending } from '../../registry/command.ts';
import type { DomainRegistry } from '../../registry/registry.ts';

// ─── window ──────────────────────────────────────────────────

export interface WindowRecord {
  id: string;
  workspaceId: string;
  active: boolean;
}

export interface WindowState {
  readonly records: Map<string, WindowRecord>;
}

export function createWindowState(): WindowState {
  return { records: new Map() };
}

export function defineWindowsResource(
  registry: DomainRegistry,
  state: WindowState,
  host?: ShellHost,
  onOpened?: (windowId: string) => void,
): void {
  const resource = registry.define('shell').resource('windows');
  resource.snapshot(() => {
    const windows = [...state.records.values()];
    return {
      active: windows.find((item) => item.active)?.id ?? null,
      windows,
    };
  });
  resource.command('open', {
    summary: '打开工作区窗口',
    args: { workspaceId: { type: 'string', required: true } },
    run: (input) => {
      const workspaceId = String(input.workspaceId);
      const existing = [...state.records.values()].find(
        (item) => item.workspaceId === workspaceId,
      );
      const record =
        existing ??
        (host
          ? host.openWindow(workspaceId)
          : { id: workspaceId, workspaceId, active: true });
      for (const [id, item] of state.records) {
        state.records.set(id, { ...item, active: id === record.id });
      }
      state.records.set(record.id, record);
      onOpened?.(record.id);
      resource.publish();
      return state.records.get(record.id) ?? record;
    },
  });
  resource.command('focus', {
    summary: '聚焦窗口',
    args: { id: { type: 'string', required: true } },
    run: (input) => {
      const id = String(input.id);
      host?.focusWindow(id);
      for (const [key, item] of state.records) {
        state.records.set(key, { ...item, active: key === id });
      }
      resource.publish();
      return state.records.get(id) ?? null;
    },
  });
  resource.command('close', {
    summary: '关闭窗口',
    args: { id: { type: 'string', required: true } },
    run: (input) => {
      const id = String(input.id);
      host?.closeWindow(id);
      state.records.delete(id);
      resource.publish();
      return null;
    },
  });
}

// ─── view ────────────────────────────────────────────────────

export interface ViewRecord {
  id: string;
  type: ViewType;
  title: string;
  url?: string;
  active: boolean;
  dirty: boolean;
  pinned: boolean;
}

export interface ViewState {
  readonly records: Map<string, ViewRecord>;
}

function viewResourceName(viewId: string): string {
  return `view/${viewId}`;
}

export function createViewState(): ViewState {
  return { records: new Map() };
}

export function defineViewsResource(
  registry: DomainRegistry,
  state: ViewState,
  host?: ShellHost,
): void {
  const ensureResource = (viewId: string): void => {
    if (registry.define('shell').resourceOf(viewResourceName(viewId))) return;

    const resource = registry
      .define('shell')
      .resource(viewResourceName(viewId));
    resource.snapshot(() => state.records.get(viewId) ?? null);
    resource.command('loaded', {
      summary: '页面加载完成',
      args: {},
      run: () => state.records.get(viewId) ?? null,
    });
    resource.command('dirty', {
      summary: '上报脏态',
      args: { dirty: { type: 'boolean', required: true } },
      run: (input) => {
        const record = state.records.get(viewId);
        if (!record) {
          throw new CallFailure('not_found', `视图不存在：${viewId}`);
        }
        const dirty = input.dirty === true;
        host?.setViewDirty(viewId, dirty);
        const next = { ...record, dirty };
        state.records.set(viewId, next);
        resource.patch({ dirty: next.dirty });
        return next;
      },
    });
    resource.command('navigate', {
      summary: '页面请求导航',
      args: { url: { type: 'string', required: true } },
      run: (input) => {
        const record = state.records.get(viewId);
        if (!record) {
          throw new CallFailure('not_found', `视图不存在：${viewId}`);
        }
        const url = String(input.url);
        host?.navigateView(viewId, url);
        const next = { ...record, url };
        state.records.set(viewId, next);
        resource.patch({ url: next.url });
        return next;
      },
    });
    resource.command('reload', {
      summary: '重新加载页面',
      args: {},
      run: () => {
        if (!host) throw new CallFailure('failed', '视图宿主未接入');
        host.reloadView(viewId);
        return null;
      },
    });
  };

  const list = registry.define('shell').resource('views');
  list.snapshot(() => [...state.records.values()]);

  const ensureWelcome = (): void => {
    if (state.records.size > 0 || !host) return;
    const record = host.openWelcome();
    if (!record) return;
    state.records.set(record.id, record);
    ensureResource(record.id);
    registry.define('shell').resource(viewResourceName(record.id)).publish();
  };

  list.command('open', {
    summary: '打开内容视图',
    args: {
      id: { type: 'string', required: true },
      type: { type: 'string', required: true },
      title: { type: 'string' },
      url: { type: 'string' },
    },
    run: (input) => {
      const id = String(input.id);
      const existing = state.records.get(id);
      if (existing) {
        host?.activateView(id);
        for (const [otherId, other] of state.records) {
          state.records.set(otherId, {
            ...other,
            active: otherId === id,
          });
        }
        list.publish();
        return state.records.get(id) ?? existing;
      }
      const openInput: ViewOpenInput = {
        id,
        type: input.type as ViewType,
        title: typeof input.title === 'string' ? input.title : id,
        ...(typeof input.url === 'string' ? { url: input.url } : {}),
      };
      const record: ViewRecord = host
        ? host.openView(openInput)
        : {
            id,
            type: openInput.type,
            title: openInput.title,
            ...(openInput.url ? { url: openInput.url } : {}),
            active: true,
            dirty: false,
            pinned: false,
          };
      for (const [otherId, other] of state.records) {
        state.records.set(otherId, { ...other, active: otherId === record.id });
      }
      state.records.set(record.id, record);
      ensureResource(record.id);
      registry.define('shell').resource(viewResourceName(record.id)).publish();
      list.publish();
      return record;
    },
  });
  list.command('activate', {
    summary: '切换当前视图',
    args: { id: { type: 'string', required: true } },
    run: (input) => {
      const target = String(input.id);
      if (!state.records.has(target)) {
        throw new CallFailure('not_found', `视图不存在：${target}`);
      }
      host?.activateView(target);
      for (const [id, record] of state.records) {
        const next = { ...record, active: id === target };
        state.records.set(id, next);
        registry.define('shell').resource(viewResourceName(id)).publish();
      }
      list.publish();
      return [...state.records.values()];
    },
  });
  list.command('close', {
    summary: '关闭视图',
    args: { id: { type: 'string', required: true } },
    run: (input) => {
      const id = String(input.id);
      const closed = state.records.get(id);
      host?.closeView(id);
      state.records.delete(id);
      registry.define('shell').remove(viewResourceName(id));
      if (closed?.active) {
        const next = [...state.records.values()][0];
        if (next) {
          state.records.set(next.id, { ...next, active: true });
          host?.activateView(next.id);
          registry
            .define('shell')
            .resource(viewResourceName(next.id))
            .publish();
        }
      }
      ensureWelcome();
      list.publish();
      return null;
    },
  });
  list.command('pin', {
    summary: '固定 / 取消固定视图',
    args: { id: { type: 'string', required: true } },
    run: (input) => {
      const id = String(input.id);
      const record = state.records.get(id);
      if (!record) {
        throw new CallFailure('not_found', `视图不存在：${id}`);
      }
      const next = { ...record, pinned: !record.pinned };
      state.records.set(id, next);
      registry.define('shell').resource(viewResourceName(id)).publish();
      list.publish();
      return next;
    },
  });
  list.command('closeOthers', {
    summary: '关闭其他视图',
    args: { id: { type: 'string', required: true } },
    run: (input) => {
      const keep = String(input.id);
      if (!state.records.has(keep)) return [...state.records.values()];
      for (const id of state.records.keys()) {
        if (id === keep) continue;
        host?.closeView(id);
        state.records.delete(id);
        registry.define('shell').remove(viewResourceName(id));
      }
      for (const [id, record] of state.records) {
        const next = { ...record, active: id === keep };
        state.records.set(id, next);
        registry.define('shell').resource(viewResourceName(id)).publish();
      }
      host?.activateView(keep);
      list.publish();
      return [...state.records.values()];
    },
  });
  list.command('closeLeft', {
    summary: '关闭左侧视图',
    args: { id: { type: 'string', required: true } },
    run: (input) => closeSide(String(input.id), 'left'),
  });
  list.command('closeRight', {
    summary: '关闭右侧视图',
    args: { id: { type: 'string', required: true } },
    run: (input) => closeSide(String(input.id), 'right'),
  });
  list.command('closeAll', {
    summary: '关闭全部视图',
    args: {},
    run: () => {
      for (const id of state.records.keys()) {
        host?.closeView(id);
        state.records.delete(id);
        registry.define('shell').remove(viewResourceName(id));
      }
      ensureWelcome();
      list.publish();
      return [...state.records.values()];
    },
  });
  list.command('move', {
    summary: '移动视图顺序',
    args: {
      fromId: { type: 'string', required: true },
      toId: { type: 'string', required: true },
    },
    run: (input) => {
      const fromId = String(input.fromId);
      const toId = String(input.toId);
      const entries = [...state.records.entries()];
      const fromIndex = entries.findIndex(([id]) => id === fromId);
      const toIndex = entries.findIndex(([id]) => id === toId);
      if (fromIndex < 0 || toIndex < 0) return [...state.records.values()];
      const [entry] = entries.splice(fromIndex, 1);
      if (!entry) return [...state.records.values()];
      entries.splice(toIndex, 0, entry);
      state.records.clear();
      for (const [id, record] of entries) state.records.set(id, record);
      list.publish();
      return [...state.records.values()];
    },
  });
  list.command('goBack', {
    summary: '后退',
    args: { id: { type: 'string', required: true } },
    run: () => null,
  });
  list.command('goForward', {
    summary: '前进',
    args: { id: { type: 'string', required: true } },
    run: () => null,
  });
  list.command('runAction', {
    summary: '执行视图动作',
    args: { id: { type: 'string', required: true } },
    run: () => null,
  });

  function closeSide(id: string, side: 'left' | 'right'): ViewRecord[] {
    const ids = [...state.records.keys()];
    const index = ids.indexOf(id);
    if (index < 0) return [...state.records.values()];
    const remove = side === 'left' ? ids.slice(0, index) : ids.slice(index + 1);
    for (const viewId of remove) {
      host?.closeView(viewId);
      state.records.delete(viewId);
      registry.define('shell').remove(viewResourceName(viewId));
    }
    list.publish();
    return [...state.records.values()];
  }
}

// ─── layout ──────────────────────────────────────────────────

export interface SceneState {
  sidebarCollapsed?: boolean;
  aiOpen?: boolean;
  aiFloating?: boolean;
  paneWidths?: { left: number; right: number };
  floating?: LayoutSnapshot['assistantFloating'] | null;
}

export interface LayoutRecord {
  windowId: string;
  scene: SceneState;
  preview: InteractionPreview | null;
  input: InteractionInput | null;
  snapshot: LayoutSnapshot & { scene: SceneState };
}

export interface LayoutState {
  readonly records: Map<string, LayoutRecord>;
}

export function createLayoutState(): LayoutState {
  return { records: new Map() };
}

function defaultScene(): SceneState {
  return {
    sidebarCollapsed: DEFAULT_UI.sidebarCollapsed,
    aiOpen: DEFAULT_UI.aiOpen,
    aiFloating: DEFAULT_UI.aiFloating,
    paneWidths: { ...DEFAULT_UI.paneWidths },
    floating: null,
  };
}

function sceneOf(record: LayoutRecord): NativeScene {
  return sceneOfState(record.scene);
}

function sceneOfState(scene: SceneState): NativeScene {
  return {
    sidebarCollapsed: scene.sidebarCollapsed,
    aiOpen: scene.aiOpen,
    aiFloating: scene.aiFloating,
    paneWidths: scene.paneWidths,
    floating: scene.floating ?? null,
  };
}

function snapshotOf(
  windowId: string,
  scene: SceneState,
  preview: InteractionPreview | null,
  host?: ShellHost,
): LayoutRecord {
  const size = host?.windowSize(windowId) ?? { width: 1440, height: 900 };
  const layout = computeLayout(size, sceneOfState(scene), preview);
  return {
    windowId,
    scene,
    preview,
    input: null,
    snapshot: { ...layout, scene },
  };
}

export function defineLayoutResource(
  registry: DomainRegistry,
  state: LayoutState,
  host?: ShellHost,
  options: {
    sceneFor?: (windowId: string) => SceneState | undefined;
    persist?: (windowId: string, scene: SceneState) => void;
  } = {},
): void {
  const resource = registry.define('shell').resource('layout');

  const ensure = (windowId: string): LayoutRecord => {
    const existing = state.records.get(windowId);
    if (existing) return existing;
    const restored = options.sceneFor?.(windowId);
    const record = snapshotOf(
      windowId,
      { ...defaultScene(), ...restored },
      null,
      host,
    );
    state.records.set(windowId, record);
    return record;
  };

  const publish = (record: LayoutRecord): void => {
    state.records.set(record.windowId, record);
    host?.applyLayout(record.windowId, record.snapshot);
    options.persist?.(record.windowId, record.scene);
    resource.publish();
  };

  resource.snapshot(() => [...state.records.values()]);

  resource.command('ensure', {
    summary: '确保窗口存在布局快照',
    args: { windowId: { type: 'string', required: true } },
    run: (input) => {
      const record = ensure(String(input.windowId));
      publish(record);
      return record;
    },
  });

  resource.command('set', {
    summary: '提交窗口布局',
    args: { windowId: { type: 'string', required: true } },
    run: (input) => {
      const windowId = String(input.windowId);
      const current = ensure(windowId);
      const incoming = input.snapshot as
        | (Partial<LayoutSnapshot> & { scene?: SceneState })
        | null
        | undefined;
      if (incoming && typeof incoming === 'object') {
        const scene = incoming.scene
          ? { ...current.scene, ...incoming.scene }
          : current.scene;
        const record = snapshotOf(windowId, scene, null, host);
        publish(record);
        return record;
      }
      publish(current);
      return current;
    },
  });

  resource.command('scene', {
    summary: '更新窗口场景',
    args: {
      windowId: { type: 'string', required: true },
    },
    run: (input) => {
      const windowId = String(input.windowId);
      const current = ensure(windowId);
      const patch =
        typeof input.patch === 'object' && input.patch !== null
          ? (input.patch as SceneState)
          : {};
      const next: SceneState = {
        ...current.scene,
        ...(typeof patch.sidebarCollapsed === 'boolean'
          ? { sidebarCollapsed: patch.sidebarCollapsed }
          : {}),
        ...(typeof patch.aiOpen === 'boolean' ? { aiOpen: patch.aiOpen } : {}),
        ...(typeof patch.aiFloating === 'boolean'
          ? { aiFloating: patch.aiFloating }
          : {}),
        ...(isPaneWidths(patch.paneWidths)
          ? {
              paneWidths: {
                left: patch.paneWidths.left,
                right: patch.paneWidths.right,
              },
            }
          : {}),
        ...(patch.floating === null
          ? { floating: null }
          : isRect(patch.floating)
            ? { floating: patch.floating }
            : {}),
      };
      const record = snapshotOf(windowId, next, null, host);
      publish(record);
      return record;
    },
  });

  resource.command('begin', {
    summary: '开始拖拽 / 缩放交互',
    args: {
      windowId: { type: 'string', required: true },
    },
    run: (input) => {
      const windowId = String(input.windowId);
      const current = ensure(windowId);
      const interaction = input.input as InteractionInput;
      const cursor =
        interaction.type === 'pane-resize' &&
        interaction.side !== 'right' &&
        typeof interaction.pointerX === 'number' &&
        typeof interaction.pointerY === 'number'
          ? { x: interaction.pointerX, y: interaction.pointerY }
          : (host?.windowCursor(windowId) ?? { x: 0, y: 0 });
      const session = beginInteraction(sceneOf(current), interaction, cursor);
      const preview = previewInteraction(
        session,
        cursor,
        host?.windowSize(windowId) ?? { width: 1440, height: 900 },
      );
      const record: LayoutRecord = {
        ...snapshotOf(windowId, current.scene, preview, host),
        input: interaction,
      };
      publish(record);
      host?.showCapture(windowId, interactionCursor(interaction));
      return record;
    },
  });

  resource.command('move', {
    summary: '更新拖拽 / 缩放预览',
    args: {
      windowId: { type: 'string', required: true },
    },
    run: (input) => {
      const windowId = String(input.windowId);
      const current = ensure(windowId);
      if (!current.preview) return current;
      const pointer = input.input as
        | { pointerX?: number; pointerY?: number }
        | undefined;
      const source = current.input ?? { type: current.preview.type };
      const usePointer =
        source.type === 'pane-resize' && source.side !== 'right';
      const cursor =
        usePointer &&
        typeof pointer?.pointerX === 'number' &&
        typeof pointer?.pointerY === 'number'
          ? { x: pointer.pointerX, y: pointer.pointerY }
          : (host?.windowCursor(windowId) ?? { x: 0, y: 0 });
      const session: InteractionSession = {
        input: source,
        scene: sceneOf(current),
        cursor,
      };
      const preview = previewInteraction(
        session,
        cursor,
        host?.windowSize(windowId) ?? { width: 1440, height: 900 },
      );
      const record: LayoutRecord = {
        ...snapshotOf(windowId, current.scene, preview, host),
        input: current.input,
      };
      publish(record);
      return record;
    },
  });

  resource.command('end', {
    summary: '结束交互并提交场景',
    args: { windowId: { type: 'string', required: true } },
    run: (input) => {
      const windowId = String(input.windowId);
      const current = ensure(windowId);
      const size = host?.windowSize(windowId) ?? { width: 1440, height: 900 };
      const committed = (
        current.preview
          ? commitInteraction(current.preview, sceneOf(current), size.width)
          : {}
      ) as Partial<{
        sidebarCollapsed: boolean;
        paneWidths: { left: number; right: number };
        floating: LayoutSnapshot['assistantFloating'] | null;
      }>;
      const next: SceneState = {
        ...current.scene,
        ...(committed.sidebarCollapsed !== undefined
          ? { sidebarCollapsed: committed.sidebarCollapsed }
          : {}),
        ...(committed.paneWidths ? { paneWidths: committed.paneWidths } : {}),
        ...(committed.floating !== undefined
          ? { floating: committed.floating }
          : {}),
      };
      const record = snapshotOf(windowId, next, null, host);
      publish(record);
      host?.hideCapture(windowId);
      return record;
    },
  });

  resource.command('cancel', {
    summary: '取消交互',
    args: { windowId: { type: 'string', required: true } },
    run: (input) => {
      const windowId = String(input.windowId);
      const current = ensure(windowId);
      const record = snapshotOf(windowId, current.scene, null, host);
      publish(record);
      host?.hideCapture(windowId);
      return record;
    },
  });

  resource.command('resize', {
    summary: '窗口尺寸变化后重算',
    args: { windowId: { type: 'string', required: true } },
    run: (input) => {
      const windowId = String(input.windowId);
      const current = ensure(windowId);
      const record = snapshotOf(windowId, current.scene, current.preview, host);
      publish(record);
      return record;
    },
  });
}

function isPaneWidths(
  value: unknown,
): value is { left: number; right: number } {
  if (typeof value !== 'object' || value === null) return false;
  const widths = value as { left?: unknown; right?: unknown };
  return (
    typeof widths.left === 'number' &&
    Number.isFinite(widths.left) &&
    typeof widths.right === 'number' &&
    Number.isFinite(widths.right)
  );
}

function interactionCursor(input: InteractionInput): string {
  if (input.type === 'pane-resize') return 'col-resize';
  if (input.type === 'view-resize') {
    switch (input.direction ?? 'se') {
      case 'n':
      case 's':
        return 'ns-resize';
      case 'e':
      case 'w':
        return 'ew-resize';
      case 'ne':
      case 'sw':
        return 'nesw-resize';
      default:
        return 'nwse-resize';
    }
  }
  return 'move';
}

function isRect(value: unknown): value is NonNullable<SceneState['floating']> {
  if (typeof value !== 'object' || value === null) return false;
  const rect = value as Record<string, unknown>;
  return ['x', 'y', 'width', 'height'].every(
    (key) => typeof rect[key] === 'number' && Number.isFinite(rect[key]),
  );
}

// ─── native ──────────────────────────────────────────────────

export function defineNativeResource(
  registry: DomainRegistry,
  host?: ShellHost,
): void {
  const resource = registry.define('shell').resource('native');
  resource.snapshot(() => ({ available: Boolean(host) }));
  resource.command('pickDirectory', {
    summary: '选择目录',
    args: {},
    run: () => host?.pickDirectory() ?? null,
  });
  resource.command('openPath', {
    summary: '在系统文件管理器中打开路径',
    args: { path: { type: 'string', required: true } },
    run: async (input) => {
      await host?.openPath(String(input.path));
      return null;
    },
  });
  resource.command('popupMenu', {
    summary: '弹出原生菜单',
    args: {},
    run: (input) => {
      const items = Array.isArray(input.items)
        ? input.items.filter(
            (item): item is { id: string; label: string; disabled?: boolean } =>
              typeof item === 'object' &&
              item !== null &&
              typeof (item as { id?: unknown }).id === 'string' &&
              typeof (item as { label?: unknown }).label === 'string',
          )
        : [];
      return host?.popupMenu(items) ?? null;
    },
  });
}

// ─── page ────────────────────────────────────────────────────

export function definePagesResource(
  registry: DomainRegistry,
  protocols: Protocols,
  openPage?: (url: string) => Promise<unknown>,
): void {
  const resource = registry.define('shell').resource('pages');
  resource.snapshot(() => ({
    system: protocols.systemPages(),
    // 只投影身份与名称；页面文件路径不出主进程。
    plugins: protocols.list().map((page) => ({
      id: page.id,
      label: page.label,
    })),
  }));
  resource.command('open', {
    summary: '打开页面地址',
    args: { url: { type: 'string', required: true } },
    run: async (input) => {
      if (!openPage) throw new CallFailure('failed', '页面宿主未接入');
      return openPage(String(input.url));
    },
  });
}

// ─── appearance ──────────────────────────────────────────────

export type ThemeSource = 'light' | 'dark' | 'system';

export interface AppearanceState {
  theme: 'light' | 'dark';
  source: ThemeSource;
  zoom: number;
}

export function createAppearanceState(
  settings: AppearanceSettings = { theme: 'dark', zoom: 100 },
): AppearanceState {
  return {
    theme: settings.theme === 'light' ? 'light' : 'dark',
    source: settings.theme,
    zoom: settings.zoom / 100,
  };
}

export function defineAppearanceResource(
  registry: DomainRegistry,
  state: AppearanceState,
  persist?: (settings: AppearanceSettings) => void,
  host?: ShellHost,
): void {
  const resource = registry.define('shell').resource('appearance');
  resource.snapshot(() => ({
    theme: state.theme,
    source: state.source,
    zoom: state.zoom,
  }));
  resource.command('set', {
    summary: '更新主题与缩放',
    args: {
      theme: { enum: ['light', 'dark'] },
      source: { enum: ['light', 'dark', 'system'] },
      zoom: { type: 'number' },
    },
    run: (input) => {
      if (input.theme === 'light' || input.theme === 'dark') {
        state.theme = input.theme;
      }
      if (
        input.source === 'light' ||
        input.source === 'dark' ||
        input.source === 'system'
      ) {
        state.source = input.source;
      }
      if (typeof input.zoom === 'number') {
        state.zoom = Math.min(2, Math.max(0.5, input.zoom));
      }
      if (state.source !== 'system') state.theme = state.source;
      persist?.({ theme: state.source, zoom: state.zoom * 100 });
      host?.applyAppearance(state.theme, state.zoom, state.source);
      resource.patch({
        theme: state.theme,
        source: state.source,
        zoom: state.zoom,
      });
      return {
        theme: state.theme,
        source: state.source,
        zoom: state.zoom,
      };
    },
  });
}

// ─── interaction ─────────────────────────────────────────────

export interface InteractionRecord {
  type: string;
  target?: string;
}

export interface InteractionState {
  session: InteractionRecord | null;
}

export function createInteractionState(): InteractionState {
  return { session: null };
}

export function defineInteractionResource(
  registry: DomainRegistry,
  state: InteractionState,
): void {
  const resource = registry.define('shell').resource('interaction');
  resource.snapshot(() => ({ session: state.session }));
  resource.command('begin', {
    summary: '开始拖拽 / 缩放交互',
    args: {
      type: { type: 'string', required: true },
      target: { type: 'string' },
    },
    run: (input) => {
      state.session = {
        type: String(input.type),
        ...(input.target === undefined ? {} : { target: String(input.target) }),
      };
      resource.patch({ session: state.session });
      return { session: state.session };
    },
  });
  resource.command('update', {
    summary: '更新交互预览',
    args: {},
    run: () => ({ session: state.session }),
  });
  resource.command('end', {
    summary: '结束交互',
    args: {},
    run: () => {
      state.session = null;
      resource.patch({ session: null });
      return { session: null };
    },
  });
}

// ─── menu ────────────────────────────────────────────────────

export interface MenuItemRecord {
  id: string;
  label: string;
}

export interface MenuState {
  items: MenuItemRecord[];
}

export function createMenuState(): MenuState {
  return { items: [] };
}

export function defineMenuResource(
  registry: DomainRegistry,
  state: MenuState,
  host?: ShellHost,
): void {
  const resource = registry.define('shell').resource('menu');
  resource.snapshot(() => ({ items: state.items }));
  resource.command('set', {
    summary: '登记原生菜单项',
    args: {},
    run: (input) => {
      if (Array.isArray(input.items)) {
        state.items = input.items.filter(isMenuItem);
        resource.patch({ items: state.items });
      }
      return { items: state.items };
    },
  });
  resource.command('popup', {
    summary: '弹出原生菜单',
    args: {},
    run: () => host?.popupMenu(state.items) ?? null,
  });
}

function isMenuItem(value: unknown): value is MenuItemRecord {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as { id?: unknown; label?: unknown };
  return typeof item.id === 'string' && typeof item.label === 'string';
}

// ─── dialog ─────────────────────────────────────────────────

export interface DialogRequest {
  id: string;
  dialogType: 'select' | 'input' | 'editor' | 'confirm';
  title: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
  secret?: boolean;
}

export interface DialogView {
  id: string;
  request: DialogRequest;
  status: 'open' | 'resolved' | 'cancelled';
  response?: { value?: string | boolean; confirmed?: boolean };
}

export interface DialogState {
  seq: number;
  readonly records: Map<string, DialogView>;
}

export function createDialogState(): DialogState {
  return { seq: 0, records: new Map() };
}

export function defineDialogsResource(
  registry: DomainRegistry,
  state: DialogState,
  onVisibility?: (visible: boolean) => void,
): void {
  const resource = registry.define('shell').resource('dialogs');
  const publish = (): void => {
    resource.publish();
    onVisibility?.(
      [...state.records.values()].some((item) => item.status === 'open'),
    );
  };
  resource.snapshot(() => [...state.records.values()]);
  resource.command('open', {
    summary: '打开对话框',
    args: {
      id: { type: 'string' },
      dialogType: { enum: ['select', 'input', 'editor', 'confirm'] },
      title: { type: 'string', required: true },
      message: { type: 'string' },
      placeholder: { type: 'string' },
      prefill: { type: 'string' },
      secret: { type: 'boolean' },
    },
    run: (input) => {
      const id =
        typeof input.id === 'string' && input.id
          ? input.id
          : `dialog-${++state.seq}`;
      const dialogType = String(input.dialogType ?? 'confirm') as
        | 'select'
        | 'input'
        | 'editor'
        | 'confirm';
      const view: DialogView = {
        id,
        request: {
          id,
          dialogType,
          title: String(input.title),
          ...(typeof input.message === 'string'
            ? { message: input.message }
            : {}),
          ...(Array.isArray(input.options)
            ? {
                options: input.options.filter(
                  (value): value is string => typeof value === 'string',
                ),
              }
            : {}),
          ...(typeof input.placeholder === 'string'
            ? { placeholder: input.placeholder }
            : {}),
          ...(typeof input.prefill === 'string'
            ? { prefill: input.prefill }
            : {}),
          ...(input.secret === true ? { secret: true } : {}),
        },
        status: 'open',
      };
      state.records.set(id, view);
      publish();
      return view;
    },
  });
  resource.command('respond', {
    summary: '应答对话框',
    args: {
      id: { type: 'string', required: true },
      value: { type: 'string' },
      confirmed: { type: 'boolean' },
      cancelled: { type: 'boolean' },
    },
    run: (input) => {
      const id = String(input.id);
      const view = state.records.get(id);
      if (!view) throw new CallFailure('not_found', `对话框不存在：${id}`);
      if (view.status !== 'open') {
        throw new CallFailure('invalid', `对话框已结束：${id}`);
      }
      const cancelled = input.cancelled === true;
      const next: DialogView = {
        ...view,
        status: cancelled ? 'cancelled' : 'resolved',
        response: cancelled
          ? {}
          : {
              ...(typeof input.value === 'string'
                ? { value: input.value }
                : {}),
              ...(typeof input.confirmed === 'boolean'
                ? { confirmed: input.confirmed }
                : {}),
            },
      };
      state.records.set(id, next);
      publish();
      return next;
    },
  });
  resource.command('dismiss', {
    summary: '撤销对话框',
    args: { id: { type: 'string', required: true } },
    run: (input) => {
      const id = String(input.id);
      const view = state.records.get(id);
      if (!view) return null;
      state.records.set(id, { ...view, status: 'cancelled' });
      publish();
      return null;
    },
  });
}

// ─── notice ─────────────────────────────────────────────────

export interface NoticeRecord {
  id: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  source?: string;
}

export interface NoticeState {
  seq: number;
  notices: NoticeRecord[];
}

export function createNoticeState(): NoticeState {
  return { seq: 0, notices: [] };
}

export function defineNoticesResource(
  registry: DomainRegistry,
  state: NoticeState,
): void {
  const resource = registry.define('shell').resource('notices');
  resource.snapshot(() => state.notices);
  resource.command('notify', {
    summary: '推送通知',
    args: {
      level: { enum: ['info', 'warn', 'error'] },
      message: { type: 'string', required: true },
      source: { type: 'string' },
    },
    run: (input) => {
      const notice: NoticeRecord = {
        id: `notice-${++state.seq}`,
        level:
          input.level === 'warn' || input.level === 'error'
            ? input.level
            : 'info',
        message: String(input.message),
        ...(typeof input.source === 'string' ? { source: input.source } : {}),
      };
      state.notices = [...state.notices, notice];
      resource.publish();
      return notice;
    },
  });
  resource.command('dismiss', {
    summary: '关闭通知',
    args: { id: { type: 'string' } },
    run: (input) => {
      const id = typeof input.id === 'string' ? input.id : null;
      state.notices = id
        ? state.notices.filter((notice) => notice.id !== id)
        : [];
      resource.publish();
      return state.notices;
    },
  });
}
