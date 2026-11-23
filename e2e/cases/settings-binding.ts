import { defineCase } from '../runner/contract.ts';

export default defineCase({
  id: 'settings.binding',
  title: 'URA 用户绑定可写入并删除',
  tags: ['dev', 'ci', 'mutating'],
  async run(ctx) {
    await ctx.legacyBridge.call('/settings/open', { pageId: 'preferences' });
    const page = await ctx.waitForPage(
      /^(work:\/\/studio\/settings|.*pages\/settings\/index\.html)/,
    );
    const mime = 'text/x-e2e-binding';
    await page.evaluate(async () => {
      await window.workStudio.command('settings', 'advanced', 'setBinding', {
        binding: {
          transport: 'file',
          mime: 'text/x-e2e-binding',
          codec: 'text',
        },
      });
    });
    await ctx.expect.poll(async () => {
      const bindings = (await page.evaluate(async () =>
        window.workStudio.subscribe('settings', 'advanced'),
      )) as { bindings?: Array<{ transport: string; mime: string }> };
      return (bindings.bindings ?? []).some(
        (binding) => binding.transport === 'file' && binding.mime === mime,
      );
    }, '绑定没有写入');
    await page.evaluate(async () => {
      await window.workStudio.command('settings', 'advanced', 'removeBinding', {
        transport: 'file',
        mime: 'text/x-e2e-binding',
      });
    });
  },
});
