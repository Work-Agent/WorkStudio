/**
 * 插件构建：把动态入口里的静态部分抽出来。
 *
 *   engine.js      动态：run 与数据接口（plugin repo 自己的构建产物）
 *   commands.json  静态：args · summary（扫描期入表）
 *   api.json       静态：运行期参数校验
 *   api.d.ts       静态：页面类型
 *
 * 用法：`workstudio-plugin <plugin-root>`。
 */

import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ArgSpec, CommandDescriptor } from './command.ts';
import { DEFAULT_EXIT_CODES } from './command.ts';
import type { PluginContribution } from './contribution.ts';
import { type WorkStudioManifest } from './manifest.ts';

interface PackageJson {
  exports?: string | Record<string, unknown>;
  workstudio?: WorkStudioManifest;
  /** 兼容 camelCase 写法；规范字段是 workstudio。 */
  workStudio?: WorkStudioManifest;
}

export interface BuildResult {
  commands: CommandDescriptor[];
  files: string[];
}

export async function buildPlugin(root: string): Promise<BuildResult> {
  const packageFile = join(root, 'package.json');
  const pkg = JSON.parse(await readFile(packageFile, 'utf-8')) as PackageJson;
  const manifest = pkg.workstudio ?? pkg.workStudio;
  if (!manifest) throw new Error('package.json 缺少 workstudio 字段');
  if (!manifest.id) {
    throw new Error('插件清单缺少 id');
  }
  if (!manifest.pages?.content) {
    throw new Error(`插件缺少内容页：${manifest.id}`);
  }

  const entry = entryOf(pkg.exports);
  if (!entry) {
    throw new Error("插件缺少 exports['./workstudio'] 入口");
  }

  const module = (await import(pathToFileURL(resolve(root, entry)).href)) as {
    workstudio?: PluginContribution;
  };
  const contribution = module.workstudio;
  if (!contribution) {
    throw new Error('插件入口未导出 workstudio');
  }

  for (const name of Object.keys(contribution.commands)) {
    if (!name.startsWith(`${manifest.id}.`)) {
      throw new Error(`命令名必须以 ${manifest.id}. 开头：${name}`);
    }
  }

  const commands: CommandDescriptor[] = Object.entries(
    contribution.commands,
  ).map(([name, command]) => ({
    name,
    summary: command.summary,
    args: command.args,
    exitCodes: DEFAULT_EXIT_CODES,
  }));

  const commandsFile = resolve(root, 'commands.json');
  const apiFile = sibling(commandsFile, 'api.json');
  const typesFile = sibling(commandsFile, 'api.d.ts');
  await mkdir(dirname(commandsFile), { recursive: true });

  await writeFile(commandsFile, `${JSON.stringify({ commands }, null, 2)}\n`);
  await writeFile(
    apiFile,
    `${JSON.stringify(
      { commands: commands.map(({ name, args }) => ({ name, args })) },
      null,
      2,
    )}\n`,
  );
  await writeFile(typesFile, renderApiTypes(commands));

  return {
    commands,
    files: [commandsFile, apiFile, typesFile],
  };
}

async function validateSkills(
  root: string,
  manifest: WorkStudioManifest,
): Promise<void> {
  const names = new Set<string>();
  for (const dir of manifest.skills ?? []) {
    const file = resolve(root, dir, 'SKILL.md');
    if (!(await isFile(file))) {
      throw new Error(`技能目录缺少 SKILL.md：${dir}`);
    }
    const text = await readFile(file, 'utf-8');
    const name = text
      .match(/^---[\s\S]*?^name:\s*["']?([^\n"']+)/m)?.[1]
      ?.trim();
    if (!name) throw new Error(`SKILL.md 缺少 name frontmatter：${dir}`);
    if (names.has(name)) throw new Error(`技能重名：${name}`);
    names.add(name);
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function entryOf(exports: PackageJson['exports']): string | null {
  if (typeof exports === 'string') return exports;
  if (exports && typeof exports['./workstudio'] === 'string') {
    return exports['./workstudio'];
  }
  return null;
}

function sibling(file: string, name: string): string {
  return join(dirname(file), name);
}

function renderApiTypes(commands: CommandDescriptor[]): string {
  const lines = ['export interface PluginApi {', '  commands: {'];
  for (const command of commands) {
    lines.push(
      `    ${JSON.stringify(command.name)}: { input: ${renderArgs(command.args)}; output: unknown };`,
    );
  }
  lines.push('  };', '}', '');
  return lines.join('\n');
}

function renderArgs(args: Record<string, ArgSpec>): string {
  const fields = Object.entries(args).map(
    ([name, spec]) =>
      `${JSON.stringify(name)}${isOptional(spec) ? '?' : ''}: ${renderArg(spec)};`,
  );
  return fields.length === 0
    ? 'Record<string, never>'
    : `{ ${fields.join(' ')} }`;
}

function isOptional(spec: ArgSpec): boolean {
  if ('required' in spec && spec.required === true) {
    return 'default' in spec && spec.default !== undefined;
  }
  return true;
}

function renderArg(spec: ArgSpec): string {
  if ('enum' in spec) {
    return spec.enum.map((value) => JSON.stringify(value)).join(' | ');
  }
  if (spec.type === 'locator') return 'string';
  return spec.type;
}
