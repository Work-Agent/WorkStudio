/**
 * 官方内置扩展（PI Extension 兼容层，参考 percho packages/backend/src/project/builtin-extensions.ts）。
 *
 * 元数据照抄 pi CLI：`builtin: true`（错误信息按 builtin:<name> 归因）；
 * `replaceable: true`（用户装了同名第三方扩展时加载期自动让位）。
 *
 * 装载顺序即语义：我们的 harness 在前，官方内置在后——
 * 同组内先注册者赢（同名工具我们优先），且我们不标 replaceable 时官方替换不生效。
 */
import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import {
  createCodemodeExtension,
  createMcpExtension,
  createToolSearchExtension,
} from '@earendil-works/pi-coding-agent';

export function builtinPiExtensions(deps: {
  /** 授权页打开方式：宿主接到应用内标签页（缺省回落平台浏览器）。 */
  openUrl?: (url: string) => void | Promise<void>;
}): InlineExtension[] {
  return [
    {
      name: 'codemode',
      factory: createCodemodeExtension(),
      builtin: true,
      replaceable: true,
    },
    {
      name: 'tool-search',
      factory: createToolSearchExtension(),
      builtin: true,
      replaceable: true,
    },
    {
      name: 'mcp',
      factory: createMcpExtension({ openUrl: deps.openUrl }),
      builtin: true,
      replaceable: true,
    },
  ];
}

/** 组合扩展工厂：我们的业务扩展在前，官方内置在后。 */
export function composeExtensionFactories(
  ours: InlineExtension[],
  deps: { openUrl?: (url: string) => void | Promise<void> },
): InlineExtension[] {
  return [...ours, ...builtinPiExtensions(deps)];
}
