/** 模型目录投影（供应商 / 模型 / 凭证状态），纯函数不持有 runtime。 */
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { ModelCatalogItem, ProviderInfoView } from '../../shared/types';

export function providerCatalog(
  runtime: ModelRuntime,
  customProviderIds: string[],
): ProviderInfoView[] {
  const custom = new Set(customProviderIds);
  const available = new Set(
    runtime.getAvailableSnapshot().map((m) => `${m.provider}/${m.id}`),
  );
  const list = runtime.getProviders().map((p): ProviderInfoView => {
    const status = runtime.getProviderAuthStatus(p.id);
    const models = p.getModels();
    return {
      id: p.id,
      name: p.name,
      builtin: !custom.has(p.id),
      ...(p.baseUrl ? { baseUrl: p.baseUrl } : {}),
      configured: status.configured,
      ...(status.source ? { authSource: status.source } : {}),
      ...(status.label ? { authLabel: status.label } : {}),
      hasApiKeyAuth: !!p.auth.apiKey,
      hasOAuthAuth: !!p.auth.oauth,
      canApiKeyLogin: !!p.auth.apiKey?.login,
      canOAuthLogin: !!p.auth.oauth?.login,
      modelCount: models.length,
      availableModelCount: models.filter((m) =>
        available.has(`${p.id}/${m.id}`),
      ).length,
    };
  });
  return list.sort((a, b) => {
    if (a.configured !== b.configured) return a.configured ? -1 : 1;
    if (a.builtin !== b.builtin) return a.builtin ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export function modelCatalog(runtime: ModelRuntime): ModelCatalogItem[] {
  const available = new Set(
    runtime.getAvailableSnapshot().map((m) => `${m.provider}/${m.id}`),
  );
  const out: ModelCatalogItem[] = [];
  for (const p of runtime.getProviders()) {
    for (const m of p.getModels()) {
      out.push({
        provider: p.id,
        modelId: m.id,
        label: m.name ?? m.id,
        reasoning: m.reasoning,
        ...(m.input ? { input: [...m.input] } : {}),
        ...(m.contextWindow ? { contextWindow: m.contextWindow } : {}),
        ...(m.maxTokens ? { maxTokens: m.maxTokens } : {}),
        ...(m.cost
          ? {
              cost: {
                input: m.cost.input,
                output: m.cost.output,
                cacheRead: m.cost.cacheRead,
                cacheWrite: m.cost.cacheWrite,
              },
            }
          : {}),
        available: available.has(`${p.id}/${m.id}`),
      });
    }
  }
  return out;
}
