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

test('长选择弹窗可滚动到末项，标题和取消始终可见', async ({
  shell,
  electron,
}, testInfo) => {
  const original = await electron.app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const bounds = win.getBounds();
    win.setSize(960, 600);
    return bounds;
  });
  const overlay = await windowByUrl(electron.app, /overlay\.html/);
  const title = '请选择一个条目';
  try {
    await shell.evaluate(
      (title) =>
        window.appBridge!.call('/dialogs/open', {
          request: {
            type: 'dialog',
            id: 'long-selection',
            dialogType: 'select',
            title,
            message: `较长的文件标识：${'a'.repeat(200)}`,
            options: Array.from({ length: 30 }, (_, i) => `选项 ${i + 1}`),
          },
        }),
      title,
    );
    const cancel = overlay.getByRole('button', { name: '取消', exact: true });
    await expect(overlay.getByText(title, { exact: true })).toBeInViewport({
      ratio: 1,
    });
    await expect(cancel).toBeInViewport({ ratio: 1 });
    const last = overlay.getByRole('button', { name: '选项 30', exact: true });
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport({ ratio: 1 });
    await expect(cancel).toBeInViewport({ ratio: 1 });
    await expect(overlay.getByText(title, { exact: true })).toBeInViewport({
      ratio: 1,
    });
    expect(
      await overlay
        .getByRole('dialog')
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await overlay.getByRole('dialog').screenshot({
      path: testInfo.outputPath('long-selection.png'),
    });
    await last.click();
    await expect
      .poll(() =>
        shell.evaluate(async () => {
          const dialogs =
            await window.appBridge!.peek<
              Array<{ id: string; response?: { value?: string } }>
            >('/dialogs');
          return dialogs?.find((d) => d.id === 'long-selection')?.response
            ?.value;
        }),
      )
      .toBe('选项 30');
  } finally {
    const cancel = overlay.getByRole('button', { name: '取消', exact: true });
    if (await cancel.isVisible()) await cancel.click();
    await electron.app.evaluate(
      ({ BrowserWindow }, bounds) =>
        BrowserWindow.getAllWindows()[0].setBounds(bounds),
      original,
    );
  }
});

test('浅色皮肤下的信息通知使用深色文字', async ({ shell }, testInfo) => {
  const appearance = await shell.evaluate(() =>
    window.appBridge!.peek('/appearance'),
  );
  try {
    for (const [skin, foreground] of [
      ['porcelain', 'rgb(40, 45, 55)'],
      ['mist', 'rgb(37, 53, 74)'],
    ]) {
      await shell.evaluate(
        (skin) =>
          window.appBridge!.call('/appearance/set', { mode: 'fixed', skin }),
        skin,
      );
      const message = `${skin} 通知文字检查`;
      await shell.evaluate(
        (message) =>
          window.appBridge!.call('/notify', { level: 'info', message }),
        message,
      );
      const toast = shell.getByText(message, { exact: true });
      await expect(toast).toHaveCSS('color', foreground);
      await toast.screenshot({
        path: testInfo.outputPath(`toast-${skin}.png`),
      });
      await shell.evaluate(() => window.appBridge!.call('/notices/dismiss'));
    }
  } finally {
    await shell.evaluate(
      (settings) => window.appBridge!.call('/appearance/set', settings),
      appearance,
    );
  }
});
