/**
 * 布局常量单一事实源（views-design.md §四）。
 *
 * 主进程的布局引擎据此计算全部原生视图 bounds；工作台渲染层的 DOM 条带
 * （TitleBar / Sidebar / TabsBar）消费同一份常量，保证 DOM 与原生视图对齐。
 */

/** TitleBar 高度（与 WCO 覆盖层高度同源；titlebar.ts 复用）。 */
export const TITLEBAR_HEIGHT = 40;

/** 分隔条让位：原生视图在 DOM 之上，必须给 DOM 把手留出可命中空间（把手 11px，取半+1）。 */
export const SPLITTER_GAP = 6;

/** 资源面板 TabsBar 高度（DOM 条带；内容视图从它下方开始）。 */
export const TABBAR_HEIGHT = 36;

/** 左栏收起（图标列）固定宽度。 */
export const LEFT_COLLAPSED_PX = 56;

/** 拖拽左栏到该宽度以下松手 → 自动收起。 */
export const COLLAPSE_THRESHOLD_PX = 140;

/** 左栏展开默认宽度。 */
export const DEFAULT_LEFT_PX = 240;

/** 右停靠默认宽度。 */
export const DEFAULT_RIGHT_PX = 420;

/** 栏宽夹取比例（相对窗口宽）。 */
export const LEFT_MIN_RATIO = 0.15;
export const LEFT_MAX_RATIO = 0.3;
export const RIGHT_MIN_RATIO = 0.25;
export const RIGHT_MAX_RATIO = 0.5;

/** 左栏拖拽下限（允许拖入收起阈值区）。 */
export const LEFT_MIN_DRAG_PX = 48;

/** 浮动助手：最小尺寸与距资源面板边距。 */
export const ASSISTANT_MIN_W = 340;
export const ASSISTANT_MIN_H = 380;
export const ASSISTANT_DEFAULT_W = 460;
export const ASSISTANT_DEFAULT_H = 680;
export const ASSISTANT_MARGIN = 16;
