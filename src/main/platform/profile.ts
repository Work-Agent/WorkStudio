/**
 * 运行档（profile）：安装包与开发运行各用一份 App 数据目录，完全不共享。
 *
 * 判据是「有没有装成包」加上构建档：源码运行（`pnpm dev`、`electron .`、
 * `preview`）与本地打包的 dev 包都进开发档，正式安装包才用正式档。
 * 正式档靠发布流程写入的 `wsFlavor: release` 标记识别，缺标记一律当开发档——
 * 漏带标记最多写进开发档，不会污染正式数据根。
 * 显式 `--user-data-dir`（Playwright、隔离调试）是调用方自己的档案，直接采用。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type AppFlavor = 'release' | 'dev';

const DEV_NAME_SUFFIX = ' Dev';

export interface ProfileInputs {
  /** 系统级 App 数据目录（app.getPath('appData')）。 */
  appData: string;
  /** 应用名（app.getName()：源码运行取 productName，安装包取打包后的名称）。 */
  appName: string;
  /** 是否来自安装包（app.isPackaged）。 */
  isPackaged: boolean;
  /** 构建档：本地打包的 dev 包即使已打包也算开发档。 */
  flavor: AppFlavor;
  /** 显式 --user-data-dir 给出的档案目录；没有则为 null。 */
  explicitDir: string | null;
}

export interface Profile {
  /** 档案名：开发档带 Dev 后缀，菜单、关于面板与日志目录都用它。 */
  readonly name: string;
  /** 档案目录：userData、Chromium 数据、日志与数据根指针都在这里。 */
  readonly dir: string;
  /** 开发档：数据、系统身份与单实例锁都和正式档分开。 */
  readonly dev: boolean;
}

export function resolveProfile(inputs: ProfileInputs): Profile {
  const dev = !inputs.isPackaged || inputs.flavor === 'dev';
  // dev 包的 productName 已经是 `WorkStudio Dev`，先归一化再加后缀，
  // 避免叠成 `WorkStudio Dev Dev`。
  const baseName = inputs.appName.endsWith(DEV_NAME_SUFFIX)
    ? inputs.appName.slice(0, -DEV_NAME_SUFFIX.length)
    : inputs.appName;
  const name = dev ? `${baseName}${DEV_NAME_SUFFIX}` : baseName;
  return { name, dir: inputs.explicitDir ?? join(inputs.appData, name), dev };
}

/**
 * 构建档：electron-builder 用 `extraMetadata` 把 `wsFlavor: release` 写进包内
 * package.json，只有 `pnpm release` 与 Release workflow 会这么做。
 * 缺这个字段就按开发档处理：漏了标记最多写进开发档，不会污染正式数据根。
 */
export function readAppFlavor(appPath: string): AppFlavor {
  try {
    const raw = JSON.parse(
      readFileSync(join(appPath, 'package.json'), 'utf-8'),
    ) as { wsFlavor?: unknown };
    return raw.wsFlavor === 'release' ? 'release' : 'dev';
  } catch {
    return 'dev';
  }
}
