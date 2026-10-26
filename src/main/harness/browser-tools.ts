/**
 * 浏览器工具面（architecture.md §5.4）—— browser_* 工具，经契约调用 L3 实现。
 */
import { Type } from 'typebox';
import {
  defineTool,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import type {
  BrowserAutomationContract,
  BrowserSnapshot,
} from './browser-contract';

export interface BrowserToolOptions {
  /** 白名单域归档（返回快照资源 id；名单外/失败返回 null）。 */
  capture?: (page: BrowserSnapshot) => Promise<{ ref: string } | null>;
}

export function createBrowserTools(
  automation: BrowserAutomationContract,
  options: BrowserToolOptions = {},
): ToolDefinition[] {
  const openParams = Type.Object({
    url: Type.String({
      description:
        'Absolute http(s) URL to open in the workspace browser panel.',
    }),
  });
  const openTool = defineTool<typeof openParams, unknown>({
    name: 'browser_open',
    label: '打开网页',
    description:
      'Open a URL in the browser panel (new tab when the URL is not already open) and return the page state.',
    parameters: openParams,
    execute: async (_id, { url }) => {
      const { viewId, url: finalUrl } = await automation.open(url);
      const page = await automation.read(viewId);
      const archived = options.capture
        ? await automation
            .snapshot(viewId)
            .then((snapshot) => options.capture!(snapshot))
            .catch(() => null)
        : null;
      return {
        content: [
          {
            type: 'text' as const,
            text:
              `opened: ${finalUrl}\ntitle: ${page.title}` +
              (archived ? `\narchived: ${archived.ref}` : '') +
              `\n\n${page.text.slice(0, 4000)}`,
          },
        ],
        details: {
          viewId,
          url: finalUrl,
          title: page.title,
          ...(archived ? { archived: archived.ref } : {}),
        },
      };
    },
  });

  const readParams = Type.Object({
    viewId: Type.Optional(
      Type.String({
        description: 'Raw view id; omit to use the active browser tab.',
      }),
    ),
  });
  const readTool = defineTool<typeof readParams, unknown>({
    name: 'browser_read',
    label: '读取网页',
    description:
      'Read the visible text, title and URL of the browser panel page.',
    parameters: readParams,
    execute: async (_id, { viewId }) => {
      const page = await automation.read(viewId);
      return {
        content: [
          {
            type: 'text' as const,
            text: `url: ${page.url}\ntitle: ${page.title}\n\n${page.text.slice(0, 8000)}`,
          },
        ],
        details: page,
      };
    },
  });

  const clickParams = Type.Object({
    selector: Type.String({
      description: 'CSS selector of the element to click.',
    }),
    viewId: Type.Optional(
      Type.String({
        description: 'Raw view id; omit for the active browser tab.',
      }),
    ),
  });
  const clickTool = defineTool<typeof clickParams, unknown>({
    name: 'browser_click',
    label: '点击网页元素',
    description: 'Click an element in the browser panel by CSS selector.',
    parameters: clickParams,
    execute: async (_id, { selector, viewId }) => {
      const result = await automation.click(selector, viewId);
      return {
        content: [
          {
            type: 'text' as const,
            text: result.ok
              ? `clicked: ${selector}`
              : `click failed: ${result.note ?? selector}`,
          },
        ],
        details: result,
      };
    },
  });

  const typeParams = Type.Object({
    selector: Type.String({
      description: 'CSS selector of the input/textarea to fill.',
    }),
    text: Type.String({
      description: 'Text to set (fires input + change events).',
    }),
    viewId: Type.Optional(
      Type.String({
        description: 'Raw view id; omit for the active browser tab.',
      }),
    ),
  });
  const typeTool = defineTool<typeof typeParams, unknown>({
    name: 'browser_type',
    label: '填写网页表单',
    description:
      'Set the value of an input/textarea in the browser panel and dispatch input/change events.',
    parameters: typeParams,
    execute: async (_id, { selector, text, viewId }) => {
      const result = await automation.type(selector, text, viewId);
      return {
        content: [
          {
            type: 'text' as const,
            text: result.ok
              ? `filled: ${selector}`
              : `fill failed: ${result.note ?? selector}`,
          },
        ],
        details: result,
      };
    },
  });

  const backParams = Type.Object({
    viewId: Type.Optional(
      Type.String({
        description: 'Raw view id; omit for the active browser tab.',
      }),
    ),
  });
  const backTool = defineTool<typeof backParams, unknown>({
    name: 'browser_back',
    label: '网页后退',
    description: 'Navigate the browser panel back in history.',
    parameters: backParams,
    execute: async (_id, { viewId }) => {
      await automation.back(viewId);
      return {
        content: [{ type: 'text' as const, text: 'navigated back' }],
        details: {},
      };
    },
  });

  const shotParams = Type.Object({
    viewId: Type.Optional(
      Type.String({
        description: 'Raw view id; omit for the active browser tab.',
      }),
    ),
  });
  const shotTool = defineTool<typeof shotParams, unknown>({
    name: 'browser_screenshot',
    label: '网页截图',
    description:
      'Capture a PNG screenshot of the browser panel page; returns the saved file path.',
    parameters: shotParams,
    execute: async (_id, { viewId }) => {
      const file = await automation.screenshot(viewId);
      return {
        content: [{ type: 'text' as const, text: `screenshot saved: ${file}` }],
        details: { file },
      };
    },
  });

  const snapshotParams = Type.Object({
    viewId: Type.Optional(
      Type.String({
        description: 'Raw view id; omit to use the active browser tab.',
      }),
    ),
  });
  const snapshotTool = defineTool<typeof snapshotParams, unknown>({
    name: 'browser_snapshot',
    label: '页面快照',
    description:
      'Extract the page as Markdown and archive it when the domain is on the allowlist. Returns the archived resource id.',
    parameters: snapshotParams,
    execute: async (_id, { viewId }) => {
      const snapshot = await automation.snapshot(viewId);
      const archived = options.capture
        ? await options.capture(snapshot).catch(() => null)
        : null;
      return {
        content: [
          {
            type: 'text' as const,
            text:
              `url: ${snapshot.url}\ntitle: ${snapshot.title}` +
              (archived ? `\narchived: ${archived.ref}` : '\narchived: (not on allowlist)') +
              `\n\n${snapshot.markdown.slice(0, 8000)}`,
          },
        ],
        details: {
          url: snapshot.url,
          title: snapshot.title,
          ...(archived ? { archived: archived.ref } : {}),
        },
      };
    },
  });

  return [openTool, readTool, snapshotTool, clickTool, typeTool, backTool, shotTool];
}
