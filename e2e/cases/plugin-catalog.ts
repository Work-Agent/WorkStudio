import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { strToU8, zipSync } from 'fflate';
import { defineCase } from '../runner/contract.ts';

interface CatalogEntryView {
  id: string;
  version: string;
  state: 'available' | 'installed' | 'update';
}

interface CatalogState {
  entries: CatalogEntryView[];
  stale: boolean;
  error?: string;
}

interface InstalledView {
  id: string;
  stage: string;
}

const PLUGIN_ID = 'e2e-catalog-plugin';
const BUNDLE_VERSION = '1.0.0';

export default defineCase({
  id: 'plugin.catalog',
  title: '插件目录刷新、更新检测、离线回退与 catalog 安装',
  tags: ['dev', 'ci', 'mutating'],
  async run(ctx) {
    const bundle = buildBundle();
    const sha256 = createHash('sha256').update(bundle).digest('hex');
    let version = BUNDLE_VERSION;
    let failing = false;
    let port = 0;

    const server = createServer((request, response) => {
      if (failing) {
        response.statusCode = 503;
        response.end('unavailable');
        return;
      }
      if (request.url === '/index.json') {
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({
            schemaVersion: 1,
            entries: [
              {
                id: PLUGIN_ID,
                name: 'E2E 目录插件',
                description: '由 e2e 本地目录提供',
                version,
                source: `http://127.0.0.1:${port}/plugin.zip`,
                sha256,
                category: '测试',
                tags: ['e2e'],
              },
            ],
          }),
        );
        return;
      }
      if (request.url === '/plugin.zip') {
        response.setHeader('content-type', 'application/zip');
        response.end(Buffer.from(bundle));
        return;
      }
      response.statusCode = 404;
      response.end('not found');
    });

    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', () => resolve()),
    );
    port = (server.address() as AddressInfo).port;
    const indexUrl = `http://127.0.0.1:${port}/index.json`;

    try {
      const first = await ctx.evaluate(async (url) => {
        const result = await window.workStudio.command(
          'plugin',
          'catalog',
          'setSource',
          { url },
        );
        return result.ok ? result.data : { error: result.error.message };
      }, indexUrl);
      const firstState = first as CatalogState & { error?: string };
      if (firstState.error) throw new Error(firstState.error);
      if (firstState.entries?.[0]?.id !== PLUGIN_ID) {
        throw new Error('目录条目未加载');
      }

      const installed = await ctx.evaluate(async (source) => {
        const result = await window.workStudio.command(
          'plugin',
          'installed',
          'install',
          { source },
        );
        return result.ok ? null : result.error.message;
      }, `catalog:${PLUGIN_ID}`);
      if (installed) throw new Error(`目录安装失败：${installed}`);

      await ctx.expect.poll(async () => {
        const list = (await ctx.evaluate(() =>
          window.workStudio.subscribe('plugin', 'installed'),
        )) as InstalledView[];
        return list.some(
          (item) => item.id === PLUGIN_ID && item.stage === 'ready',
        );
      }, '目录插件未激活');

      await ctx.expect.poll(async () => {
        const state = (await ctx.evaluate(() =>
          window.workStudio.subscribe('plugin', 'catalog'),
        )) as CatalogState;
        return state.entries.some(
          (item) => item.id === PLUGIN_ID && item.state === 'installed',
        );
      }, '目录未标记已安装');

      const missingHash = await ctx.evaluate(async (url) => {
        const result = await window.workStudio.command(
          'plugin',
          'installed',
          'install',
          { source: url },
        );
        return result.ok ? null : result.error.message;
      }, `http://127.0.0.1:${port}/plugin.zip`);
      if (!missingHash?.includes('sha256')) {
        throw new Error('缺少 sha256 的远程安装未被拒绝');
      }

      version = '1.1.0';
      await ctx.evaluate(() =>
        window.workStudio.command('plugin', 'catalog', 'refresh'),
      );
      await ctx.expect.poll(async () => {
        const state = (await ctx.evaluate(() =>
          window.workStudio.subscribe('plugin', 'catalog'),
        )) as CatalogState;
        return state.entries.some(
          (item) => item.id === PLUGIN_ID && item.state === 'update',
        );
      }, '未检测到目录更新');

      failing = true;
      const stale = await ctx.evaluate(async () => {
        const result = await window.workStudio.command(
          'plugin',
          'catalog',
          'refresh',
        );
        return result.ok ? result.data : { error: result.error.message };
      });
      const staleState = stale as CatalogState;
      if (!staleState.stale) throw new Error('刷新失败后未标记 stale');
      if (!staleState.entries.some((item) => item.id === PLUGIN_ID)) {
        throw new Error('刷新失败后丢失缓存条目');
      }

      await ctx.evaluate(async (pluginId) => {
        await window.workStudio.command('plugin', 'installed', 'remove', {
          id: pluginId,
        });
      }, PLUGIN_ID);
      await ctx.expect.poll(async () => {
        const list = (await ctx.evaluate(() =>
          window.workStudio.subscribe('plugin', 'installed'),
        )) as InstalledView[];
        return !list.some((item) => item.id === PLUGIN_ID);
      }, '目录插件未卸载');
    } finally {
      failing = false;
      await ctx
        .evaluate(() =>
          window.workStudio.command('plugin', 'catalog', 'setSource', {
            url: '',
          }),
        )
        .catch(() => undefined);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
});

function buildBundle(): Uint8Array {
  return zipSync({
    'package.json': strToU8(
      JSON.stringify({
        name: `@work-studio/${PLUGIN_ID}`,
        version: BUNDLE_VERSION,
        type: 'module',
        workstudio: {
          id: PLUGIN_ID,
          label: 'E2E 目录插件',
          pages: { content: 'index.html' },
        },
        exports: { './workstudio': './engine.js' },
      }),
    ),
    'commands.json': strToU8('{"commands":[]}'),
    'engine.js': strToU8(
      'export const workstudio = { resources: {}, commands: {} };\n',
    ),
    'index.html': strToU8(
      '<html><body><h1>E2E CATALOG PLUGIN</h1></body></html>',
    ),
  });
}
