/**
 * 命令与订阅的来源鉴权。
 *
 * 系统视图与 service 保持既有能力；插件视图只能调用自己的命令，
 * 以及宿主明确开放的基础能力（另存为、外链、打开资源页）。
 * 助手只能看到明确暴露的命令；插件命令默认对助手关闭。
 */

import type { Origin } from '../contract.ts';
import type { CommandEntry } from './command.ts';

const NATIVE_ALLOW = new Set(['saveFile', 'openExternal']);

function pluginIdOf(origin: Origin): string | null {
  return origin.type === 'view' && origin.pluginId ? origin.pluginId : null;
}

export function commandDenialOf(
  origin: Origin,
  entry: CommandEntry,
): string | null {
  if (origin.type === 'tool') {
    return entry.agentExposed === false
      ? `命令未向助手开放：${entry.address.domain}/${entry.address.resource}/${entry.action}`
      : null;
  }
  const pluginId = pluginIdOf(origin);
  if (!pluginId || origin.type !== 'view') return null;
  if (entry.address.domain === pluginId) return null;
  if (
    entry.address.domain === 'shell' &&
    entry.address.resource === 'native' &&
    NATIVE_ALLOW.has(entry.action)
  ) {
    return null;
  }
  // OAuth 回调页需要把 accessToken 交回 provider 资源；只开放这两个命令。
  if (
    entry.address.domain === 'agent' &&
    entry.address.resource.startsWith('provider/') &&
    (entry.action === 'beginOAuth' || entry.action === 'completeLogin')
  ) {
    return null;
  }
  if (
    origin.workspaceId &&
    entry.action === 'action' &&
    entry.address.domain === 'workspace' &&
    entry.address.resource === `${origin.workspaceId}/resources`
  ) {
    return null;
  }
  return `插件视图无权调用命令：${entry.address.domain}/${entry.address.resource}/${entry.action}`;
}

export function subscriptionDenialOf(
  origin: Origin,
  address: string,
): string | null {
  const pluginId = pluginIdOf(origin);
  if (!pluginId) return null;
  if (address.startsWith(`${pluginId}/`)) return null;
  if (address === 'shell/appearance') return null;
  if (address === 'agent/providers' || address.startsWith('agent/provider/')) {
    return null;
  }
  return `插件视图无权订阅：${address}`;
}
