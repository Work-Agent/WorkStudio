/**
 * Mock 弹窗菜单 —— 原生 Menu.popup 的 DOM 等价物（同协议：source + items + onSelect）。
 * 真实版由主进程原生菜单承载；页面开发期用 DOM 浮层保证交互链路完整。
 */
import type { PopupMenuAPI, PopupSelectEvent } from '../../../shared/types';

export function createMockPopupMenu(): PopupMenuAPI {
  const listeners = new Set<(e: PopupSelectEvent) => void>();
  let layer: HTMLDivElement | null = null;
  let lastMouse = { x: window.innerWidth / 2, y: 80 };

  const trackMouse = (e: MouseEvent): void => {
    lastMouse = { x: e.clientX, y: e.clientY };
  };
  window.addEventListener('mousedown', trackMouse, true);
  window.addEventListener('contextmenu', trackMouse, true);

  const close = (): void => {
    layer?.remove();
    layer = null;
    document.removeEventListener('mousedown', onDocumentMouseDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
  };

  const onDocumentMouseDown = (e: MouseEvent): void => {
    if (layer && !layer.contains(e.target as Node)) close();
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };

  const show: PopupMenuAPI['show'] = ({ source, items }) => {
    close();
    layer = document.createElement('div');
    layer.className =
      'fixed z-[200] min-w-[180px] py-1 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#252829] shadow-lg select-none';
    layer.style.left = `${Math.min(lastMouse.x, window.innerWidth - 200)}px`;
    layer.style.top = `${lastMouse.y}px`;

    for (const item of items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = item.label;
      button.disabled = item.disabled === true;
      button.className = `block w-full text-left px-2.5 py-1.5 text-[12px] transition-colors ${
        item.disabled
          ? 'text-zinc-300 dark:text-zinc-600 cursor-default'
          : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-[#2a2d2e]'
      }`;
      if (!item.disabled) {
        button.addEventListener('click', () => {
          close();
          for (const listener of listeners)
            listener({ source, actionId: item.id });
        });
      }
      layer.appendChild(button);
    }

    document.body.appendChild(layer);
    // 视口下缘溢出时向上收（简单翻转）
    const rect = layer.getBoundingClientRect();
    if (rect.bottom > window.innerHeight - 8) {
      layer.style.top = `${Math.max(8, lastMouse.y - rect.height)}px`;
    }
    document.addEventListener('mousedown', onDocumentMouseDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return Promise.resolve();
  };

  return {
    show,
    onSelect: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    close: () => {
      close();
      return Promise.resolve();
    },
    count: () => Promise.resolve(layer ? 1 : 0),
  };
}
