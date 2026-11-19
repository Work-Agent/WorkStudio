/**
 * 指针捕获层 preload（architecture.md §5.1.5）—— 交互期透明全窗视图的输入层。
 *
 * 页面无任何应用状态：把 pointer 事件与光标样式经专用 IPC 通道报给
 * InteractionController；主进程以 screen 光标为权威坐标（本层不换算几何）。
 */
import { ipcRenderer } from 'electron';
import { CH_CAPTURE } from '../shared/channels.ts';

type CaptureCommand = { type: 'cursor'; cursor: string };

const report = (
  type: 'move' | 'up' | 'cancel',
  buttons = 0,
  point?: { clientX: number; clientY: number },
): void => {
  ipcRenderer.send(CH_CAPTURE, {
    type,
    buttons,
    ...(point ? { clientX: point.clientX, clientY: point.clientY } : {}),
  });
};

ipcRenderer.on(CH_CAPTURE, (_e, command: CaptureCommand) => {
  if (command?.type === 'cursor') {
    document.body.style.cursor = command.cursor || 'default';
  }
});

window.addEventListener(
  'pointermove',
  (e) => {
    // 只有主键保持按下才是拖拽；无键移动说明 up 丢了（跨视图序列），按松手收敛。
    report('move', e.buttons, e);
  },
  { passive: true },
);
window.addEventListener('pointerup', () => report('up'), { passive: true });
window.addEventListener('pointercancel', () => report('cancel'), {
  passive: true,
});
// 注意：不要监听 window blur —— begin 后焦点在捕获层与发起视图之间切换是正常现象，
// 不是取消信号（真正取消 = Esc / 发起方 cancel / 窗口 blur）。
window.addEventListener('contextmenu', (e) => e.preventDefault());
