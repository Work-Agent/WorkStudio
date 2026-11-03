import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

export interface AppFixture {
  app: ElectronApplication;
  dataDir: string;
}

/** 每个测试独立数据根，避免工作区、窗口状态、单实例互相污染。 */
export async function launchApp(existingDataDir?: string): Promise<AppFixture> {
  const dataDir =
    existingDataDir ?? mkdtempSync(join(tmpdir(), 'work-studio-e2e-'));
  const app = await electron.launch({
    args: [
      '.',
      `--data-dir=${dataDir}`,
      `--user-data-dir=${join(dataDir, 'profile')}`,
    ],
    env: {
      ...process.env,
      WA_DATA_DIR: dataDir,
      ...(process.env['E2E_RENDERER_URL']
        ? { ELECTRON_RENDERER_URL: process.env['E2E_RENDERER_URL'] }
        : {}),
    },
  });
  return { app, dataDir };
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
    const page = app.windows().find((item) => /index\.html/.test(item.url()));
    if (page) {
      const ready = await page
        .evaluate(() => typeof window.appBridge?.available === 'function')
        .catch(() => false);
      if (ready) return page;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('shell bridge not ready');
}

export async function closeApp(
  fixture: AppFixture,
  cleanup = true,
): Promise<void> {
  await fixture.app.close();
  // before-quit 可能有 200ms 收尾；等进程释放单实例锁。
  await new Promise((resolve) => setTimeout(resolve, 300));
  if (cleanup) rmSync(fixture.dataDir, { recursive: true, force: true });
}
