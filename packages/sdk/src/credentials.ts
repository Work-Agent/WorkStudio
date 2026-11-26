/**
 * 供应商凭证：插件把授权页拿到的 token 交给宿主，只写不读。
 *
 * 权限由清单声明（`workstudio.credentials`）界定：插件只能操作自己声明的
 * 供应商；凭证值留在主进程，插件拿不到已存凭证。
 */

/** 授权页交回的凭证：至少一个 accessToken。 */
export interface ProviderCredentialInput {
  accessToken: string;
  refreshToken?: string;
  /** 有效期（秒），对应 OAuth 页面常见的 expires_in。 */
  expiresIn?: number;
  /** 供应商特有的附加字段，原样写入 OAuth 凭证。 */
  extra?: Record<string, unknown>;
}

export interface PluginCredentials {
  /** 写入凭证：provider 必须存在且已在清单里声明。 */
  write(providerId: string, input: ProviderCredentialInput): Promise<void>;
  /** 清除凭证（等价于退出登录）。 */
  clear(providerId: string): Promise<void>;
}
