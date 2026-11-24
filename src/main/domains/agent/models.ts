import type { ModelOption } from '../../../shared/types.ts';
import type { DomainRegistry } from '../../runtime/domains.ts';

export interface ModelsDeps {
  ensure(): Promise<void>;
  available(): ModelOption[];
  config(): unknown;
  login(input: {
    providerId: string;
    type: 'api_key' | 'oauth';
    apiKey?: string;
  }): Promise<void>;
  logout(providerId: string): Promise<void>;
  saveProvider(providerId: string, config: unknown): Promise<void>;
  deleteProvider(providerId: string): Promise<void>;
  saveModel(providerId: string, model: unknown): Promise<void>;
  deleteModel(providerId: string, modelId: string): Promise<void>;
}

/** models：可用模型目录、供应商配置与登录。 */
export function defineModelsDomain(
  registry: DomainRegistry,
  deps: ModelsDeps,
): void {
  const domain = registry.define('models');
  const available = domain.resource('available');
  available.snapshot(() => {
    void deps.ensure().catch(() => undefined);
    return deps.available();
  });

  const config = domain.resource('config');
  config.snapshot(() => {
    void deps.ensure().catch(() => undefined);
    return deps.config();
  });
  config.command<
    { providerId: string; type: 'api_key' | 'oauth'; apiKey?: string },
    null
  >('login', async (call) => {
    await deps.ensure();
    await deps.login(call.input);
    config.publish();
    return null;
  });
  config.command<{ providerId: string }, null>('logout', async (call) => {
    await deps.ensure();
    await deps.logout(String(call.input.providerId));
    config.publish();
    return null;
  });
  config.command<{ providerId: string; config: unknown }, null>(
    'saveProvider',
    async (call) => {
      await deps.ensure();
      await deps.saveProvider(String(call.input.providerId), call.input.config);
      config.publish();
      return null;
    },
  );
  config.command<{ providerId: string }, null>(
    'deleteProvider',
    async (call) => {
      await deps.ensure();
      await deps.deleteProvider(String(call.input.providerId));
      config.publish();
      return null;
    },
  );
  config.command<{ providerId: string; model: unknown }, null>(
    'saveModel',
    async (call) => {
      await deps.ensure();
      await deps.saveModel(String(call.input.providerId), call.input.model);
      config.publish();
      return null;
    },
  );
  config.command<{ providerId: string; modelId: string }, null>(
    'deleteModel',
    async (call) => {
      await deps.ensure();
      await deps.deleteModel(
        String(call.input.providerId),
        String(call.input.modelId),
      );
      config.publish();
      return null;
    },
  );
}
