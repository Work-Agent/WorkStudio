/**
 * 原生窗口控制（WCO）几何 → 标题栏左右留白（views-design.md §12.2）。
 *
 * 规则：TitleBar 不得写死平台留白——三键位置由平台决定：
 *   - macOS：红绿灯在左（不经覆盖层，走平台兜底值）
 *   - Windows：titleBarOverlay 三键在右（以 WCO 实测 rect 为准）
 *   - Linux：WCO 三键位置由 DE 配置（可在左，可在右）→ 必须读 WCO 几何
 *
 * 数据源（仅 Windows/Linux）= navigator.windowControlsOverlay.getTitlebarAreaRect()；
 * 反推两侧留白后写 :root CSS 变量 --titlebar-inset-left/right / --titlebar-height。
 */
import {
  TITLEBAR_FALLBACK_INSET,
  TITLEBAR_HEIGHT,
  type TitlebarPlatform,
} from '../../../shared/titlebar';
import { electronAPI } from '../../api/bridge';

export interface TitlebarAreaRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface WindowControlsOverlayLike {
  visible: boolean;
  getTitlebarAreaRect(): TitlebarAreaRect;
  addEventListener(type: 'geometrychange', listener: () => void): void;
  removeEventListener(type: 'geometrychange', listener: () => void): void;
}

/** 由 WCO 几何反推两侧留白：rect 之外的部分即原生三键占据区。 */
export function computeTitlebarInsets(
  rect: Pick<TitlebarAreaRect, 'x' | 'width'>,
  viewportWidth: number,
): { left: number; right: number } {
  return {
    left: Math.max(0, Math.round(rect.x)),
    right: Math.max(0, Math.round(viewportWidth - rect.x - rect.width)),
  };
}

function wcoOf(): WindowControlsOverlayLike | undefined {
  return (
    navigator as Navigator & {
      windowControlsOverlay?: WindowControlsOverlayLike;
    }
  ).windowControlsOverlay;
}

let disposeCurrent: (() => void) | null = null;

/**
 * 绑定 WCO 几何 → CSS 变量（幂等：重复调用先解绑旧监听，兼容 HMR 重跑）。
 */
export function bindTitlebarInsets(
  platform: string = electronAPI.platform,
): () => void {
  disposeCurrent?.();

  const root = document.documentElement;
  const fallback =
    TITLEBAR_FALLBACK_INSET[platform as TitlebarPlatform] ??
    TITLEBAR_FALLBACK_INSET.linux;
  // 平台门：只有 Windows / Linux 走 WCO 几何——macOS 红绿灯不经覆盖层。
  const wco =
    platform === 'win32' || platform === 'linux' ? wcoOf() : undefined;

  const apply = (): void => {
    const rect = wco?.getTitlebarAreaRect();
    if (rect && rect.width > 0) {
      const { left, right } = computeTitlebarInsets(rect, root.clientWidth);
      root.style.setProperty('--titlebar-inset-left', `${left}px`);
      root.style.setProperty('--titlebar-inset-right', `${right}px`);
      if (rect.height > 0)
        root.style.setProperty('--titlebar-height', `${rect.height}px`);
      return;
    }
    root.style.setProperty('--titlebar-inset-left', `${fallback.left}px`);
    root.style.setProperty('--titlebar-inset-right', `${fallback.right}px`);
    root.style.setProperty('--titlebar-height', `${TITLEBAR_HEIGHT}px`);
  };

  apply();
  wco?.addEventListener('geometrychange', apply);
  window.addEventListener('resize', apply);

  const dispose = (): void => {
    wco?.removeEventListener('geometrychange', apply);
    window.removeEventListener('resize', apply);
    if (disposeCurrent === dispose) disposeCurrent = null;
  };
  disposeCurrent = dispose;
  return dispose;
}
