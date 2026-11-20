import type { WorkspaceWindow } from './native.ts';
import type {
  InteractionPreview,
  ResizeDirection,
} from '../../../shared/types.ts';
import type { Scene, WindowManager } from './native.ts';
import type { DomainRegistry } from '../../runtime/domains.ts';
import {
  beginInteraction,
  commitInteraction,
  computeLayout,
  previewInteraction,
  type InteractionInput,
  type InteractionSession,
} from './interaction.ts';
import type {
  DomainUpdate,
  LayoutSnapshot,
  NativeScene,
} from '../../runtime/shared.ts';
import { CH_CAPTURE } from '../../../shared/channels.ts';

/** 每窗口 shell/scene:<wsId> 与 shell/layout:<wsId>；窗口打开时绑定，关闭时移除。 */
/** 交互期透明捕获层的页面：无任何应用状态，只转发 pointer。 */
const CAPTURE_PAGE_URL =
  'data:text/html;charset=utf-8,' +
  encodeURIComponent(
    '<html><body style="margin:0;padding:0;width:100%;height:100%;background:transparent"></body></html>',
  );

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

function interactionCursor(input: InteractionInput): string {
  if (input.type === 'pane-resize') return 'col-resize';
  if (input.type === 'view-resize')
    return resizeCursor(input.direction ?? 'se');
  return 'move';
}

/** 每窗口 shell/scene:<wsId> + shell/layout:<wsId>，含 interaction 与捕获层。 */
export function bindWindowDomains(
  registry: DomainRegistry,
  windows: WindowManager,
  scene: Scene,
  capturePreload?: string,
): () => void {
  const bind = (window: WorkspaceWindow): void => {
    const sceneResource = registry
      .define('shell')
      .resource(`scene:${window.wsId}`);
    const layoutResource = registry
      .define('shell')
      .resource(`layout:${window.wsId}`);
    let session: InteractionSession | null = null;
    let preview: InteractionPreview | null = null;

    const size = (): { width: number; height: number } => {
      const bounds = window.current()?.getContentBounds();
      return { width: bounds?.width ?? 1440, height: bounds?.height ?? 900 };
    };
    const currentScene = (): NativeScene => scene.read(window.wsId) ?? {};
    const publishLayout = (): void => layoutResource.publish();

    /** 写 scene + 推 scene 状态；不推 layout（调用方决定何时发布）。 */
    const commitScene = (patch: Partial<NativeScene>): NativeScene => {
      const next = { ...currentScene(), ...patch };
      scene.write(window.wsId, next);
      sceneResource.patch(next);
      return next;
    };

    const applyScenePatch = (patch: Partial<NativeScene>): NativeScene => {
      const next = commitScene(patch);
      publishLayout();
      return next;
    };

    sceneResource.snapshot(currentScene);
    sceneResource.command<Partial<NativeScene>, NativeScene>('patch', (call) =>
      applyScenePatch(call.input),
    );

    const capture = capturePreload
      ? window.global.create({
          type: 'capture',
          url: CAPTURE_PAGE_URL,
          preload: capturePreload,
        })
      : null;
    const captureView = capture ? window.global.nativeView(capture.id) : null;

    const updatePreview = (cursor: { x: number; y: number }): void => {
      preview = session ? previewInteraction(session, cursor, size()) : null;
      publishLayout();
    };

    const pointerAt = (
      value: unknown,
      fallback: { x: number; y: number },
    ): { x: number; y: number } => {
      const input = value as
        | { pointerX?: unknown; pointerY?: unknown }
        | undefined;
      return {
        x: typeof input?.pointerX === 'number' ? input.pointerX : fallback.x,
        y: typeof input?.pointerY === 'number' ? input.pointerY : fallback.y,
      };
    };

    const showCapture = (input: InteractionInput): void => {
      if (!capture || !captureView) return;
      window.global.show(capture.id, true);
      captureView.webContents.focus();
      captureView.webContents.send(CH_CAPTURE, {
        type: 'cursor',
        cursor: interactionCursor(input),
      });
    };

    const hideCapture = (): void => {
      if (capture) window.global.show(capture.id, false);
    };

    const endInteraction = (): void => {
      const committed = preview
        ? commitInteraction(preview, currentScene(), size().width)
        : null;
      session = null;
      preview = null;
      if (committed && Object.keys(committed).length > 0) {
        commitScene(committed);
      }
      // 先清 preview 再发布：最后一帧必须是提交后的 scene，而不是拖拽预览。
      publishLayout();
      hideCapture();
      window.current()?.webContents.focus();
    };

    const cancelInteraction = (): void => {
      session = null;
      preview = null;
      hideCapture();
      publishLayout();
    };

    layoutResource.snapshot(
      (): LayoutSnapshot => computeLayout(size(), currentScene(), preview),
    );
    layoutResource.command<InteractionInput, null>('begin', (call) => {
      const input = call.input;
      const screen = window.cursor() ?? { x: 0, y: 0 };
      const cursor =
        input.type === 'pane-resize' && input.side !== 'right'
          ? pointerAt(input, screen)
          : screen;
      session = beginInteraction(currentScene(), input, cursor);
      updatePreview(cursor);
      showCapture(input);
      return null;
    });
    layoutResource.command<
      { pointerX?: number; pointerY?: number } | null,
      null
    >('move', (call) => {
      if (!session) return null;
      const fallback = window.cursor() ?? session.cursor;
      const usePointer =
        session.input.type === 'pane-resize' && session.input.side !== 'right';
      updatePreview(usePointer ? pointerAt(call.input, fallback) : fallback);
      return null;
    });
    layoutResource.command<null, null>('end', () => {
      endInteraction();
      return null;
    });
    layoutResource.command<null, null>('cancel', () => {
      cancelInteraction();
      return null;
    });

    captureView?.webContents.on('ipc-message', (_event, channel, payload) => {
      if (channel !== CH_CAPTURE || !session) return;
      const message = payload as
        | { type?: string; clientX?: unknown; clientY?: unknown }
        | undefined;
      if (message?.type === 'move') {
        updatePreview(
          session.input.type.startsWith('view-')
            ? (window.cursor() ?? session.cursor)
            : pointerAt(
                {
                  pointerX: message.clientX,
                  pointerY: message.clientY,
                },
                window.cursor() ?? session.cursor,
              ),
        );
      } else if (message?.type === 'up') endInteraction();
      else if (message?.type === 'cancel') cancelInteraction();
    });
    window.current()?.on('blur', () => {
      if (session) endInteraction();
    });

    window.onResize(publishLayout);
    layoutResource.publish();
  };

  const unbind = (window: WorkspaceWindow): void => {
    registry.define('shell').remove(`scene:${window.wsId}`);
    registry.define('shell').remove(`layout:${window.wsId}`);
  };

  const offOpen = windows.onOpen(bind);
  const offClose = windows.onClose(unbind);
  for (const window of windows.list()) bind(window);
  return () => {
    offOpen();
    offClose();
    for (const window of windows.list()) unbind(window);
  };
}

/** layout 快照同时驱动原生视图几何，不需要额外 controller。 */
export function applyLayoutUpdates(
  registry: DomainRegistry,
  windows: WindowManager,
): () => void {
  return registry.onUpdate((update: DomainUpdate) => {
    if (update.domain !== 'shell' || update.type !== 'snapshot') return;
    if (!update.resource.startsWith('layout:')) return;
    windows
      .get(update.resource.slice('layout:'.length))
      ?.applyLayout(update.data as LayoutSnapshot);
  });
}
