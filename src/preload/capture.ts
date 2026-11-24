/**
 * 捕获层 preload：只接专用 capture 通道，不注入 window.workStudio。
 */

import { ipcRenderer } from 'electron';
import {
  CAPTURE_CHANNEL,
  type CaptureCommand,
  type CaptureMessage,
} from '../shared/capture.ts';

function report(message: CaptureMessage): void {
  ipcRenderer.send(CAPTURE_CHANNEL, message);
}

ipcRenderer.on(CAPTURE_CHANNEL, (_event, command: CaptureCommand) => {
  if (command?.type === 'cursor') {
    document.body.style.cursor = command.cursor || 'default';
  }
});

window.addEventListener(
  'pointermove',
  (event) => {
    report({
      type: 'move',
      buttons: event.buttons,
      clientX: event.clientX,
      clientY: event.clientY,
    });
  },
  { passive: true },
);
window.addEventListener('pointerup', () => report({ type: 'up' }), {
  passive: true,
});
window.addEventListener('pointercancel', () => report({ type: 'cancel' }), {
  passive: true,
});
window.addEventListener('contextmenu', (event) => event.preventDefault());
