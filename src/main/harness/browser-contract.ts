/**
 * 浏览器自动化契约（agent-design.md §4.4）—— 工具层依赖的接口，实现由 L3 注入。
 *
 * 实现基于视图自己的 webContents：操作走 CDP（webContents.debugger），
 * 提取走注入求值；工具层只依赖本契约，换实现不动侧车。
 */
export interface BrowserSnapshot {
  viewId: string;
  url: string;
  title: string;
  /** Readability 概述（列表与检索摘要用）。 */
  excerpt: string;
  /** 正文的 Markdown 投影（供侧车上下文与快照落盘）。 */
  markdown: string;
  /** 可访问性结构：role · name · selector，供自动化定位与结构核对。 */
  a11y: string[];
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
