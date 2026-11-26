/**
 * pi 供应商凭证：每个供应商一个密钥域（`provider:<host>`，用它的域名做 key），
 * 域内一条记录。只实现 pi 的 CredentialStore 形状（读 / 列表 / 读改写 / 删除），
 * 存储与域名校验由 `SecretVault` 负责；凭证值永不进快照或日志。
 */
import { existsSync, readFileSync, renameSync } from 'node:fs';
import type {
  AuthOperationOptions,
  Credential,
  CredentialInfo,
  CredentialStore,
} from '@earendil-works/pi-ai';
import type { SecretVault, VaultScope } from '../../../platform/vault.ts';

/** 域内固定 key：一个供应商域只放它自己的凭证。 */
const CREDENTIAL_KEY = 'credential';

export interface AgentCredentialDomains {
  /** providerId → 它的域名（host）；取不到时回落到 providerId。 */
  hostOf(providerId: string): string | undefined;
  /** 已知 providerId，用于 list() 枚举。 */
  providerIds(): string[];
}

export class AgentCredentials implements CredentialStore {
  private readonly chains = new Map<string, Promise<unknown>>();
  private readonly scopes = new Map<string, VaultScope>();

  constructor(
    private readonly vault: SecretVault,
    private readonly domains: AgentCredentialDomains,
  ) {}

  /** 供应商自己的域；域名不合规时这里就会抛错，不会落到别人的域。 */
  private scopeOf(providerId: string): VaultScope {
    const cached = this.scopes.get(providerId);
    if (cached) return cached;
    const host = this.domains.hostOf(providerId) ?? providerId;
    const scope = this.vault.forProvider(host);
    this.scopes.set(providerId, scope);
    return scope;
  }

  async read(
    providerId: string,
    _options?: AuthOperationOptions,
  ): Promise<Credential | undefined> {
    const raw = await this.scopeOf(providerId).get(CREDENTIAL_KEY);
    return raw ? parseCredential(raw) : undefined;
  }

  async list(
    _options?: AuthOperationOptions,
  ): Promise<readonly CredentialInfo[]> {
    const out: CredentialInfo[] = [];
    for (const providerId of this.domains.providerIds()) {
      const credential = await this.read(providerId);
      if (credential) out.push({ providerId, type: credential.type });
    }
    return out;
  }

  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    _options?: AuthOperationOptions,
  ): Promise<Credential | undefined> {
    return this.enqueue(providerId, async () => {
      const scope = this.scopeOf(providerId);
      const raw = await scope.get(CREDENTIAL_KEY);
      const current = raw ? parseCredential(raw) : undefined;
      const next = await fn(current);
      if (next === undefined) return current;
      await scope.set(CREDENTIAL_KEY, JSON.stringify(next));
      return next;
    });
  }

  delete(providerId: string, _options?: AuthOperationOptions): Promise<void> {
    return this.enqueue(providerId, async () => {
      await this.scopeOf(providerId).set(CREDENTIAL_KEY, null);
    });
  }

  private enqueue<T>(providerId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(providerId) ?? Promise.resolve();
    const next = previous.then(task, task);
    this.chains.set(
      providerId,
      next.catch(() => undefined),
    );
    return next;
  }
}

/**
 * 一次性迁移：把旧版 `agent` 域里的 `provider:<id>` 搬到各供应商自己的域。
 * 只补缺失项，成功后删掉旧 key。
 */
export async function migrateAgentDomain(
  vault: SecretVault,
  credentials: AgentCredentials,
): Promise<void> {
  const legacy = vault.forAgent();
  for (const key of await legacy.keys()) {
    const providerId = key.startsWith('provider:')
      ? key.slice('provider:'.length)
      : '';
    if (!providerId) continue;
    const raw = await legacy.get(key);
    if (!raw) continue;
    await credentials.modify(
      providerId,
      async (current) => current ?? parseCredential(raw),
    );
    await legacy.set(key, null);
  }
}

/**
 * 一次性迁移：把旧版明文 `auth.json` 里的凭证搬进密钥库。
 *
 * 只补缺失项，成功后把文件改名留档，避免每次启动重复导入；
 * 迁移失败不阻塞启动（凭证可重新注入）。
 */
export function migrateLegacyAuthFile(
  credentials: AgentCredentials,
  file: string,
): void {
  if (!existsSync(file)) return;
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as Record<
      string,
      Credential
    >;
    for (const [providerId, credential] of Object.entries(raw ?? {})) {
      if (!credential || typeof credential !== 'object') continue;
      void credentials.modify(
        providerId,
        async (current) => current ?? credential,
      );
    }
    renameSync(file, `${file}.imported`);
  } catch {
    // 旧文件不可读就留着，交给用户重新配置。
  }
}

function parseCredential(raw: string): Credential | undefined {
  try {
    const value = JSON.parse(raw) as Credential;
    return value && typeof value === 'object' && value.type ? value : undefined;
  } catch {
    return undefined;
  }
}
