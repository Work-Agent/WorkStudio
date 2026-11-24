import { defineCase } from '../runner/contract.ts';

interface DialogView {
  id: string;
  status: string;
  response?: { value?: string };
}

export default defineCase({
  id: 'dialog.select',
  title: '选择对话框返回选中项',
  tags: ['dev', 'ci'],
  async run(ctx) {
    await ctx.legacyBridge.call('/dialogs/open', {
      request: {
        id: 'select-dialog',
        dialogType: 'select',
        title: '选择一项',
        options: ['甲', '乙'],
      },
    });
    const overlay = await ctx.waitForPage(
      /^(work:\/\/studio\/overlay|.*pages\/overlay\/index\.html)/,
      { text: '选择一项' },
    );
    await overlay.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find(
        (item) => item.textContent === '乙',
      ) as HTMLButtonElement | undefined;
      button?.click();
    });
    await ctx.expect.poll(async () => {
      const dialogs = await ctx.legacyBridge.peek<DialogView[]>('/dialogs');
      const dialog = dialogs?.find((item) => item.id === 'select-dialog');
      return dialog?.status === 'resolved' && dialog.response?.value === '乙';
    }, '选择结果没有结算');
  },
});
