/**
 * 共享 E2E 契约。
 *
 * 用例只依赖这个接口，不依赖 Playwright 或 CDP。
 * Playwright 负责提交前 / CI 的隔离回归；dev extension 负责常驻 dev 窗口的开发时回归。
 */

export type CaseTag = 'dev' | 'ci' | 'mutating' | 'playwright-only';

export interface E2ECase {
  /** 稳定标识，供 dev_test({ case }) 使用。 */
  id: string;
  title: string;
  tags?: readonly CaseTag[];
  run(ctx: E2EContext): Promise<void>;
}

export interface PageExpect {
  text(selector: string, expected: string): Promise<void>;
  visible(selector: string): Promise<void>;
}

/** 由设置页 / 资源页等独立 BrowserWindow 承载的页面。 */
export interface PageHandle {
  url(): string;
  evaluate<T>(fn: () => T | Promise<T>): Promise<T>;
  text(selector: string): Promise<string>;
  expect: PageExpect;
}

export interface E2EExpect extends PageExpect {
  /** 重复求值直到返回 true。 */
  poll(
    check: () => boolean | Promise<boolean>,
    message?: string,
  ): Promise<void>;
  attribute(testId: string, name: string, value: string): Promise<void>;
}

export interface E2EContext {
  /** 壳层页面。 */
  page: PageHandle;
  clickTestId(testId: string): Promise<void>;
  clickText(text: string, options?: { exact?: boolean }): Promise<void>;
  clickTitle(title: string): Promise<void>;
  fillTestId(testId: string, value: string): Promise<void>;
  press(key: string): Promise<void>;

  evaluate<T>(fn: () => T | Promise<T>): Promise<T>;
  appBridge: {
    call<T = unknown>(path: string, input?: unknown): Promise<T>;
    peek<T = unknown>(path: string): Promise<T | null>;
  };
  expect: E2EExpect;

  waitForPage(
    pattern: RegExp,
    options?: { text?: string },
  ): Promise<PageHandle>;
  /** 当前 Electron 中所有页面 URL（含壳层、设置页、助手等）。 */
  windowUrls(): Promise<string[]>;
  currentWorkspacePath(): Promise<string | null>;
  text(selector: string): Promise<string>;
  screenshot(path?: string): Promise<string>;
  /** 关闭用例打开的临时页面连接（CDP adapter 使用）。 */
  dispose?(): void;
}

export function defineCase(testCase: E2ECase): E2ECase {
  return testCase;
}
