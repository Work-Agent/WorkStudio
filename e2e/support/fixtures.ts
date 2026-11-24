import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { installWorkStudioBridgeShim } from './work-studio-shim.ts';

export interface AppFixture {
  app: ElectronApplication;
  dataDir: string;
}

/** 每个测试独立数据根，避免工作区、窗口状态、单实例互相污染。 */
export async function launchApp(existingDataDir?: string): Promise<AppFixture> {
  const dataDir =
    existingDataDir ?? mkdtempSync(join(tmpdir(), 'work-studio-e2e-'));
  seedTestPlugin(dataDir);
  const app = await electron.launch({
    args: [
      '.',
      `--data-dir=${dataDir}`,
      `--user-data-dir=${join(dataDir, 'profile')}`,
    ],
    env: {
      ...process.env,
      WA_DATA_DIR: dataDir,
      // Playwright 自己管理 Electron 的调试端口；不要继承 live-dev 的固定 9222。
      WA_DEBUG_PORT: '',
      ...(process.env['E2E_RENDERER_URL']
        ? { ELECTRON_RENDERER_URL: process.env['E2E_RENDERER_URL'] }
        : {}),
    },
  });
  return { app, dataDir };
}

function seedTestPlugin(dataDir: string): void {
  const source = resolve('e2e/fixtures/html-viewer');
  const target = join(dataDir, 'plugins', 'installed', 'html-viewer');
  mkdirSync(join(dataDir, 'plugins', 'installed'), { recursive: true });
  cpSync(source, target, { recursive: true });
  writeFileSync(
    join(dataDir, 'plugins', 'installed.json'),
    `${JSON.stringify(
      {
        'html-viewer': {
          id: 'html-viewer',
          version: '2.0.0',
          source: 'local',
          installedAt: Date.now(),
        },
      },
      null,
      2,
    )}\n`,
  );
}

export async function windowByUrl(
  app: ElectronApplication,
  pattern: RegExp,
): Promise<Page> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const page = app.windows().find((item) => pattern.test(item.url()));
    if (page) return page;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`window not found: ${pattern}`);
}

export async function shellWindow(app: ElectronApplication): Promise<Page> {
  // 页面可能先加载、后重建；轮询当前窗口，避免等待已销毁的 Page。
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const page = app
      .windows()
      .find((item) =>
        /(?:^work:\/\/studio\/shell$|^file:.*\/renderer\/pages\/shell\/index\.html$|(?:localhost|127\.0\.0\.1):\d+\/pages\/shell\/index\.html$)/.test(
          item.url(),
        ),
      );
    if (page) {
      const ready = await page
        .evaluate(
          () =>
            typeof window.workStudio?.subscribe === 'function' ||
            typeof window.__e2eBridge?.available === 'function',
        )
        .catch(() => false);
      if (ready) {
        await page.evaluate(installWorkStudioBridgeShim).catch(() => undefined);
        return page;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('shell bridge not ready');
}

export async function closeApp(
  fixture: AppFixture,
  cleanup = true,
  force = false,
): Promise<void> {
  // 共享测试的失败清理只作用于隔离数据根；退出确认由独立用例验证。
  if (force)
    await fixture.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  else await fixture.app.close();
  // before-quit 可能有 200ms 收尾；等进程释放单实例锁。
  await new Promise((resolve) => setTimeout(resolve, 300));
  if (cleanup) rmSync(fixture.dataDir, { recursive: true, force: true });
}
