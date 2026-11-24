import { defineCase } from '../runner/contract.ts';

interface LayoutRecord {
  windowId: string;
  scene?: { sidebarCollapsed?: boolean; aiOpen?: boolean };
  snapshot?: {
    window?: { width: number; height: number };
    sidebar?: { width: number };
    resourcePane?: { width: number };
    assistantVisible?: boolean;
  };
}

export default defineCase({
  id: 'window.defaults',
  title: '主窗口默认尺寸、标题与三栏布局',
  tags: ['dev', 'ci'],
  async run(ctx) {
    const view = await ctx.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      title: document.title,
      sidebarWidth: getComputedStyle(document.documentElement).getPropertyValue(
        '--wb-sidebar-w',
      ),
      resourceWidth: getComputedStyle(
        document.documentElement,
      ).getPropertyValue('--wb-resource-w'),
    }));
    if (view.width !== 1440 || view.height !== 900) {
      throw new Error(`默认窗口尺寸错误：${view.width}×${view.height}`);
    }
    if (view.title !== 'WorkStudio') {
      throw new Error(`默认窗口标题错误：${view.title}`);
    }
    if (view.sidebarWidth.trim() !== '240px') {
      throw new Error(`默认侧栏宽度错误：${view.sidebarWidth}`);
    }
    if (view.resourceWidth.trim() !== '780px') {
      throw new Error(`默认资源宽度错误：${view.resourceWidth}`);
    }
    const urls = await ctx.windowUrls();
    for (const suffix of ['/shell', '/assistant', '/overlay']) {
      if (!urls.some((url) => url.endsWith(suffix))) {
        throw new Error(`缺少系统视图：${suffix}`);
      }
    }
    await ctx.expect.poll(async () => {
      const records = (await ctx.evaluate(() =>
        window.workStudio.subscribe('shell', 'layout'),
      )) as LayoutRecord[];
      const record = records[0];
      return (
        record?.snapshot?.assistantVisible === true &&
        record.snapshot.window?.width === 1440 &&
        record.snapshot.sidebar?.width === 240
      );
    }, '默认布局快照不正确');
  },
});
