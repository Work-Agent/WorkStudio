/** 插件静态命令描述：扫描期产物，激活时与动态实现合并。 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CommandDescriptor } from '@workstudio/sdk';
import type { PluginPackage } from './manifest.ts';

export function readStaticCommands(pkg: PluginPackage): CommandDescriptor[] {
  const file = join(pkg.root, 'commands.json');
  const raw = JSON.parse(readFileSync(file, 'utf-8')) as unknown;
  if (Array.isArray(raw)) return raw as CommandDescriptor[];
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`命令描述无效：${pkg.manifest.id}`);
  }
  if (Array.isArray((raw as { commands?: unknown }).commands)) {
    return (raw as { commands: CommandDescriptor[] }).commands;
  }
  return Object.entries(raw as Record<string, unknown>).map(
    ([name, value]) => ({
      name,
      ...(value as Omit<CommandDescriptor, 'name'>),
    }),
  );
}

export function mergeStaticCommands(
  pkg: PluginPackage,
  dynamic: Record<
    string,
    { summary: string; args: Record<string, unknown>; run: unknown }
  >,
): Record<
  string,
  { summary: string; args: Record<string, unknown>; run: unknown }
> {
  const staticCommands = readStaticCommands(pkg);
  const byName = new Map(
    staticCommands.map((command) => [command.name, command]),
  );
  const result: Record<
    string,
    { summary: string; args: Record<string, unknown>; run: unknown }
  > = {};
  for (const [name, command] of Object.entries(dynamic)) {
    const declared = byName.get(name);
    if (!declared) {
      throw new Error(`插件命令缺少静态描述：${pkg.manifest.id}/${name}`);
    }
    result[name] = {
      ...command,
      summary: declared.summary,
      args: declared.args,
    };
  }
  for (const name of byName.keys()) {
    if (!(name in dynamic)) {
      throw new Error(`静态命令没有实现：${pkg.manifest.id}/${name}`);
    }
  }
  return result;
}
