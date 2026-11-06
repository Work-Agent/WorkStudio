import { test, expect } from '../support/app';
import { windowByUrl } from '../support/fixtures';

test('弹窗加载样式，遮罩覆盖窗口，换肤和调整窗口后保持居中', async ({
  shell,
  electron,
}, testInfo) => {
  const original = await electron.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getBounds(),
  );
  const appearance = await shell.evaluate(() =>
    window.appBridge!.peek('/appearance'),
  );
  const overlay = await windowByUrl(electron.app, /overlay\.html/);
  try {
    await shell.evaluate(() =>
      window.appBridge!.call('/dialogs/open', {
        request: {
          type: 'dialog',
          id: 'dialog-style-regression',
          dialogType: 'select',
          title: '要保存修改吗？',
          message:
            '2026.11.3云动发货沙特车联网卡250（新能源）MET71600077.xlsx 有未保存的修改。',
          options: ['保存并继续', '放弃修改'],
        },
      }),
    );
    const dialog = overlay.getByRole('dialog');
    await expect(dialog).toHaveCSS('border-radius', '12px');
    const backdrop = dialog.locator('..');
    await expect(backdrop).toHaveCSS('position', 'fixed');
    await expect(backdrop).toHaveCSS('display', 'flex');
    expect(
      await backdrop.evaluate((el) => {
        const color = getComputedStyle(el).backgroundColor;
        return Number(color.match(/[\d.]+/g)?.[3]);
      }),
    ).toBeCloseTo(0.35);
    for (const [skin, background] of [
      ['black', 'rgb(11, 12, 15)'],
      ['graphite', 'rgb(28, 31, 36)'],
      ['porcelain', 'rgb(245, 246, 249)'],
      ['mist', 'rgb(234, 240, 247)'],
    ]) {
      await shell.evaluate(
        (skin) =>
          window.appBridge!.call('/appearance/set', { mode: 'fixed', skin }),
        skin,
      );
      await expect(dialog).toHaveCSS('background-color', background);
    }
    for (const [width, height] of [
      [1280, 840],
      [960, 600],
    ]) {
      await electron.app.evaluate(
        ({ BrowserWindow }, size) =>
          BrowserWindow.getAllWindows()[0].setSize(size[0], size[1]),
        [width, height],
      );
      await expect
        .poll(() =>
          dialog.evaluate((el) => {
            const card = el.getBoundingClientRect();
            const mask = el.parentElement!.getBoundingClientRect();
            return Math.max(
              Math.abs(card.x + card.width / 2 - innerWidth / 2),
              Math.abs(card.y + card.height / 2 - innerHeight / 2),
              Math.abs(mask.x),
              Math.abs(mask.y),
              Math.abs(mask.width - innerWidth),
              Math.abs(mask.height - innerHeight),
            );
          }),
        )
        .toBeLessThan(1);
    }
    for (const selector of ['html', 'body', '#root'])
      await expect(overlay.locator(selector)).toHaveCSS(
        'background-color',
        'rgba(0, 0, 0, 0)',
      );
    await dialog.screenshot({ path: testInfo.outputPath('save-dialog.png') });
  } finally {
    const cancel = overlay.getByRole('button', { name: '取消', exact: true });
    if (await cancel.isVisible()) await cancel.click();
    await shell.evaluate(
      (settings) => window.appBridge!.call('/appearance/set', settings),
      appearance,
    );
    await electron.app.evaluate(
      ({ BrowserWindow }, bounds) =>
        BrowserWindow.getAllWindows()[0].setBounds(bounds),
      original,
    );
  }
});
