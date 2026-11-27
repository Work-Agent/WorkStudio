import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { E2EContext } from '../runner/contract.ts';

/** 内置插件的同步产物：`pnpm plugins:sync` 写入，启动时再播种到数据根。 */
const BUILTIN_ROOT = resolve('out/plugins');

interface InstalledPlugin {
  id: string;
  label?: string;
  stage?: string;
}

async function installedIds(ctx: E2EContext): Promise<Set<string>> {
  const list = (await ctx.evaluate(() =>
    window.workStudio.subscribe('plugin', 'installed'),
  )) as InstalledPlugin[] | null;
  return new Set((list ?? []).map((item) => item.id));
}

async function install(
  ctx: E2EContext,
  source: string,
): Promise<string | null> {
  return ctx.evaluate(async (root) => {
    const response = await window.workStudio.command(
      'plugin',
      'installed',
      'install',
      { source: root },
    );
    return response.ok ? null : response.error.message;
  }, source);
}

/**
 * 用仓库真实的内置插件做用例：从 `out/plugins/<id>` 装进当前数据根。
 * 没有同步产物时直接报错，避免用例悄悄跑在别的同名插件上。
 */
export async function ensureBuiltinPlugin(
  ctx: E2EContext,
  id: string,
): Promise<void> {
  if ((await installedIds(ctx)).has(id)) return;
  const source = resolve(BUILTIN_ROOT, id);
  if (!existsSync(source)) {
    throw new Error(
      `内置插件 ${id} 未同步：先执行 pnpm plugins:sync（产物在 out/plugins）`,
    );
  }
  const error = await install(ctx, source);
  if (error) throw new Error(`内置插件 ${id} 安装失败：${error}`);
}

/** 安装 e2e/fixtures 下的探针插件（只提供测试用命令，不参与产品行为）。 */
export async function ensureFixturePlugin(
  ctx: E2EContext,
  fixture: string,
): Promise<void> {
  if ((await installedIds(ctx)).has(fixture)) return;
  const error = await install(ctx, resolve('e2e/fixtures', fixture));
  if (error) throw new Error(`测试插件 ${fixture} 安装失败：${error}`);
}
