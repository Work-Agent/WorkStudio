/** 捕获层专用 IPC 契约：只传指针事件与光标样式，不进入业务 bridge。 */

export const CAPTURE_CHANNEL = 'workstudio:capture';

export type CaptureMessage =
  | {
      type: 'move';
      buttons: number;
      clientX?: number;
      clientY?: number;
    }
  | { type: 'up' }
  | { type: 'cancel' };

export interface CaptureCommand {
  type: 'cursor';
  cursor: string;
}
