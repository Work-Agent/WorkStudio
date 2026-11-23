/**
 * Electron 入口：进程生命周期在 App.run()，这里只组装窗口参数。
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { App } from './app.ts';
import { workUrl } from '../shared/pages.ts';

const here = dirname(fileURLToPath(import.meta.url));

function rendererPage(
  page: 'index' | 'assistant' | 'overlay' | 'settings' | 'welcome',
): string {
  return workUrl(page === 'index' ? 'shell' : page);
}

function shellUrl(): string {
  return workUrl('shell');
}

function shellPreload(): string {
  return join(here, '../preload/work-studio.cjs');
}

void App.run({
  url: shellUrl(),
  window: {
    webPreferences: { preload: shellPreload() },
  },
  capturePreload: join(here, '../preload/capture.cjs'),
  rendererRoot: join(here, '../renderer'),
  ...(process.env['ELECTRON_RENDERER_URL']
    ? { devBase: process.env['ELECTRON_RENDERER_URL'].replace(/\/+$/, '') }
    : {}),
  preloads: {
    workStudio: join(here, '../preload/work-studio.cjs'),
  },
  rendererPage,
}).catch((error: unknown) => {
  console.error('[app] failed to start', error);
});
