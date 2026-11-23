/**
 * 网页视图契约（shared）—— 主进程与网页 preload 之间的操作形状。
 *
 * 自动化不再向页面注入脚本字符串：主进程下发结构化操作，
 * 网页 preload 在页面上下文执行并回传结果。
 */

/** 主进程下发的自动化操作。 */
export type WebOp =
  | { kind: 'text' }
  | { kind: 'outline' }
  | { kind: 'query'; selector: string }
  | { kind: 'click'; selector: string }
  | { kind: 'type'; selector: string; text: string }
  | { kind: 'scroll'; y: number };

/** 页面读取结果。 */
export interface PageReading {
  url: string;
  title: string;
  text: string;
}

/** 页面提取结果：正文 Markdown + 可访问性结构。 */
export interface PageExtraction {
  url: string;
  title: string;
  excerpt: string;
  markdown: string;
  a11y: string[];
}

/** 元素查询结果。 */
export interface ElementReading {
  found: boolean;
  text?: string;
  attrs?: Record<string, string>;
}

/** 网页 preload 的操作结果。 */
export interface WebOpResult {
  text?: PageReading;
  outline?: PageExtraction;
  element?: ElementReading;
  ok?: boolean;
}

/** 操作请求与回执（同一通道）。 */
export interface WebOpRequest {
  id: number;
  op: WebOp;
}

export interface WebOpReply {
  id: number;
  result?: WebOpResult;
  error?: string;
}
