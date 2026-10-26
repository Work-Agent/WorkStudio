/**
 * IPC 通道名单一事实源（README.md §6.2）。
 *
 * 所有模块一律 import 本文件，不得内联通道字符串。
 */

// ─── 命令 / 握手（invoke） ────────────────────────────────

/** 唯一命令通道：域 × 命令，结构化信封。 */
export const CH_CMD = 'ws:cmd';
/** 启动 / 重连握手：Agent 快照 + seq + Shell 快照 + 视图清单。 */
export const CH_SYNC = 'ws:sync';
/** 插件页数据面（app:* 白名单命令；与 ws:cmd 共用命令目录）。 */
export const CH_EXT = 'ws:ext';
/** 原生能力：openPath / openExternal / 目录选择 / Menu.popup。 */
export const CH_SHELL = 'ws:shell';

// ─── 推送（send） ─────────────────────────────────────────

/** Agent 事件帧（{ seq, event }）。 */
export const CH_EVENT = 'ws:event';
/** Shell 快照（UiState + 布局 + 交互预览）。 */
export const CH_STATE = 'ws:state';
/** 视图事实变化（集合快照 / 单视图状态 patch）。 */
export const CH_VIEW = 'ws:view';
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

// ─── 兼容通道（旧渲染层过渡期） ────────────────────────────

/** 旧渲染层 shell 能力（过渡期保留；新代码走 CH_SHELL）。 */
export const CH_LEGACY_SHELL_OPEN_PATH = 'shell:openPath';
