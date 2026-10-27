/**
 * UiStateService —— 用户操作状态的主进程真相源（README.md §三 / §6.1）。
 *
 * 存储：<agentDir>/ws/<wsId>/ui-state.json（按工作区隔离）。
 * 写策略：内存缓存 + 标脏 + 500ms 防抖 + 退出强制 flush；原子写（tmp → rename）。
 * 广播：AppSnapshot 中的 ui / layout 切片。
 * 主题：本服务是主题真相源，启动 / 切换 / 工作区挂载时收敛 nativeTheme + WCO 覆盖层。
 */
import { app, BrowserWindow, nativeTheme } from 'electron';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import type { UiState } from '../../shared/types';
import {
  TITLEBAR_HEIGHT,
  TITLEBAR_OVERLAY_COLORS,
} from '../../shared/titlebar';
import { getWorkspaceBase } from '../agent/workspace';

const SCHEMA_VERSION = 2;

const DEFAULTS: UiState = {
  __version__: SCHEMA_VERSION,
  theme: 'dark',
  aiOpen: true,
  aiFloating: false,
  sidebarView: 'main',
  sidebarDomain: null,
  sidebarCollapsed: false,
  panelCollapsed: false,
  inputExpanded: false,
  selectedSkills: [],
  paneWidths: { left: 240, right: 420 },
  activePath: null,
  openPaths: [],
  openTabs: { order: [], pinned: [], activeKey: null },
};

export type UiStatePatch = Partial<Omit<UiState, '__version__'>>;

const FLUSH_DEBOUNCE_MS = 500;

export class UiStateService {
  private state: UiState = { ...DEFAULTS };
  private file: string | null = null;
  private dirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private getWin: () => BrowserWindow | null = () => null;
  /** 变更订阅（布局重算 / 视图 bounds 应用的触发点）。 */
  private listeners = new Set<(state: UiState) => void>();

  /** 挂载到指定工作区（工作区切换时重新绑定文件）。 */
  attachWorkspace(wsId: string): void {
    this.flushNow();
    const base = getWorkspaceBase(wsId);
    mkdirSync(base, { recursive: true });
    this.file = join(base, 'ui-state.json');
    this.state = this.sanitize(this.load());
    this.applyNativeTheme();
    this.broadcast();
  }

  /** 恢复容错：已失效的会话标签直接丢弃；activePath 必须仍在打开集合内。 */
  private sanitize(state: UiState): UiState {
    const openPaths = state.openPaths.filter((p) => existsSync(p));
    const activePath =
      state.activePath && openPaths.includes(state.activePath)
        ? state.activePath
        : null;
    return { ...state, openPaths, activePath };
  }

  get(): UiState {
    return this.state;
  }

  set(patch: UiStatePatch): UiState {
    const themeChanged =
      patch.theme !== undefined && patch.theme !== this.state.theme;
    this.state = { ...this.state, ...patch };
    if (themeChanged) this.applyNativeTheme();
    this.markDirty();
    this.broadcast();
    for (const cb of this.listeners) cb(this.state);
    return this.state;
  }

  /** 变更订阅（LayoutEngine / ViewHost 消费；返回退订器）。 */
  onChanged(cb: (state: UiState) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  attachWindowSource(getWin: () => BrowserWindow | null): void {
    this.getWin = getWin;
  }

  /** 状态广播出口（L3 注入：窗口 + 系统视图；缺省仅窗口）。 */
  private stateBroadcaster: ((snapshot: unknown) => void) | null = null;
  attachStateBroadcaster(fn: (snapshot: unknown) => void): void {
    this.stateBroadcaster = fn;
  }

  /** 广播 Shell 快照（由装配层注入布局快照构建器，避免本服务依赖视图层）。 */
  private shellSnapshot: (() => unknown) | null = null;
  attachShellSnapshot(build: () => unknown): void {
    this.shellSnapshot = build;
  }

  private broadcast(): void {
    const snapshot = this.shellSnapshot
      ? this.shellSnapshot()
      : { ui: this.state };
    // 统一出口：L3 注入的广播器覆盖「窗口 + 系统视图」。
    this.stateBroadcaster?.(snapshot);
  }

  // ─── 主题收敛 ───────────────────────────────────────────

  /**
   * 应用主题 → 原生主题源 + WCO 覆盖层。
   * nativeTheme.themeSource 同时驱动：插件页 / 网页的 prefers-color-scheme、原生控件配色。
   */
  private applyNativeTheme(): void {
    nativeTheme.themeSource = this.state.theme === 'light' ? 'light' : 'dark';
    this.applyTitleBarOverlay();
  }

  private applyTitleBarOverlay(): void {
    if (process.platform === 'darwin') return;
    const win = this.getWin();
    if (!win || win.isDestroyed()) return;
    const colors =
      this.state.theme === 'light'
        ? TITLEBAR_OVERLAY_COLORS.light
        : TITLEBAR_OVERLAY_COLORS.dark;
    try {
      win.setTitleBarOverlay({ ...colors, height: TITLEBAR_HEIGHT });
    } catch (e) {
      console.warn(
        '[ui-state] setTitleBarOverlay 失败（平台不支持 WCO？）:',
        e,
      );
    }
  }

  // ─── 持久化 ─────────────────────────────────────────────

  private load(): UiState {
    if (!this.file || !existsSync(this.file)) return { ...DEFAULTS };
    try {
      const raw = JSON.parse(
        readFileSync(this.file, 'utf-8'),
      ) as Partial<UiState>;
      return { ...DEFAULTS, ...raw, __version__: SCHEMA_VERSION };
    } catch {
      return { ...DEFAULTS };
    }
  }

  private markDirty(): void {
    this.dirty = true;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flushNow(), FLUSH_DEBOUNCE_MS);
  }

  flushNow(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.dirty || !this.file) return;
    const tmp = `${this.file}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf-8');
      renameSync(tmp, this.file);
      this.dirty = false;
    } catch (e) {
      console.error('[ui-state] flush failed:', e);
    }
  }

  /** 退出前悬挂 flush。 */
  registerQuitFlush(): void {
    app.on('before-quit', () => this.flushNow());
    app.on('will-quit', () => this.flushNow());
  }
}
