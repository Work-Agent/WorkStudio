/**
 * 原生窗口 / 原生视图的「只有 Windows 才会坏」的两处行为。
 *
 *  1. 标题栏三键：Windows / Linux 隐藏标题栏后必须挂 WCO 覆盖层，否则没有三键；
 *     macOS 的红绿灯由系统绘制，与覆盖层无关。
 *  2. 内容视图首帧：Windows 上「隐藏期间设过几何 → 再显示」的 WebContentsView
 *     不会重建合成面，视图可见、几何正确却永远空白。
 *
 * 这两条都只能用主进程能力观测（WCO 几何在页面侧，首帧只能靠 capturePage），
 * 因此留在 Playwright 侧，不进共享 cases（dev CDP 运行器无主进程通道）。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '../support/app';
import { switchWorkspace } from '../support/commands';
import { windowByUrl } from '../support/fixtures';

/** 侧栏回到主列表：用例之间共享同一个壳层，二级列表状态会挡住下一个用例。 */
async function backToMainList(shell: Page): Promise<void> {
  const back = shell.getByTestId('sidebar-back');
  if (await back.isVisible().catch(() => false)) await back.click();
}

const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';

/** 主进程侧：对某个页面视图做一次离屏截图，统计颜色种类（空白视图只有 1 种）。 */
async function captureViewColors(
  app: Parameters<typeof windowByUrl>[0],
  pattern: RegExp,
): Promise<number> {
  return app.evaluate(
    async ({ BrowserWindow }, source) => {
      const { source: patternSource, flags } = source as {
        source: string;
        flags: string;
      };
      const matcher = new RegExp(patternSource, flags);
      type ViewLike = {
        webContents: {
          getURL(): string;
          capturePage(): Promise<{ toBitmap(): Uint8Array }>;
        };
      };
      const views = BrowserWindow.getAllWindows().flatMap((win) =>
        (win.contentView.children as unknown as ViewLike[]).filter((child) =>
          matcher.test(child.webContents.getURL()),
        ),
      );
      const view = views[0];
      if (!view) return 0;
      const bitmap = (await view.webContents.capturePage()).toBitmap();
      let colors = 0;
      let last = -1;
      for (let index = 0; index < bitmap.length; index += 4) {
        const key =
          bitmap[index] * 65536 + bitmap[index + 1] * 256 + bitmap[index + 2];
        if (key !== last) {
          colors += 1;
          last = key;
        }
      }
      return colors;
    },
    { source: pattern.source, flags: pattern.flags },
  );
}

test('标题栏留白来自平台实测几何（Windows：三键由 WCO 覆盖层绘制）', async ({
  shell,
}) => {
  const wco = await shell.evaluate(() => {
    const overlay = (
      navigator as Navigator & {
        windowControlsOverlay?: {
          visible: boolean;
          getTitlebarAreaRect(): { x: number; width: number };
        };
      }
    ).windowControlsOverlay;
    const root = document.documentElement;
    return {
      supported: Boolean(overlay),
      visible: overlay?.visible ?? false,
      rect: overlay?.getTitlebarAreaRect() ?? null,
      viewportWidth: window.innerWidth,
      insetRight: Number.parseFloat(
        getComputedStyle(root).getPropertyValue('--titlebar-inset-right'),
      ),
      insetLeft: Number.parseFloat(
        getComputedStyle(root).getPropertyValue('--titlebar-inset-left'),
      ),
    };
  });

  if (isMac) {
    // 红绿灯在左：覆盖层不参与，留白取平台兜底值。
    expect(wco.insetLeft).toBeGreaterThan(0);
    return;
  }

  // Windows 必须真的挂上覆盖层：否则三键不存在（Linux 桌面环境不支持 WCO 时
  // 由渲染层兜底留白，这里不作硬断言）。
  if (isWindows) expect(wco.visible).toBe(true);
  if (!wco.visible || !wco.rect) return;

  // 覆盖层之外的区域就是原生三键：几何从实测 rect 反推，而不是写死常量。
  expect(wco.rect.width).toBeLessThan(wco.viewportWidth);
  expect(wco.insetRight).toBe(
    Math.round(wco.viewportWidth - wco.rect.x - wco.rect.width),
  );
});

test('内容视图打开后立即有首帧（不是空白视图）', async ({
  shell,
  electron,
  dataDir,
}) => {
  // 只守 Windows：「隐藏期间设过几何 → 再 show 不出首帧」是该平台合成器的行为。
  // 另外 webContents.capturePage() 偶发返回整屏单色（而屏幕实际已画出来），
  // 因此这里用「轮询到有色阶为止」判定：真回归时它会一直空白，不会假绿。
  test.skip(!isWindows, '首帧空白只在 Windows 合成器上复现');
  const workspace = join(dataDir, 'fixtures', 'first-frame-workspace');
  mkdirSync(workspace, { recursive: true });
  const file = join(workspace, 'note.md');
  writeFileSync(file, '# 首帧\n\nbody\n', 'utf-8');

  await switchWorkspace(shell, workspace);
  await backToMainList(shell);
  await shell
    .getByTestId('sidebar-group')
    .filter({ hasText: '本地文档' })
    .click();
  await shell.getByText('note.md', { exact: true }).click();

  const page = await windowByUrl(electron.app, /markdown-viewer\/index\.html/);
  await expect(page.getByRole('heading', { name: '首帧' })).toBeVisible();

  // DOM 可见 ≠ 画出来了：Windows 曾出现「DOM 正常、视图永远空白」。
  await expect
    .poll(
      () => captureViewColors(electron.app, /markdown-viewer\/index\.html/),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(1);

  await backToMainList(shell);
});
