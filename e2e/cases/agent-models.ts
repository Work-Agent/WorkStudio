import { defineCase } from '../runner/contract.ts';

interface ModelsConfig {
  providers: Record<
    string,
    { baseUrl?: string; models?: Array<{ id: string; name?: string }> }
  >;
}

const PROVIDER = 'e2e-models-provider';
const MODEL = 'e2e-models-model';

export default defineCase({
  id: 'agent.models',
  title: '模型设置可保存、列出并删除自定义供应商与模型',
  tags: ['dev', 'ci'],
  async run(ctx) {
    const config = (): Promise<ModelsConfig | null> =>
      ctx.evaluate(
        () =>
          window.workStudio.subscribe(
            'agent',
            'modelsConfig',
          ) as Promise<ModelsConfig | null>,
      );

    await ctx.evaluate(async (providerId) => {
      const result = await window.workStudio.command(
        'agent',
        'providers',
        'save',
        {
          providerId,
          config: { baseUrl: 'https://e2e.example.com/v1' },
        },
      );
      if (!result.ok) throw new Error(result.error.message);
      const model = await window.workStudio.command('agent', 'models', 'save', {
        providerId,
        modelId: 'e2e-models-model',
        config: { name: 'E2E Model' },
      });
      if (!model.ok) throw new Error(model.error.message);
    }, PROVIDER);

    await ctx.expect.poll(async () => {
      const state = await config();
      return Boolean(
        state?.providers[PROVIDER]?.baseUrl &&
        state.providers[PROVIDER]?.models?.some(
          (model) => model.id === MODEL && model.name === 'E2E Model',
        ),
      );
    }, 'modelsConfig 未包含自定义供应商或模型');

    await ctx.evaluate(async (providerId) => {
      const model = await window.workStudio.command(
        'agent',
        'models',
        'delete',
        {
          providerId,
          modelId: 'e2e-models-model',
        },
      );
      if (!model.ok) throw new Error(model.error.message);
      const provider = await window.workStudio.command(
        'agent',
        'providers',
        'delete',
        { providerId },
      );
      if (!provider.ok) throw new Error(provider.error.message);
    }, PROVIDER);

    await ctx.expect.poll(async () => {
      const state = await config();
      return !state?.providers[PROVIDER];
    }, '自定义供应商删除后仍残留');
  },
});
