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
      description: 'List structure entries for a resource ref.',
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
      description: 'Find structure entries by name/pattern.',
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
      description: 'Read content items for a resource ref.',
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
      description: 'Search content entries by query.',
      parameters: Type.Object({
        ref: Type.String(),
        query: Type.String(),
      }),
      execute: async (_id, input) =>
        text(await tools.grep(input.ref, input.query)),
    }),
    defineTool({
      name: 'open',
      label: '打开定位',
      description: 'Open a resource at a locator returned by grep.',
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
        'Run a workspace command: ws <domain> <action> <ref> [--arg value].',
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
      name: 'command',
      label: '执行命令',
      description:
        'Invoke a command-table entry by domain, action and structured input.',
      parameters: Type.Object({
        domain: Type.String(),
        action: Type.String(),
        resource: Type.Optional(Type.String()),
        input: Type.Optional(Type.Any()),
      }),
      execute: async (_id, input) => {
        const result = await tools.command(
          input.domain,
          input.action,
          isRecord(input.input) ? input.input : {},
          input.resource,
        );
        return text(result.stdout, {
          exitCode: result.exitCode,
          ...(result.data === undefined ? {} : { data: result.data }),
        });
      },
    }),
    defineTool({
      name: 'command_list',
      label: '命令目录',
      description: 'List command-table entries with domain, action and args.',
      parameters: Type.Object({}),
      execute: async () => text(tools.commandList()),
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
