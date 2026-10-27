/**
 * IPC 通道名单一事实源（README.md §6.2）。
 *
 * 所有模块一律 import 本文件，不得内联通道字符串。
 */

// ─── App 作用域通道（architecture.md §2） ─────────────────

/** AppSnapshot 握手：返回 app / workspaces / workspace / ui / session。 */
export const APP_SYNC = 'app:sync';
/** 统一命令通道：AppCommand（scope + action + payload）。 */
export const APP_CMD = 'app:cmd';
/** AppSnapshot 推送。 */
export const APP_SNAPSHOT = 'app:snapshot';
/** AppEvent 推送（scope + epoch + seq）。 */
export const APP_EVENT = 'app:event';

// ─── 命令 / 握手（invoke） ────────────────────────────────

/** 插件页数据面（app:* 白名单命令；与 ws:cmd 共用命令目录）。 */
export const CH_EXT = 'ws:ext';
/** 原生能力：openPath / openExternal / 目录选择 / Menu.popup。 */
export const CH_SHELL = 'ws:shell';

// ─── 推送（send） ─────────────────────────────────────────

/** 视图总线（主进程 ↔ 渲染层 ↔ 视图页）。 */
export const CH_BUS = 'ws:bus';
/** 资源变更（资源网关 onChange / 每轮结束收敛；工作台投影刷新）。 */
export const CH_RESOURCES = 'ws:resources';
/** URA 变更事件（页面订阅的资源变更推送）。 */
export const CH_URA = 'ws:ura';
/** URA 订阅入口（invoke：传 ref 订阅、传空取消）。 */
export const CH_URA_WATCH = 'ws:ura:watch';
/** 扩展 UI 请求（对话框 / 通知 / 状态）。 */
export const CH_UI = 'ws:ui';
/** 交互预览（主进程 → 渲染层）。 */
export const CH_INTERACTION_UPDATE = 'ws:interaction:update';

// ─── 交互（invoke / 预载直连） ────────────────────────────

/** 指针交互会话：begin / end。 */
export const CH_INTERACTION = 'ws:interaction';
/** 捕获层指针事件（preload → 主进程；不对外暴露）。 */
export const CH_CAPTURE = 'ws:capture';
/** Menu.popup 选中回执（主进程 → 发起窗口）。 */
export const CH_POPUP_SELECT = 'ws:popup:select';
