import { resolve } from 'node:path';
import type { E2EContext } from '../runner/contract.ts';

const FIXTURE = 'html-viewer';

/** 测试插件不是产品内置插件：需要时从 e2e/fixtures 安装到隔离数据根。 */
export async function ensureHtmlFixture(ctx: E2EContext): Promise<void> {
  const installed = (await ctx.evaluate(() =>
    window.workStudio.subscribe('plugin', 'installed'),
  )) as Array<{ id: string }>;
  if (installed.some((item) => item.id === FIXTURE)) return;
  const source = resolve('e2e/fixtures/html-viewer');
  const result = await ctx.evaluate(async (root) => {
    const response = await window.workStudio.command(
      'plugin',
      'installed',
      'install',
      { source: root },
    );
    return response.ok ? null : response.error.message;
  }, source);
  if (result) throw new Error(`测试插件安装失败：${result}`);
}
