/** 原生现场 / 布局 / 交互：scene、viewport、拖拽预览与 layout 状态。 */
import {
  clampFloating,
  computeLayout,
  defaultFloating,
} from '../../../shared/layout-engine';
import type { InteractionPreview, LayoutSnapshot } from '../../../shared/types';
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
  pointerX?: number;
  pointerY?: number;
  tabKey?: string;
  viewId?: string;
}

interface InteractionSession {
  input: InteractionInput;
  widths: { left: number; right: number };
  floating: { x: number; y: number; width: number; height: number } | null;
  startX: number;
  startY: number;
}

const MIN_PANE = 120;
const MAX_PANE = 720;

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
          startX: Number(input.pointerX ?? 0),
          startY: Number(input.pointerY ?? 0),
        };
        this.applyPreview(input);
        break;
      case 'move':
        this.applyPreview(input);
        break;
      case 'end':
        this.commitInteraction();
        break;
      case 'cancel':
        this.session = null;
        this.setPreview(null);
        break;
    }
    return null;
  }

  private applyPreview(input: InteractionInput): void {
    const session = this.session;
    if (!session) return;
    const layout = this.computeLayout();
    if (input.type === 'pane-resize' && input.side) {
      const pointerX = Number(input.pointerX ?? session.startX);
      const desired =
        input.side === 'left' ? pointerX : layout.window.width - pointerX;
      const clamped = Math.min(Math.max(desired, MIN_PANE), MAX_PANE);
      this.setPreview({
        type: 'pane-resize',
        side: input.side,
        ...(input.side === 'left'
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
      const pointerX = Number(input.pointerX ?? session.startX);
      const pointerY = Number(input.pointerY ?? session.startY);
      const start = session.floating ?? defaultFloating(layout.resourcePane);
      const dx = pointerX - session.startX;
      const dy = pointerY - session.startY;
      this.setPreview({
        type: input.type,
        floating: clampFloating(
          input.type === 'view-move'
            ? { ...start, x: start.x + dx, y: start.y + dy }
            : {
                ...start,
                width: Math.max(300, start.width + dx),
                height: Math.max(360, start.height + dy),
              },
          layout.resourcePane,
        ),
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
    this.setPreview(null);
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
