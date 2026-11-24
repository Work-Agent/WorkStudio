/**
 * 目标架构主进程入口。
 *
 * 这里只负责 Electron 进程参数；业务由 bootstrapNext / NextApp 装配。
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNext } from './index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const devBase = process.env['ELECTRON_RENDERER_URL']?.replace(/\/+$/, '');

runNext({
  rendererRoot: join(here, '../renderer'),
  ...(devBase ? { devBase } : {}),
  builtinPluginsRoot: join(here, '../plugins'),
  builtinSkillsRoot: join(here, '../skills'),
  shell: {
    preload: join(here, '../preload/work-studio.cjs'),
    capturePreload: join(here, '../preload/capture.cjs'),
    shellUrl: 'work://studio/shell',
    assistantUrl: 'work://studio/assistant',
    overlayUrl: 'work://studio/overlay',
    welcomeUrl: 'work://studio/welcome',
    captureUrl: 'work://studio/capture',
  },
});
