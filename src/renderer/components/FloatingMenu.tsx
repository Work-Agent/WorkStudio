/**
 * FloatingMenu —— Floating UI 浮层基座（renderer anchored dropdown 统一方案）。
 *
 * 能力：
 * - useFloating + autoUpdate：滚动 / resize / 内容尺寸变化自动跟随锚点
 * - flip / shift middleware：视口边缘自动翻转与收缩
 * - Portal 到 body + fixed strategy：脱离 overflow-hidden 容器裁剪
 * - isPositioned 守门：定位完成前不画（防 0,0 帧）
 */
import { type ReactNode, type RefCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  autoUpdate,
  flip,
  offset,
  shift,
  useFloating,
  type Placement,
  type UseFloatingReturn,
} from '@floating-ui/react';

/** dropdown 定位 hook（默认 top-end：向上弹、右缘对齐）。 */
export function useDropdownPosition<T extends HTMLElement>(
  placement: Placement = 'top-end',
): UseFloatingReturn<T> {
  return useFloating<T>({
    placement,
    strategy: 'fixed',
    middleware: [offset(4), flip(), shift({ padding: 4 })],
    whileElementsMounted: autoUpdate,
  });
}

/** 锚定浮层面板：定位由 pos.floatingStyles 驱动，形态（宽/背景/滚动）经 className 传入。 */
export function FloatingPanel({
  pos,
  className,
  floatingRef,
  children,
}: {
  pos: UseFloatingReturn<HTMLElement>;
  className?: string;
  /** 浮层 DOM 引用（调用方外点收起判断用）。 */
  floatingRef?: RefCallback<HTMLDivElement>;
  children: ReactNode;
}) {
  return createPortal(
    <div
      ref={(el) => {
        pos.refs.setFloating(el);
        floatingRef?.(el);
      }}
      style={{
        ...pos.floatingStyles,
        visibility: pos.isPositioned ? 'visible' : 'hidden',
      }}
      className={`z-50 floating-fade-in ${className ?? ''}`}
    >
      {children}
    </div>,
    document.body,
  );
}
