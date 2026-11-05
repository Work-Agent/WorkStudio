/**
 * 助手视图的 appBridge 门面。
 */
import { appAssistantCommand } from './appCommands';

const appBridge = window.appBridge;

let lastInput: Record<string, unknown> | null = null;

const interaction = {
  async begin(input: {
    type: string;
    target?: string;
    direction?: string;
    anchor?: { x: number; y: number };
  }): Promise<{ ok: boolean }> {
    lastInput = {
      type: input.type,
      ...(input.target ? { target: input.target } : {}),
      ...(input.direction ? { direction: input.direction } : {}),
      pointerX: input.anchor?.x ?? 0,
      pointerY: input.anchor?.y ?? 0,
    };
    const result = await appBridge!.call('/interaction/begin', lastInput);
    return { ok: result.ok };
  },
  /** 只上报“仍在拖”：几何由主进程按屏幕光标计算（client 坐标会随视图移动失真）。 */
  async move(): Promise<{ ok: boolean }> {
    const result = await appBridge!.call('/interaction/move', lastInput);
    return { ok: result.ok };
  },
  async end(): Promise<{ ok: boolean }> {
    const result = await appBridge!.call('/interaction/end', lastInput);
    return { ok: result.ok };
  },
  async cancel(): Promise<{ ok: boolean }> {
    const result = await appBridge!.call('/interaction/cancel', lastInput);
    return { ok: result.ok };
  },
};

export const bridge = appBridge
  ? {
      cmd: appAssistantCommand,
      interaction,
      async popupMenu(input: {
        items: Array<{ id: string; label: string; disabled?: boolean }>;
      }): Promise<string | null> {
        const result = await appBridge.call<string | null>(
          '/native/popup-menu',
          { items: input.items },
        );
        return result.ok ? result.data : null;
      },
    }
  : undefined;

export const MENU_SOURCE = 'chat-tabs';
