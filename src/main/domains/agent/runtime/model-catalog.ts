/** 模型目录投影（供应商 / 模型 / 凭证状态），纯函数不持有 runtime。 */
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type {
  ModelCatalogItem,
  ProviderAuthType,
  ProviderConfigView,
  ProviderInfoView,
} from '../../../../shared/types.ts';

export function providerCatalog(
  runtime: ModelRuntime,
  customProviderIds: string[],
  configs: Record<string, ProviderConfigView> = {},
): ProviderInfoView[] {
  const custom = new Set(customProviderIds);
  const available = new Set(
    runtime.getAvailableSnapshot().map((m) => `${m.provider}/${m.id}`),
  );
  const list = runtime.getProviders().map((p): ProviderInfoView => {
    const status = runtime.getProviderAuthStatus(p.id);
    const models = p.getModels();
    // 路线决定文案：API Key 只是配置，OAuth 才是登录。
    const authTypes: ProviderAuthType[] = [];
    if (p.auth.oauth) authTypes.push('oauth');
    if (p.auth.apiKey) authTypes.push('api_key');
    const loginUrl = loginUrlOf(p.baseUrl, configs[p.id]);
    const authType: ProviderAuthType | undefined = !status.configured
      ? undefined
      : status.source === 'environment'
        ? 'environment'
        : runtime.isUsingOAuth(p.id)
          ? 'oauth'
          : 'api_key';
    return {
      id: p.id,
      name: p.name,
      builtin: !custom.has(p.id),
      ...(p.baseUrl ? { baseUrl: p.baseUrl } : {}),
      configured: status.configured,
      ...(status.source ? { authSource: status.source } : {}),
      ...(status.label ? { authLabel: status.label } : {}),
      authTypes,
      ...(loginUrl ? { loginUrl } : {}),
      ...(authType ? { authType } : {}),
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

/**
 * 授权页地址：只有配置里**显式声明** `loginUrl` 的供应商才有页面登录流程
 * （自有服务 / one-api 这类）。内置大厂 OAuth 没有可声明的登录页，交给
 * pi 的 OAuth 流程（本地回环回调），不能拿 baseUrl 推导出一个假的登录页。
 */
function loginUrlOf(
  _baseUrl: string | undefined,
  config: ProviderConfigView | undefined,
): string | undefined {
  const declared = config?.['loginUrl'];
  return typeof declared === 'string' && /^https?:\/\//i.test(declared)
    ? declared
    : undefined;
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
