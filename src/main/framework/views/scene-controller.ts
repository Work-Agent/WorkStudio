/** 原生现场 / 布局 / 交互：scene、viewport、拖拽预览与 layout 状态。 */
import { CH_CAPTURE } from '../../../shared/channels';
import {
  clampFloating,
  computeLayout,
  defaultFloating,
} from '../../../shared/layout-engine';
import type {
  InteractionPreview,
  LayoutSnapshot,
  ResizeDirection,
} from '../../../shared/types';
import type { StateHandle } from '../../core/handles';
import type { GlobalRegistration } from '../middleware';
import {
  DEFAULT_NATIVE_SCENE,
  patchNativeScene,
  toUiState,
  type NativeScene,
  type NativeScenePatch,
} from '../scene';
import type { ElectronCapability } from '../electron-middleware';
import type { Theme } from '../../core/types';

export interface InteractionInput {
  type: 'pane-resize' | 'view-move' | 'view-resize' | 'tab-reorder';
  side?: 'left' | 'right';
  /** 交互目标（助手缩放把手上报 target=assistant / 右栏上报表 right）。 */
  target?: string;
  direction?: ResizeDirection;
  pointerX?: number;
  pointerY?: number;
  tabKey?: string;
  viewId?: string;
}

interface InteractionSession {
  input: InteractionInput;
  widths: { left: number; right: number };
  floating: { x: number; y: number; width: number; height: number } | null;
  /** 起点用窗口坐标的屏幕光标（client 坐标在视图移动后会失真）。 */
  startCursor: { x: number; y: number };
}

const MIN_PANE = 120;
const MAX_PANE = 720;

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

export class SceneController {
  private viewport: { width: number; height: number } | null = null;
  private preview: InteractionPreview | null = null;
  private session: InteractionSession | null = null;
  private currentWsId: string | null = null;
  private readonly scenes = new Map<string, NativeScene>();
  private layoutState!: StateHandle<LayoutSnapshot>;
  private sceneState!: StateHandle<NativeScene>;
  private interactionState!: StateHandle<InteractionPreview | null>;

  constructor(
    private readonly electron: ElectronCapability,
    private readonly theme: () => Theme,
    /** 指针捕获层视图 id（系统视图就绪后才有值）。 */
    private readonly captureId: () => string | undefined,
  ) {}

  install(global: GlobalRegistration): void {
    this.layoutState = global.state<LayoutSnapshot>('/layout');
    this.sceneState = global.state<NativeScene>('/scene/:wsId');
    this.interactionState = global.state<InteractionPreview | null>(
      '/interaction',
    );
    global.handle('/scene/:wsId/patch', (call) =>
      this.applyScene(String(call.params['wsId']), call.input ?? {}),
    );
    global.handle('/viewport/set', (call) => {
      const input = call.input as { width?: number; height?: number };
      this.setViewport(Number(input?.width ?? 0), Number(input?.height ?? 0));
      return null;
    });
    global.handle('/interaction/:phase', (call) =>
      this.interaction(
        String(call.params['phase']),
        call.input as InteractionInput,
      ),
    );
    // 捕获层接管拖拽期间的指针事件：发起视图在指针移出后收不到 move/up。
    this.electron.views.onCapture((message) => {
      if (!this.session) return;
      if (message.type === 'move') this.applyPreview();
      else if (message.type === 'up') this.commitInteraction();
      else this.cancelInteraction();
    });
    // 焦点离开窗口时指针序列已断：按松手提交，避免交互悬挂。
    this.electron.window.onBlur(() => {
      if (this.session) this.commitInteraction();
    });
    this.interactionState.publish(null);
  }

  activate(): void {
    this.publishLayout();
  }

  onCurrent(current: { id: string } | null): void {
    const next = current?.id ?? null;
    if (this.currentWsId && this.currentWsId !== next) {
      this.sceneState.drop({ wsId: this.currentWsId });
      this.scenes.delete(this.currentWsId);
    }
    this.currentWsId = next;
    this.preview = null;
    this.session = null;
    this.detachCapture();
    this.interactionState.publish(null);
    if (next) this.sceneState.publish({ wsId: next }, this.sceneFor(next));
    this.publishLayout();
  }

  publishLayout(): void {
    const layout = this.computeLayout();
    this.electron.window.applyLayout(layout);
    this.layoutState.publish(layout);
  }

  private setViewport(width: number, height: number): void {
    this.viewport = width > 0 && height > 0 ? { width, height } : null;
    this.publishLayout();
  }

  private applyScene(wsId: string, patch: NativeScenePatch): NativeScene {
    const scene = patchNativeScene(this.sceneFor(wsId), patch);
    this.scenes.set(wsId, scene);
    this.electron.scene.write(wsId, scene);
    this.sceneState.publish({ wsId }, scene);
    if (wsId === this.currentWsId) this.publishLayout();
    return scene;
  }

  private interaction(phase: string, input: InteractionInput): null {
    switch (phase) {
      case 'begin':
        this.session = {
          input,
          widths: this.currentScene().paneWidths,
          floating: this.currentScene().floating,
          startCursor: this.electron.window.cursor() ?? {
            x: Number(input.pointerX ?? 0),
            y: Number(input.pointerY ?? 0),
          },
        };
        this.attachCapture();
        this.applyPreview();
        break;
      case 'move':
        this.applyPreview();
        break;
      case 'end':
        this.commitInteraction();
        break;
      case 'cancel':
        this.cancelInteraction();
        break;
    }
    return null;
  }

