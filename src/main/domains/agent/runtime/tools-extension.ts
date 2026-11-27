/**
 * pi 工具注册：ls / find / read / grep / bash + browser_*。
 *
 * 工具只调用 ToolSurface / BrowserCapability；写与改仍只经命令表。
 */

import { Type } from 'typebox';
import {
  defineTool,
  type InlineExtension,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import type { ToolSurface } from '../tools.ts';
import type { BrowserCapability } from '../../browser/capability.ts';

export function createAgentToolsExtension(
  tools: ToolSurface,
  browser: BrowserCapability,
): InlineExtension {
  const definitions: ToolDefinition[] = [
    defineTool({
      name: 'ls',
      label: '列出结构',
      description:
        'List structure entries under a resource ref. Adapters that claim the ref run concurrently and the results are merged; this is not the OS ls.',
      parameters: Type.Object({
        ref: Type.String(),
        limit: Type.Optional(Type.Number()),
      }),
      execute: async (_id, input) =>
        text(await tools.ls(input.ref, { limit: input.limit })),
    }),
    defineTool({
      name: 'find',
      label: '查找结构',
      description:
        'Filter structure entries of a resource ref by name pattern. Same aggregation as ls; this is not the OS find.',
      parameters: Type.Object({
        ref: Type.String(),
        query: Type.String(),
      }),
      execute: async (_id, input) =>
        text(await tools.find(input.ref, input.query)),
    }),
    defineTool({
      name: 'read',
      label: '读取内容',
      description:
        'Read content entries for a resource ref; returns items with locators.',
      parameters: Type.Object({
        ref: Type.String(),
        offset: Type.Optional(Type.Number()),
        limit: Type.Optional(Type.Number()),
      }),
      execute: async (_id, input) =>
        text(
          await tools.read(input.ref, {
            offset: input.offset,
            limit: input.limit,
          }),
        ),
    }),
    defineTool({
      name: 'grep',
      label: '内容检索',
      description:
        'Search content entries within a scope; results carry locators.',
      parameters: Type.Object({
        ref: Type.String(),
        query: Type.String(),
      }),
      execute: async (_id, input) =>
        text(await tools.grep(input.ref, input.query)),
    }),
    defineTool({
      name: 'open',
      label: '打开资源',
      description:
        'Open a resource at a locator in the host UI. Same entry as clicking it in the sidebar, so the user sees exactly what you open.',
      parameters: Type.Object({
        ref: Type.String(),
        locator: Type.Optional(Type.String()),
      }),
      execute: async (_id, input) =>
        text(await tools.open(input.ref, input.locator)),
    }),
    defineTool({
      name: 'bash',
      label: '执行命令',
      description:
        'The write channel: run an engine command in line form ws <domain>/<resource> <action> <ref> [--arg value]. Not an OS shell; the skill for the document type names the command and its arguments.',
      parameters: Type.Object({
        argv: Type.Array(Type.String()),
      }),
      execute: async (_id, input) => {
        const result = await tools.bash(input.argv);
        return text(result.stdout, {
          exitCode: result.exitCode,
          ...(result.data === undefined ? {} : { data: result.data }),
        });
      },
    }),
    defineTool({
      name: 'browser_open',
      label: '打开网页',
      description: 'Open a URL in the browser panel.',
      parameters: Type.Object({ url: Type.String() }),
      execute: async (_id, input) => {
        const tab = await tools.browserOpen(input.url);
        return text(`opened: ${tab.url}`, tab);
      },
    }),
    defineTool({
      name: 'browser_click',
      label: '点击网页元素',
      description: 'Click a web element by CSS selector.',
      parameters: Type.Object({
        id: Type.String(),
        selector: Type.String(),
      }),
      execute: async (_id, input) => {
        await tools.browserClick(input.id, input.selector);
        return text(`clicked: ${input.selector}`);
      },
    }),
    defineTool({
      name: 'browser_type',
      label: '输入网页文本',
      description: 'Type text into a web element.',
      parameters: Type.Object({
        id: Type.String(),
        selector: Type.String(),
        text: Type.String(),
      }),
      execute: async (_id, input) => {
        await tools.browserType(input.id, input.selector, input.text);
        return text(`typed: ${input.selector}`);
      },
    }),
    defineTool({
      name: 'browser_screenshot',
      label: '网页截图',
      description: 'Capture the current browser view as PNG base64.',
      parameters: Type.Object({ id: Type.String() }),
      execute: async (_id, input) => {
        const bytes = await browser.screenshot(input.id);
        return text(
          `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`,
        );
      },
    }),
    defineTool({
      name: 'browser_snapshot',
      label: '采集网页',
      description: 'Capture URL/title/HTML for the web domain cache.',
      parameters: Type.Object({ id: Type.Optional(Type.String()) }),
      execute: async (_id, input) => {
        const page = await tools.browserSnapshot(input.id);
        return text(page.html.slice(0, 8000), page);
      },
    }),
  ];

  return (pi) => {
    for (const tool of definitions) pi.registerTool(tool);
  };
}

function text(value: unknown, details?: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text:
          typeof value === 'string' ? value : JSON.stringify(value, null, 2),
      },
    ],
    details: details ?? null,
  };
}
