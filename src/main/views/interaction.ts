/**
 * InteractionController —— 指针交互会话（views-design.md §八）。
 *
 * 主进程是唯一执行者：拖拽期间由捕获层接收指针事件，本控制器按
 * screen 光标位置计算预览（栏宽 / 浮动几何 / 插入位），结束时夹取提交。
 * 渲染层只渲染预览，不参与任何几何计算。
 */
import { BrowserWindow, screen, type WebContentsView } from 'electron';
import type {
  InteractionBeginInput,
  InteractionPreview,
  Rect,
} from '../../shared/types';
import { CH_CAPTURE } from '../../shared/channels';
import type { ViewHost } from './view-host';
import {
  clampFloating,
  commitPaneResize,
  defaultFloating,
  previewPaneResize,
} from '../../shared/layout-engine';
import type { LayoutSnapshot, ResizeDirection } from '../../shared/types';
import type { UiStateService } from '../state/ui-state';
import { createLogger } from '../log';

const log = createLogger('interaction');

/** 缩放方向 → CSS 光标名。 */
function resizeCursor(direction: ResizeDirection): string {
  switch (direction) {
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

interface Session {
  kind: InteractionBeginInput['kind'];
  target: string;
  /** view-resize 的缩放方向（八向；缺省 'se'）。 */
  direction: ResizeDirection;
  startCursor: { x: number; y: number };
  startUi: ReturnType<UiStateService['get']>;
  startFloating: Rect | null;
  preview: InteractionPreview | null;
  lastUpdateAt: number;
}

export interface InteractionDeps {
  getWindow: () => BrowserWindow | null;
  viewHost: ViewHost;
  uiState: UiStateService;
  getLayout: () => LayoutSnapshot;
  getFloating: () => Rect | null;
  setFloating: (rect: Rect | null) => void;
  broadcastState: () => void;
  applyLayout: () => void;
}

export class InteractionController {
  private session: Session | null = null;
  private capture: WebContentsView | null = null;
  /** 诊断：本次交互是否见过移动来源（定位“拖不动”类问题）。 */
  private moveSeen = false;

  constructor(private readonly deps: InteractionDeps) {}

  getPreview(): InteractionPreview | null {
    return this.session?.preview ?? null;
  }

  getFloating(): Rect | null {
    return this.deps.getFloating();
  }

  /** 开始交互（渲染层 pointerdown 发起；anchor 仅供参考，主进程以 screen 光标为准）。 */
  begin(input: InteractionBeginInput): void {
    if (this.session) this.finish(true, 'begin-replace');
    const win = this.deps.getWindow();
    if (!win || win.isDestroyed()) return;
    this.session = {
      kind: input.kind,
      target: input.target,
      direction: input.direction ?? 'se',
      startCursor: this.cursorInWindow(win),
      startUi: this.deps.uiState.get(),
      startFloating: this.deps.getFloating(),
      preview: null,
      lastUpdateAt: 0,
    };
    this.moveSeen = false;
    this.attachCapture(win);
    log.info('begin', input.kind, input.target);
  }

  /** 发起方（拥有拖拽序列的页面）上报移动：位置仍由主进程以 screen 光标为准。 */
  move(): void {
    if (!this.session) return;
    if (!this.moveSeen) {
      this.moveSeen = true;
      log.info('first initiator move');
    }
    this.update();
  }

  /**
   * 捕获层移动事件：跟手几何的唯一可靠来源。
   *
   * 捕获层的 renderer 从未见过 mousedown（拖拽起于助手视图），其 `buttons`
   * 反映不出真实按键态（实测恒为 0），因此这里**不做按键裁决**：
   * 移动就更新几何；结束一律由发起方的 pointerup / 窗口 blur / Esc 负责。
   */
  private onCaptureMove(buttons: number): void {
    if (!this.session) return;
    if (!this.moveSeen) {
      this.moveSeen = true;
      log.info('first capture move', 'buttons=' + buttons);
    }
    this.update();
  }

  /** 结束并提交（Esc / pointerup / blur / 显式 end 共用；cancel=true 恢复起点）。 */
  finish(cancel = false, why = 'unknown'): void {
    const session = this.session;
    if (!session) return;
    this.session = null;
    log.info(
      'finish',
      'cancel=' + cancel,
      'why=' + why,
      'preview=' + Boolean(session.preview),
    );
    this.detachCapture();
    if (!cancel && session.preview) {
      const win = this.deps.getWindow();
      if (session.kind === 'pane-resize') {
        const patch = commitPaneResize(
          session.preview,
          session.startUi,
          win?.getContentBounds().width ?? 0,
        );
        this.deps.uiState.set(patch);
      } else if (
        session.kind === 'view-move' ||
        session.kind === 'view-resize'
      ) {
        if (session.preview.floating)
          this.deps.setFloating(session.preview.floating);
      }
    }
    this.deps.applyLayout();
    this.deps.broadcastState();
  }

  dispose(): void {
    this.finish(true, 'dispose');
  }

  // ─── 内部 ───────────────────────────────────────────────

  private attachCapture(win: BrowserWindow): void {
    const view = this.deps.viewHost.warmCaptureView();
    this.capture = view;
    this.deps.viewHost.setCaptureActive(true);
    log.info('capture active');
    try {
      view.webContents.focus();
    } catch {
      /* ignore */
    }
    const cursor =
      this.session?.kind === 'pane-resize'
        ? 'col-resize'
        : this.session?.kind === 'view-resize'
          ? resizeCursor(this.session.direction)
          : this.session?.kind === 'tab-reorder'
            ? 'grabbing'
            : 'move';
    view.webContents.send(CH_CAPTURE, { type: 'cursor', cursor });
    view.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape')
        this.finish(true, 'esc');
    });
    win.once('blur', this.onWindowBlur);
    view.webContents.on('ipc-message', (_e, channel, payload) => {
      if (channel !== CH_CAPTURE) return;
      const message = payload as {
        type: 'move' | 'up' | 'cancel';
        buttons?: number;
      };
      if (message.type === 'move') this.onCaptureMove(message.buttons ?? 0);
      else if (message.type === 'up') this.finish(false, 'capture-up');
      else this.finish(true, 'capture-cancel');
    });
    // 捕获层页面就绪前也可能有事件；preload 直接经 ipcRenderer.send，这里已就绪。
  }

  private readonly onWindowBlur = (): void => {
    if (this.session) {
      this.finish(false, 'window-blur');
    }
  };

  private detachCapture(): void {
    const win = this.deps.getWindow();
    if (win && !win.isDestroyed())
      win.removeListener('blur', this.onWindowBlur);
    this.capture = null;
    this.deps.viewHost.setCaptureActive(false);
  }

  /** 指针更新：节流到 ~60fps，按 kind 计算预览并应用。 */
  private update(): void {
    const session = this.session;
    if (!session) return;
    const now = Date.now();
    if (now - session.lastUpdateAt < 12) return;
    session.lastUpdateAt = now;
    const win = this.deps.getWindow();
    if (!win || win.isDestroyed()) return;
    const cursor = this.cursorInWindow(win);
    const layout = this.deps.getLayout();
    const ui = this.deps.uiState.get();

    switch (session.kind) {
      case 'pane-resize': {
        session.preview = previewPaneResize(
          session.target === 'right' ? 'right' : 'left',
          session.startCursor.x,
          cursor.x,
          session.startUi,
          layout.window.width,
        );
        break;
      }
      case 'view-move': {
        const start =
          session.startFloating ?? defaultFloating(layout.resourcePane);
        const next = clampFloating(
          {
            ...start,
            x: start.x + (cursor.x - session.startCursor.x),
            y: start.y + (cursor.y - session.startCursor.y),
          },
          layout.resourcePane,
        );
        session.preview = { kind: 'view-move', floating: next };
        break;
      }
      case 'view-resize': {
        const start =
          session.startFloating ?? defaultFloating(layout.resourcePane);
        const dx = cursor.x - session.startCursor.x;
        const dy = cursor.y - session.startCursor.y;
        const d = session.direction;
        // 八向：只动被拖的那条边/角（对边保持不动），再整体夹回面板内
        const box = {
          x: start.x + (d.includes('w') ? dx : 0),
          y: start.y + (d.includes('n') ? dy : 0),
          width:
            start.width +
            (d.includes('e') ? dx : 0) -
            (d.includes('w') ? dx : 0),
          height:
            start.height +
            (d.includes('s') ? dy : 0) -
            (d.includes('n') ? dy : 0),
        };
        session.preview = {
          kind: 'view-resize',
          floating: clampFloating(box, layout.resourcePane),
        };
        break;
      }
      case 'tab-reorder': {
        session.preview = {
          kind: 'tab-reorder',
          cursorX: cursor.x,
          tabKey: session.target,
        };
        break;
      }
    }
    void ui;
    this.deps.applyLayout();
    this.deps.broadcastState();
  }

  /** 屏幕 DIP 坐标 → 窗口内容坐标。 */
  private cursorInWindow(win: BrowserWindow): { x: number; y: number } {
    const point = screen.getCursorScreenPoint();
    const bounds = win.getContentBounds();
    return { x: point.x - bounds.x, y: point.y - bounds.y };
  }
}