  /** 指针几何始终以窗口坐标的屏幕光标为准，忽略渲染层上报的 client 坐标。 */
  private applyPreview(): void {
    const session = this.session;
    if (!session) return;
    const input = session.input;
    const layout = this.computeLayout();
    const cursor = this.electron.window.cursor() ?? session.startCursor;
    const dx = cursor.x - session.startCursor.x;
    const dy = cursor.y - session.startCursor.y;
    if (input.type === 'pane-resize') {
      const side = input.side ?? (input.target === 'right' ? 'right' : 'left');
      const desired =
        side === 'left' ? cursor.x : layout.window.width - cursor.x;
      const clamped = Math.min(Math.max(desired, MIN_PANE), MAX_PANE);
      this.setPreview({
        type: 'pane-resize',
        side,
        ...(side === 'left'
          ? {
              sidebarCollapsed: clamped < 160,
              paneWidths: {
                left: clamped < 160 ? 56 : clamped,
                right: session.widths.right,
              },
            }
          : {
              paneWidths: {
                left: session.widths.left,
                right: clamped,
              },
            }),
      });
    } else if (input.type === 'view-move' || input.type === 'view-resize') {
      const start = session.floating ?? defaultFloating(layout.resourcePane);
      if (input.type === 'view-move') {
        this.setPreview({
          type: 'view-move',
          floating: clampFloating(
            { ...start, x: start.x + dx, y: start.y + dy },
            layout.resourcePane,
          ),
        });
        return;
      }
      // 八向：只动被拖的边/角（对边保持不动），再整体夹回面板内。
      const d = input.direction ?? 'se';
      const box = {
        x: start.x + (d.includes('w') ? dx : 0),
        y: start.y + (d.includes('n') ? dy : 0),
        width:
          start.width + (d.includes('e') ? dx : 0) - (d.includes('w') ? dx : 0),
        height:
          start.height +
          (d.includes('s') ? dy : 0) -
          (d.includes('n') ? dy : 0),
      };
      this.setPreview({
        type: 'view-resize',
        floating: clampFloating(box, layout.resourcePane),
      });
    } else if (input.type === 'tab-reorder') {
      this.setPreview({
        type: 'tab-reorder',
        ...(input.tabKey ? { tabKey: input.tabKey } : {}),
      });
    }
  }

  private commitInteraction(): void {
    const preview = this.preview;
    if (preview?.type === 'pane-resize' && preview.paneWidths) {
      const patch: NativeScenePatch = { paneWidths: preview.paneWidths };
      if (preview.side === 'left') {
        patch.sidebarCollapsed = preview.sidebarCollapsed;
      }
      if (this.currentWsId) this.applyScene(this.currentWsId, patch);
    } else if (
      (preview?.type === 'view-move' || preview?.type === 'view-resize') &&
      preview.floating &&
      this.currentWsId
    ) {
      this.applyScene(this.currentWsId, { floating: preview.floating });
    }
    this.session = null;
    this.detachCapture();
    this.setPreview(null);
  }

  private cancelInteraction(): void {
    this.session = null;
    this.detachCapture();
    this.setPreview(null);
  }

  /** 交互期间挂上全窗捕获层：指针移出发起视图后仍需 move/up。 */
  private attachCapture(): void {
    const id = this.captureId();
    if (!id) return;
    const input = this.session?.input;
    this.electron.views.setVisible(id, true);
    this.electron.views.focus(id);
    this.electron.views.send(id, CH_CAPTURE, {
      type: 'cursor',
      cursor:
        input?.type === 'pane-resize'
          ? 'col-resize'
          : input?.type === 'view-resize'
            ? resizeCursor(input.direction ?? 'se')
            : input?.type === 'tab-reorder'
              ? 'grabbing'
              : 'move',
    });
  }

  private detachCapture(): void {
    const id = this.captureId();
    if (id) this.electron.views.setVisible(id, false);
  }

  private setPreview(preview: InteractionPreview | null): void {
    this.preview = preview;
    this.interactionState.publish(preview);
    this.publishLayout();
  }

  private currentScene(): NativeScene {
    return this.currentWsId
      ? this.sceneFor(this.currentWsId)
      : DEFAULT_NATIVE_SCENE;
  }

  private sceneFor(wsId: string): NativeScene {
    const cached = this.scenes.get(wsId);
    if (cached) return cached;
    const scene = this.electron.scene.read(wsId) ?? DEFAULT_NATIVE_SCENE;
    this.scenes.set(wsId, scene);
    return scene;
  }

  private computeLayout(): LayoutSnapshot {
    const bounds = this.electron.window.bounds() ?? {
      width: 1440,
      height: 900,
    };
    const scene = this.currentScene();
    return computeLayout({
      windowWidth: bounds.width,
      windowHeight: bounds.height,
      ui: toUiState(scene, this.theme()),
      floating: scene.floating,
      preview: this.preview,
      viewport: this.viewport,
    });
  }
}
