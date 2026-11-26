import { defineCase } from '../runner/contract.ts';

interface ModelsConfig {
  providers: Record<
    string,
    { baseUrl?: string; models?: Array<{ id: string; name?: string }> }
  >;
}

interface ProviderModels {
  providerId: string;
  catalog: Array<{ modelId: string }>;
  configured: Array<{ id: string; name?: string }>;
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

    // API Key 是配置而非登录：配置后 authType 为 api_key，清除后回到未配置。
    await ctx.evaluate(async (providerId) => {
      const result = await window.workStudio.command(
        'agent',
        `provider/${providerId}`,
        'configureApiKey',
        { apiKey: 'e2e-api-key' },
      );
      if (!result.ok) throw new Error(result.error.message);
    }, PROVIDER);

    await ctx.expect.poll(async () => {
      const providers = (await ctx.evaluate(() =>
        window.workStudio.subscribe('agent', 'providers'),
      )) as Array<{ id: string; authType?: string }> | null;
      const provider = providers?.find((item) => item.id === PROVIDER);
      return provider?.authType === 'api_key';
    }, 'API Key 配置后 authType 不是 api_key');

    await ctx.evaluate(async (providerId) => {
      const result = await window.workStudio.command(
        'agent',
        `provider/${providerId}`,
        'logout',
        {},
      );
      if (!result.ok) throw new Error(result.error.message);
    }, PROVIDER);

    await ctx.expect.poll(async () => {
      const providers = (await ctx.evaluate(() =>
        window.workStudio.subscribe('agent', 'providers'),
      )) as Array<{
        id: string;
        authType?: string;
        configured: boolean;
      }> | null;
      const provider = providers?.find((item) => item.id === PROVIDER);
      return Boolean(provider && !provider.configured && !provider.authType);
    }, '清除 API Key 后仍未回到未配置状态');

    // 供应商作用域的模型视图：模型挂在供应商下，命令不需要再传 providerId。
    await ctx.expect.poll(async () => {
      const scoped = (await ctx.evaluate(
        () =>
          window.workStudio.subscribe(
            'agent',
            'provider/e2e-models-provider/models',
          ) as Promise<ProviderModels | null> | ProviderModels | null,
      )) as ProviderModels | null;
      return Boolean(
        scoped?.providerId === 'e2e-models-provider' &&
        scoped.configured.some((model) => model.id === 'e2e-models-model'),
      );
    }, 'provider/<id>/models 未包含该供应商的模型');

    await ctx.evaluate(async (providerId) => {
      const saved = await window.workStudio.command(
        'agent',
        `provider/${providerId}/models`,
        'save',
        { modelId: 'e2e-models-model', config: { name: 'E2E Scoped' } },
      );
      if (!saved.ok) throw new Error(saved.error.message);
    }, PROVIDER);

    await ctx.expect.poll(async () => {
      const state = await config();
      return Boolean(
        state?.providers[PROVIDER]?.models?.some(
          (model) => model.id === MODEL && model.name === 'E2E Scoped',
        ),
      );
    }, '作用域命令未更新模型');

    await ctx.evaluate(async (providerId) => {
      const model = await window.workStudio.command(
        'agent',
        `provider/${providerId}/models`,
        'delete',
        { modelId: 'e2e-models-model' },
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
