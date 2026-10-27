/** 助手 slash 命令：内置 GUI 命令 + pi 扩展命令目录。 */
import { useEffect, useState } from 'react';
import type { ParsedMessage } from '../../shared/types';
import { bridge } from './bridge';

export interface CommandInfo {
  name: string;
  description?: string;
  source?: string;
}

export const BUILTIN_COMMANDS: CommandInfo[] = [
  { name: 'new', description: '新建会话' },
  { name: 'compact', description: '压缩会话上下文（可附指示）' },
  { name: 'model', description: '切换模型' },
  { name: 'thinking', description: '思考档位' },
  { name: 'name', description: '命名当前会话' },
  { name: 'session', description: '会话信息' },
  { name: 'copy', description: '复制上一条助手消息' },
];

export function useCommands(activePath: string | null): CommandInfo[] {
  const [catalog, setCatalog] = useState<CommandInfo[]>(BUILTIN_COMMANDS);
  useEffect(() => {
    void bridge?.cmd<CommandInfo[]>('session.getCommands').then((response) => {
      if (!response.ok) return;
      const seen = new Set(BUILTIN_COMMANDS.map((command) => command.name));
      const extension = (response.data ?? []).filter((command) => {
        if (seen.has(command.name)) return false;
        seen.add(command.name);
        return true;
      });
      setCatalog([...BUILTIN_COMMANDS, ...extension]);
    });
  }, [activePath]);
  return catalog;
}

export function matchCommands(
  catalog: CommandInfo[],
  fragment: string,
): CommandInfo[] {
  return catalog
    .filter((command) => command.name.startsWith(fragment))
    .slice(0, 8);
}

function lastAssistantText(messages: ParsedMessage[]): string | null {
  const last = [...messages]
    .reverse()
    .find((message) => message.role === 'assistant');
  if (!last) return null;
  return (
    last.blocks
      .filter(
        (block): block is { type: 'text'; text: string } =>
          block.type === 'text',
      )
      .map((block) => block.text)
      .join('\n') || null
  );
}

export interface CommandActions {
  activePath: string | null;
  messages: ParsedMessage[];
  newSession: () => Promise<void> | void;
  openModel: () => void;
  openThinking: () => void;
  openSessionInfo: () => void;
}

/** 内置命令消费；返回 false 表示应透传给 pi prompt。 */
export async function runBuiltinCommand(
  full: string,
  actions: CommandActions,
): Promise<boolean> {
  const space = full.indexOf(' ');
  const name = space === -1 ? full.slice(1) : full.slice(1, space);
  const argument = space === -1 ? '' : full.slice(space + 1).trim();
  switch (name) {
    case 'new':
      await actions.newSession();
      return true;
    case 'compact':
      await bridge?.cmd('session.compact', {
        ...(argument ? { instructions: argument } : {}),
      });
      return true;
    case 'model':
      actions.openModel();
      return true;
    case 'thinking':
      actions.openThinking();
      return true;
    case 'name':
      if (!argument || !actions.activePath) return false;
      await bridge?.cmd('session.rename', {
        path: actions.activePath,
        name: argument,
      });
      return true;
    case 'session':
      actions.openSessionInfo();
      return true;
    case 'copy': {
      const text = lastAssistantText(actions.messages);
      if (text) await navigator.clipboard.writeText(text);
      return true;
    }
    default:
      return false;
  }
}
