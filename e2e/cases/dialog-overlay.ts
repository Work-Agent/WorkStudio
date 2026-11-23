import { defineCase } from '../runner/contract.ts';

interface DialogInfo {
  id: string;
  status: string;
}

export default defineCase({
  id: 'dialog.overlay',
  title: '对话框请求经 overlay 状态展示并能应答',
  tags: ['dev', 'ci'],
  async run(ctx) {
    await ctx.legacyBridge.call('/dialogs/open', {
      request: {
        type: 'dialog',
        id: 'regression-dialog',
        dialogType: 'confirm',
        title: '回归对话框',
        message: '请确认',
      },
    });

    const overlay = await ctx.waitForPage(
      /^(work:\/\/studio\/overlay|.*pages\/overlay\/index\.html)/,
      {
        text: '回归对话框',
      },
    );
    await overlay.expect.text('body', '回归对话框');
    await overlay.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find(
        (item) => item.textContent === '确认',
      ) as HTMLButtonElement | undefined;
      button?.click();
    });

    await ctx.expect.poll(async () => {
      const dialogs = await ctx.legacyBridge.peek<DialogInfo[]>('/dialogs');
      return (
        dialogs?.find((item) => item.id === 'regression-dialog')?.status ===
        'resolved'
      );
    }, '对话框未结算为 resolved');
  },
});
