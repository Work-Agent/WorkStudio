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
    // 路线决定文案：API Key 只是配置，登录才是登录。
    const loginUrl = loginUrlOf(configs[p.id]);
    // 声明了授权页的供应商只有登录：凭证由登录回调交回，不开 API Key 路线。
    const authTypes: ProviderAuthType[] = loginUrl
      ? ['oauth']
      : [
          ...(p.auth.oauth ? (['oauth'] as const) : []),
          ...(p.auth.apiKey ? (['api_key'] as const) : []),
        ];
    const authType: ProviderAuthType | undefined = !status.configured
      ? undefined
      : status.source === 'environment'
        ? 'environment'
        : loginUrl || runtime.isUsingOAuth(p.id)
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
    // 有授权页的供应商是宿主的账号入口，始终置顶（未配置也在最上面）。
    if (Boolean(a.loginUrl) !== Boolean(b.loginUrl)) {
      return a.loginUrl ? -1 : 1;
    }
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
  config: ProviderConfigView | undefined,
): string | undefined {
  const declared = config?.['loginUrl'];
  return typeof declared === 'string' && /^https?:\/\//i.test(declared)
    ? declared
    : undefined;
}

/** 声明了授权页的供应商只走登录；API Key 配置入口用同一判据拒绝。 */
export function isLoginOnly(config: ProviderConfigView | undefined): boolean {
  return loginUrlOf(config) !== undefined;
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
