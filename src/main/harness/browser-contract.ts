/**
 * 浏览器自动化契约（agent-design.md §3.5）—— 工具层依赖的接口，实现由 L3 注入。
 *
 * v1 实现基于 ViewHost 的 raw 网页视图（webContents DOM 操作 + capturePage）；
 * 未来可替换为 CDP / debugger 实现，工具层不动。
 */
export interface BrowserSnapshot {
  viewId: string
  url: string
  title: string
  /** 正文的 Markdown 投影（供 AI 上下文与快照落盘）。 */
  markdown: string
}

export interface BrowserPageState {
  viewId: string;
  url: string;
  title: string;
  text: string;
}

export interface BrowserAutomationContract {
  /** 打开 URL（无则新建 raw 视图并激活）；返回视图 id 与最终 URL。 */
  open(url: string): Promise<{ viewId: string; url: string }>;
  /** 读取页面（缺省 = 当前激活的 raw 视图）。 */
  read(viewId?: string): Promise<BrowserPageState>;
  /** 按 CSS 选择器点击。 */
  click(
    selector: string,
    viewId?: string,
  ): Promise<{ ok: boolean; note?: string }>;
  /** 按 CSS 选择器填入文本（触发 input/change 事件）。 */
  type(
    selector: string,
    text: string,
    viewId?: string,
  ): Promise<{ ok: boolean; note?: string }>;
  /** 后退。 */
  back(viewId?: string): Promise<void>;
  /** 截图（PNG 落临时目录），返回绝对路径。 */
  screenshot(viewId?: string): Promise<string>;
  /** 提取正文 Markdown（缺省 = 当前激活的 raw 视图）。 */
  snapshot(viewId?: string): Promise<BrowserSnapshot>;
  /** 当前激活 raw 视图 id（无则 null）。 */
  activeViewId(): string | null;
}
