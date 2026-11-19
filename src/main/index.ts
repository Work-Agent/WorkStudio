/**
 * Electron 入口：进程生命周期在 App.run()，这里只组装窗口参数。
 */

import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { App } from './app.ts';

const here = dirname(fileURLToPath(import.meta.url));

function rendererPage(
  page: 'index' | 'assistant' | 'overlay' | 'settings' | 'welcome',
): string {
  const dir = page === 'index' ? 'shell' : page;
  const dev = process.env['ELECTRON_RENDERER_URL'];
  if (dev) return `${dev.replace(/\/+$/, '')}/pages/${dir}/index.html`;
  return pathToFileURL(
    join(here, '../renderer/pages', dir, 'index.html'),
  ).toString();
}

function shellUrl(): string {
  return rendererPage('index');
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
  preloads: {
    extension: join(here, '../preload/extension.cjs'),
    browser: join(here, '../preload/browser.cjs'),
    assistant: join(here, '../preload/work-studio.cjs'),
    overlay: join(here, '../preload/work-studio.cjs'),
    settings: join(here, '../preload/work-studio.cjs'),
  },
  rendererPage,
}).catch((error: unknown) => {
  console.error('[app] failed to start', error);
});
