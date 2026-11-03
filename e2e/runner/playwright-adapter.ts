import { expect, type ElectronApplication, type Page } from '@playwright/test';
import type { E2ECase, E2EContext, PageHandle } from './contract.ts';

const HTML_TAGS = new Set([
  'a',
  'article',
  'aside',
  'body',
  'button',
  'div',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'header',
  'img',
  'input',
  'label',
  'li',
  'main',
  'nav',
  'p',
  'section',
  'span',
  'textarea',
  'ul',
]);

function locator(page: Page, selector: string) {
  // testid 用短名（doc-tabs / resource-url-bar），HTML 标签和属性选择器走 CSS。
  return HTML_TAGS.has(selector) || /[\s.#[:>]/.test(selector)
    ? page.locator(selector)
    : page.getByTestId(selector);
}

function pageHandle(page: Page): PageHandle {
  return {
    url: () => page.url(),
    evaluate: (fn) => page.evaluate(fn),
    text: async (selector) => locator(page, selector).first().innerText(),
    expect: {
      text: async (selector, expected) => {
        await expect(locator(page, selector).first()).toContainText(expected);
      },
      visible: async (selector) => {
        await expect(locator(page, selector).first()).toBeVisible();
      },
    },
  };
}

export function createPlaywrightContext(options: {
  shell: Page;
  app: ElectronApplication;
  screenshotPath?: string;
}): E2EContext {
  const { shell, app } = options;
  const screenshotPath =
    options.screenshotPath ?? '/tmp/work-studio-e2e-failure.png';

  const bridge = {
    call: async <T>(path: string, input?: unknown): Promise<T> => {
      const result = await shell.evaluate(
        ({ path, input }) => window.appBridge!.call<T>(path, input),
        { path, input },
      );
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    },
    peek: <T>(path: string): Promise<T | null> =>
      shell.evaluate((path) => window.appBridge!.peek<T>(path), path),
  };

  const context: E2EContext = {
    page: pageHandle(shell),
    clickTestId: (testId) => shell.getByTestId(testId).click(),
    clickText: async (text, options) => {
      await shell
        .getByText(text, { exact: options?.exact ?? true })
        .last()
        .click();
    },
    clickTitle: (title) =>
      shell.getByTestId('doc-tabs').getByTitle(title).click(),
    fillTestId: (testId, value) => shell.getByTestId(testId).fill(value),
    press: (key) => shell.keyboard.press(key),
    evaluate: (fn) => shell.evaluate(fn),
    appBridge: bridge,
    expect: {
      poll: async (check, message) => {
        const deadline = Date.now() + 10_000;
        let lastError: unknown;
        while (Date.now() < deadline) {
          try {
            if (await check()) return;
          } catch (error) {
            lastError = error;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error(
          `${message ?? 'poll 超时'}${
            lastError instanceof Error ? `：${lastError.message}` : ''
          }`,
        );
      },
      text: async (selector, expected) => {
        await expect(locator(shell, selector).first()).toContainText(expected);
      },
      visible: async (selector) => {
        await expect(locator(shell, selector).first()).toBeVisible();
      },
      attribute: async (testId, name, value) => {
        await expect(shell.getByTestId(testId)).toHaveAttribute(name, value);
      },
    },
    waitForPage: async (pattern, options) => {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        for (const page of app.windows()) {
          if (!pattern.test(page.url())) continue;
          if (options?.text) {
            const body = await page
              .locator('body')
              .innerText()
              .catch(() => '');
            if (!body.includes(options.text)) continue;
          }
          return pageHandle(page);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(`等待页面超时：${pattern}`);
    },
    windowUrls: async () => app.windows().map((page) => page.url()),
    currentWorkspacePath: async () => {
      const workspace = await bridge.peek<{ path: string }>(
        '/workspaces/current',
      );
      return workspace?.path ?? null;
    },
    text: async (selector) => locator(shell, selector).first().innerText(),
    screenshot: async (path) => {
      const target = path ?? screenshotPath;
      await shell.screenshot({ path: target });
      return target;
    },
  };

  return context;
}

export async function runPlaywrightCase(
  testCase: E2ECase,
  options: {
    shell: Page;
    app: ElectronApplication;
  },
): Promise<void> {
  await testCase.run(createPlaywrightContext(options));
}
