/**
 * CDP 版 E2EContext：在常驻 dev 窗口里执行共享用例。
 *
 * 与 Playwright 的差别只藏在动作实现里：
 * - 点击走真实 Input.dispatchMouseEvent，不只调用 element.click()
 * - 等待用轮询，不引入 Playwright
 * - 截图走 Page.captureScreenshot
 */
import {
  CdpSession,
  CDP_ENDPOINT,
  listCdpTargets,
  type CdpTarget,
} from './cdp.ts';
import type { E2EContext, PageHandle } from './contract.ts';
import { installWorkStudioBridgeShim } from '../support/work-studio-shim.ts';

interface Point {
  x: number;
  y: number;
}

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

function testIdSelector(testId: string): string {
  return `[data-testid="${testId.replaceAll('"', '\\"')}"]`;
}

function resolveSelector(selector: string): string {
  return HTML_TAGS.has(selector) || /[\s.#[:>]/.test(selector)
    ? selector
    : testIdSelector(selector);
}

function pointExpression(rawSelector: string): string {
  const selector = resolveSelector(rawSelector);
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') return null;
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`;
}

function textExpression(rawSelector: string): string {
  const selector = resolveSelector(rawSelector);
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    return el ? el.innerText : null;
  })()`;
}

function clickTextExpression(text: string, exact: boolean): string {
  return `(() => {
    const text = ${JSON.stringify(text)};
    const exact = ${exact ? 'true' : 'false'};
    const depth = (el) => {
      let value = 0;
      for (let node = el; node; node = node.parentElement) value += 1;
      return value;
    };
    const candidates = [...document.querySelectorAll('body *')].filter((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') return false;
      const content = (el.textContent || '').trim();
      return exact ? content === text : content.includes(text);
    });
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => {
      const depthDiff = depth(b) - depth(a);
      return depthDiff !== 0
        ? depthDiff
        : (a.textContent || '').length - (b.textContent || '').length;
    });
    const el = candidates[0];
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`;
}

function queryExpression(
  selector: string,
  expression: (element: string) => string,
): string {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    ${expression('el')}
  })()`;
}

const KEY_CODES: Record<string, { code: string; keyCode: number }> = {
  Enter: { code: 'Enter', keyCode: 13 },
  Escape: { code: 'Escape', keyCode: 27 },
  Tab: { code: 'Tab', keyCode: 9 },
  Backspace: { code: 'Backspace', keyCode: 8 },
  Delete: { code: 'Delete', keyCode: 46 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  Space: { code: 'Space', keyCode: 32 },
};

function keyDescription(part: string): {
  key: string;
  code: string;
  keyCode: number;
} {
  if (KEY_CODES[part]) return { key: part, ...KEY_CODES[part] };
  if (/^[a-zA-Z]$/.test(part)) {
    const upper = part.toUpperCase();
    return { key: part, code: `Key${upper}`, keyCode: upper.charCodeAt(0) };
  }
  if (/^[0-9]$/.test(part)) {
    return { key: part, code: `Digit${part}`, keyCode: part.charCodeAt(0) };
  }
  return { key: part, code: part, keyCode: 0 };
}

async function dispatchClick(session: CdpSession, point: Point): Promise<void> {
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: point.x,
    y: point.y,
  });
  await session.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
}

async function clickPoint(session: CdpSession, point: Point): Promise<void> {
  try {
    await dispatchClick(session, point);
  } catch {
    // 视图刚打开/关闭时壳层可能短暂忙；等一拍重试一次，避免 HMR 抖动。
    await new Promise((resolve) => setTimeout(resolve, 250));
    await dispatchClick(session, point);
  }
}

function pageHandle(session: CdpSession): PageHandle {
  const text = async (selector: string): Promise<string> => {
    const value = await session.evaluate<string | null>(
      textExpression(selector),
    );
    if (value == null) throw new Error(`元素不存在：${selector}`);
    return value;
  };
  return {
    url: () => session.target.url,
    evaluate: (fn, arg) => session.evaluateFunction(fn, arg),
    text,
    expect: {
      text: async (selector, expected) => {
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
          const value = await text(selector).catch(() => null);
          if (value?.includes(expected)) return;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error(`页面文本未包含「${expected}」：${selector}`);
      },
      visible: async (selector) => {
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
          const value = await session
            .evaluate<Point | null>(pointExpression(selector))
            .catch(() => null);
          if (value) return;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error(`元素不可见：${selector}`);
      },
    },
  };
}

export async function createCdpContext(
  shell: CdpSession,
  options: {
    endpoint?: string;
    screenshotPath?: string;
  } = {},
): Promise<E2EContext> {
  const endpoint = options.endpoint ?? CDP_ENDPOINT;
  const screenshotPath =
    options.screenshotPath ?? '/tmp/work-studio-dev-test-failure.png';
  await shell.evaluateFunction(installWorkStudioBridgeShim);

  const clickSelector = async (selector: string): Promise<void> => {
    const point = await shell.evaluate<Point | null>(pointExpression(selector));
    if (!point) throw new Error(`元素不可点击：${selector}`);
    await clickPoint(shell, point);
  };

  const pageSessions: CdpSession[] = [];
  const openPage = async (target: CdpTarget): Promise<CdpSession> => {
    const page = await CdpSession.connect(target);
    pageSessions.push(page);
    return page;
  };

  const context: E2EContext = {
    page: pageHandle(shell),
    clickTestId: (testId) => clickSelector(testIdSelector(testId)),
    clickText: async (text, options) => {
      const point = await shell.evaluate<Point | null>(
        clickTextExpression(text, options?.exact ?? true),
      );
      if (!point) throw new Error(`找不到文本：${text}`);
      await clickPoint(shell, point);
    },
    clickTitle: (title) =>
      clickSelector(
        `[data-testid="doc-tabs"] [title="${title.replaceAll('"', '\\"')}"]`,
      ),
    fillTestId: async (testId, value) => {
      const selector = testIdSelector(testId);
      await shell.evaluate(
        `(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return false;
          el.focus();
          const proto = el instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          setter?.call(el, ${JSON.stringify(value)});
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        })()`,
      );
    },
    press: async (key) => {
      const parts = key.split('+');
      const keyPart = parts.pop() ?? '';
      const modifiers =
        (parts.includes('Alt') ? 1 : 0) |
        (parts.includes('Control') || parts.includes('Ctrl') ? 2 : 0) |
        (parts.includes('Meta') || parts.includes('Command') ? 4 : 0) |
        (parts.includes('Shift') ? 8 : 0);
      const description = keyDescription(keyPart);
      await shell.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        modifiers,
        key: description.key,
        code: description.code,
        windowsVirtualKeyCode: description.keyCode,
        nativeVirtualKeyCode: description.keyCode,
      });
      await shell.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        modifiers,
        key: description.key,
        code: description.code,
        windowsVirtualKeyCode: description.keyCode,
        nativeVirtualKeyCode: description.keyCode,
      });
    },
    evaluate: (fn, arg) => shell.evaluateFunction(fn, arg),
    legacyBridge: {
      call: async <T>(path: string, input?: unknown): Promise<T> => {
        const result = await shell.evaluate<
          { ok: true; data: T } | { ok: false; error: { message: string } }
        >(
          `window.__e2eBridge.call(${JSON.stringify(path)}, ${JSON.stringify(
            input ?? null,
          )})`,
        );
        if (!result.ok) throw new Error(result.error.message);
        return result.data;
      },
      peek: <T>(path: string): Promise<T | null> =>
        shell.evaluate<T | null>(
          `window.__e2eBridge.peek(${JSON.stringify(path)})`,
        ),
    },
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
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
          const value = await shell
            .evaluate<string | null>(textExpression(selector))
            .catch(() => null);
          if (value?.includes(expected)) return;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error(`壳层文本未包含「${expected}」：${selector}`);
      },
      visible: async (selector) => {
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
          const point = await shell
            .evaluate<Point | null>(pointExpression(selector))
            .catch(() => null);
          if (point) return;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error(`壳层元素不可见：${selector}`);
      },
      attribute: async (testId, name, value) => {
        const selector = testIdSelector(testId);
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
          const actual = await shell
            .evaluate<string | null>(
              queryExpression(
                selector,
                (el) => `return ${el}.getAttribute(${JSON.stringify(name)});`,
              ),
            )
            .catch(() => null);
          if (actual === value) return;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error(`属性不匹配：${testId}[${name}] 期望 ${value}`);
      },
    },
    waitForPage: async (pattern, options) => {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const targets = (await listCdpTargets(endpoint).catch(() => []))
          .filter(
            (target) => target.type === 'page' && target.webSocketDebuggerUrl,
          )
          .filter((target) =>
            pattern.test(`${target.title ?? ''} ${target.url}`),
          );
        for (const target of targets) {
          const page = await openPage(target);
          if (!options?.text) return pageHandle(page);
          const body = await pageHandle(page)
            .text('body')
            .catch(() => '');
          if (body.includes(options.text)) return pageHandle(page);
          page.close();
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(`等待页面超时：${pattern}`);
    },
    windowUrls: async () => {
      const targets = await listCdpTargets(endpoint);
      return targets
        .filter((target) => target.type === 'page')
        .map((target) => target.url);
    },
    currentWorkspacePath: async () => {
      const workspace = await shell.evaluate<{ path: string } | null>(
        `window.__e2eBridge.peek('/workspaces/current')`,
      );
      return workspace?.path ?? null;
    },
    text: async (selector) => {
      const value = await shell.evaluate<string | null>(
        textExpression(selector),
      );
      if (value == null) throw new Error(`元素不存在：${selector}`);
      return value;
    },
    screenshot: async (path) => shell.screenshot(path ?? screenshotPath),
    dispose: () => {
      for (const page of pageSessions) page.close();
      pageSessions.length = 0;
    },
  };

  return context;
}
