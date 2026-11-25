/**
 * 命令描述与命令表条目。
 *
 * 一份描述同时供页面调用、助手 CLI、命令手册与授权判断使用；
 * 参数校验、argv 解析与退出码归一由框架完成，插件只实现 run。
 */

import type { ArgSpec, CommandDecl } from '@workstudio/sdk';
import type { ChangeType, Origin } from '../contract.ts';
import { notImplemented } from '../contract.ts';
import type { Log } from '../log.ts';
import type { Address } from './address.ts';

export type { ArgSpec, CommandDecl } from '@workstudio/sdk';

export type CommandInput = { ref?: string } & Record<string, unknown>;

/** 命令实现可用的上下文；插件实现会拿到扩展后的 PluginContext。 */
export interface CommandContext {
  origin: Origin;
  changed(ref: string, type: ChangeType): void;
  log: Log;
}

export type CommandRun = (
  input: CommandInput,
  ctx: CommandContext,
) => Promise<unknown> | unknown;

export interface CommandSpec {
  summary: string;
  args?: Record<string, ArgSpec>;
  /** 是否暴露给助手命令表；缺省 true。 */
  agentExposed?: boolean;
  run: CommandRun;
}

export interface CommandEntry {
  address: Address;
  action: string;
  decl: CommandDecl;
  /** 实现归属：系统模块 id 或插件 id，撤销注册时按它清理。 */
  owner: string;
  /** 是否暴露给助手命令表；缺省 true。 */
  agentExposed?: boolean;
  run: CommandRun;
}

export function commandKey(address: Address, action: string): string {
  return `${address.domain}/${address.resource}/${action}`;
}

/** 结构占位：命令条目已入表，实现留给后续迁移。 */
export function pending(name: string): CommandRun {
  return () => notImplemented(name);
}

/** CLI 的字符串参数按描述归一到声明类型。 */
export function coerceCommandInput(
  decl: CommandDecl,
  input: CommandInput,
): CommandInput {
  const next: CommandInput = { ...input };
  for (const [name, spec] of Object.entries(decl.args)) {
    if (
      next[name] === undefined &&
      'default' in spec &&
      spec.default !== undefined
    ) {
      next[name] = spec.default;
    }
    if (!('type' in spec)) continue;
    const value = next[name];
    if (spec.type === 'number' && typeof value === 'string') {
      const parsed = Number(value);
      if (!Number.isNaN(parsed)) next[name] = parsed;
    }
    if (spec.type === 'boolean' && typeof value === 'string') {
      if (value === 'true') next[name] = true;
      if (value === 'false') next[name] = false;
    }
  }
  return next;
}

export function validateCommandInput(
  decl: CommandDecl,
  input: CommandInput,
): string | null {
  for (const [name, spec] of Object.entries(decl.args)) {
    const value = input[name];
    if (value === undefined) {
      if ('required' in spec && spec.required === true) {
        return `缺少参数：${name}`;
      }
      continue;
    }
    if ('enum' in spec) {
      if (typeof value !== 'string' || !spec.enum.includes(value)) {
        return `参数非法：${name}`;
      }
      continue;
    }
    if (spec.type === 'locator') {
      if (typeof value !== 'string' || !value.startsWith(`${spec.scheme}:`)) {
        return `locator 非法：${name}`;
      }
      continue;
    }
    if (typeof value !== spec.type) return `参数类型非法：${name}`;
  }
  return null;
}

export interface ParsedCommandLine {
  domain: string;
  action: string;
  input: CommandInput;
}

/** `ws <domain> <action> <ref> [--arg value]` → 命令表入参。 */
export function parseCommandLine(
  argv: readonly string[],
): ParsedCommandLine | null {
  const [head, domain, action, ref, ...rest] = argv;
  if (head !== 'ws' || !domain || !action || !ref) return null;

  const input: CommandInput = { ref };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]!;
    if (!token.startsWith('--')) continue;
    const body = token.slice(2);
    const equal = body.indexOf('=');
    const name = equal < 0 ? body : body.slice(0, equal);
    if (!name) continue;
    if (equal >= 0) {
      input[name] = body.slice(equal + 1);
      continue;
    }
    const next = rest[index + 1];
    if (next && !next.startsWith('--')) {
      input[name] = next;
      index += 1;
    } else {
      input[name] = true;
    }
  }
  return { domain, action, input };
}
