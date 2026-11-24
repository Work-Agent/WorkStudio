import { defineCase } from '../runner/contract.ts';
import { ensureHtmlFixture } from '../support/plugin-fixture.ts';

interface SkillInfo {
  name: string;
  pluginId: string;
  enabled?: boolean;
}

export default defineCase({
  id: 'plugin.skills',
  title: '插件技能进入 agent 技能目录并可激活',
  tags: ['dev', 'ci', 'mutating'],
  async run(ctx) {
    await ensureHtmlFixture(ctx);
    await ctx.expect.poll(async () => {
      const state = (await ctx.evaluate(() =>
        window.workStudio.subscribe('agent', 'skills'),
      )) as { catalog?: SkillInfo[] } | null;
      return Boolean(
        state?.catalog?.some(
          (skill) =>
            skill.name === 'html-viewer' && skill.pluginId === 'html-viewer',
        ),
      );
    }, '插件技能未进入目录');
    await ctx.evaluate(async () => {
      await window.workStudio.command('agent', 'skills', 'setActive', {
        names: ['html-viewer'],
      });
    });
    await ctx.expect.poll(async () => {
      const state = (await ctx.evaluate(() =>
        window.workStudio.subscribe('agent', 'skills'),
      )) as { active?: string[] } | null;
      return state?.active?.includes('html-viewer') === true;
    }, '插件技能未激活');
    await ctx.evaluate(async () => {
      await window.workStudio.command('agent', 'skills', 'setActive', {
        names: [],
      });
    });
  },
});
