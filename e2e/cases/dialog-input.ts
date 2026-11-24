import { defineCase } from '../runner/contract.ts';

interface DialogView {
  id: string;
  status: string;
  response?: { value?: string; confirmed?: boolean };
}

export default defineCase({
  id: 'dialog.input',
  title: '输入对话框提交值并结算',
  tags: ['dev', 'ci'],
  async run(ctx) {
    await ctx.legacyBridge.call('/dialogs/open', {
      request: {
        id: 'input-dialog',
        dialogType: 'input',
        title: '输入名称',
        placeholder: '名称',
      },
    });
    const overlay = await ctx.waitForPage(
      /^(work:\/\/studio\/overlay|.*pages\/overlay\/index\.html)/,
      { text: '输入名称' },
    );
    await overlay.evaluate(() => {
      const input = document.querySelector('input') as HTMLInputElement | null;
      if (!input) throw new Error('输入框不存在');
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(input, '回归输入');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await overlay.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find(
        (item) => item.textContent === '提交',
      ) as HTMLButtonElement | undefined;
      button?.click();
    });
    await ctx.expect.poll(async () => {
      const dialogs = await ctx.legacyBridge.peek<DialogView[]>('/dialogs');
      const dialog = dialogs?.find((item) => item.id === 'input-dialog');
      return (
        dialog?.status === 'resolved' && dialog.response?.value === '回归输入'
      );
    }, '输入值没有结算');
  },
});
