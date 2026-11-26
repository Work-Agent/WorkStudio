/**
 * S1 集成式标题栏的跨进程几何契约（主进程建窗 ⇄ 渲染层布局，同一事实源）。
 *
 * 窗口控制按钮（Windows/Linux「三键」、macOS 红绿灯）是原生绘制、位置由平台决定的
 * ——macOS 在左；Windows 在右；Linux 由 DE 配置（可在左可在右）。故渲染层不得写死
 * 留白，运行时由 WCO 几何反推；本文件只提供：
 *   1. 建窗参数（高度 / 覆盖层配色）
 *   2. 无 WCO 几何信息时的平台兜底留白
 */
import { TITLEBAR_HEIGHT } from './layout.ts';

/** 标题栏高度（px）——与渲染层 .titlebar 一致（WCO 覆盖层高度 / 兜底高度）。 */
export { TITLEBAR_HEIGHT };

/** WCO 覆盖层配色（与渲染层标题栏底色一致：亮 zinc-100 / 暗 #1A1C1D）。 */
export const TITLEBAR_OVERLAY_COLORS = {
  light: { color: '#f4f4f5', symbolColor: '#3f3f46' },
  dark: { color: '#1a1c1d', symbolColor: '#e6e6e6' },
} as const;

/**
 * 兜底留白（px）——仅在无 WCO 几何信息时使用：
 *   darwin  红绿灯在左（覆盖层未启用，rect 全零）
 *   win32   三键在右（WCO 可用时以实测 rect 为准，不用此值）
 *   linux   三键默认在右（DE 也可配置在左；WCO 可用时以实测 rect 为准）
 */
export const TITLEBAR_FALLBACK_INSET = {
  darwin: { left: 72, right: 0 },
  win32: { left: 0, right: 138 },
  linux: { left: 0, right: 138 },
} as const;

export type TitlebarPlatform = keyof typeof TITLEBAR_FALLBACK_INSET;
