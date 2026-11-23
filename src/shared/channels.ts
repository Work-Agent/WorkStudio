/**
 * IPC 通道名单一事实源。
 *
 * 所有模块一律 import 本文件，不得内联通道字符串。
 */

// ─── 推送（send） ─────────────────────────────────────────

/** 视图总线（主进程 ↔ 渲染层 ↔ 视图页）。 */
export const CH_BUS = 'ws:bus';
/** URA 变更事件（页面订阅的资源变更推送）。 */
export const CH_URA = 'ws:ura';
/** URA 订阅入口（invoke：传 ref 订阅、传空取消）。 */
export const CH_URA_WATCH = 'ws:ura:watch';
/** 捕获层指针事件（preload → 主进程；不对外暴露）。 */
export const CH_CAPTURE = 'ws:capture';
/** 网页自动化操作（主进程 ⇄ 网页 preload；请求与回执同一通道）。 */
export const CH_WEB = 'ws:web';
