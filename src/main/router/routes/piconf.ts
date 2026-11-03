import type {
  ModelConfigView,
  ProviderConfigView,
} from '../../../shared/types';
import type { RouteCall } from '../../core/types';
import type {
  PiConfArea,
  PiConfService,
  PiConfState,
} from '../../service/piconf';
import type { Router } from '../router';

// ─── piconf ─────────────────────────────────────────────

export function routesPiConf(r: Router, service: PiConfService): void {
  const state = r.state<PiConfState>('/');
  const changed = r.event<{ area: PiConfArea }>('/changed');

  const publish = (): void => state.publish(service.view());
  service.onChange((area) => {
    publish();
    changed.emit({ area });
  });
  publish();

  r.handle(
    '/settings/set-global',
    (call: RouteCall<{ path: string; value: unknown }>) =>
      service.setGlobal(call.input.path, call.input.value),
  );
  r.handle(
    '/settings/set-project',
    (call: RouteCall<{ path: string; value: unknown }>) =>
      service.setProject(call.input.path, call.input.value),
  );
  r.handle('/settings/reload', () => service.reloadSettings());
  r.handle('/models/providers', () => service.providers());
  r.handle('/models/catalog', () => service.catalog());
  r.handle(
    '/models/login',
    async (
      call: RouteCall<{
        providerId: string;
        type: 'api_key' | 'oauth';
        apiKey?: string;
      }>,
    ) => service.loginProvider(call.input),
  );
  r.handle('/models/logout', (call: RouteCall<{ providerId: string }>) =>
    service.logoutProvider(call.input.providerId),
  );
  r.handle(
    '/agent/configure',
    (
      call: RouteCall<{
        provider?: string;
        modelId?: string;
        apiKey?: string;
        thinkingLevel?: import('../../../shared/types').ThinkingLevel;
      }>,
    ) => service.configure(call.input),
  );
  r.handle('/agent/thinking-levels', () => service.thinkingLevels());
  r.handle(
    '/models/save-provider',
    async (
      call: RouteCall<{ providerId: string; config: ProviderConfigView }>,
    ) => {
      await service.saveProvider(call.input.providerId, call.input.config);
      return service.view().models;
    },
  );
  r.handle(
    '/models/delete-provider',
    async (call: RouteCall<{ providerId: string }>) => {
      await service.deleteProvider(call.input.providerId);
      return service.view().models;
    },
  );
  r.handle(
    '/models/save-model',
    async (call: RouteCall<{ providerId: string; model: ModelConfigView }>) => {
      await service.saveModel(call.input.providerId, call.input.model);
      return service.view().models;
    },
  );
  r.handle(
    '/models/delete-model',
    async (call: RouteCall<{ providerId: string; modelId: string }>) => {
      await service.deleteModel(call.input.providerId, call.input.modelId);
      return service.view().models;
    },
  );
  r.handle('/welcome', () => service.welcomeState());
  r.handle('/ura/registry', () => service.uraRegistry());
  r.handle('/ura/bindings', () => service.bindings());
  r.handle(
    '/ura/bindings/set',
    (call: RouteCall<{ binding: import('../../../shared/ura').Binding }>) =>
      service.setBinding(call.input.binding),
  );
  r.handle(
    '/ura/bindings/remove',
    (call: RouteCall<{ transport: string; mime: string }>) =>
      service.removeBinding(call.input.transport, call.input.mime),
  );
  r.handle('/skills/view', () => service.skillsView());
  r.handle('/skills/reload', () => service.reloadSkills());
  r.handle(
    '/packages/catalog',
    (call: RouteCall<{ query?: string; type?: string; page?: number }>) =>
      service.packagesCatalog(call.input),
  );
  r.handle('/packages/list', () => service.packagesList());
  r.handle('/packages/loaded', () => service.packagesLoaded());
  r.handle('/packages/install', async (call: RouteCall<{ name: string }>) => {
    await service.installPackage(call.input.name);
    return { ok: true };
  });
  r.handle(
    '/packages/remove',
    (call: RouteCall<{ source: string; scope: 'user' | 'project' }>) =>
      service.removePackage(call.input.source, call.input.scope),
  );
  r.handle('/skills/set-active', (call: RouteCall<{ names: string[] }>) => ({
    active: service.setActiveSkills(call.input.names),
  }));
  r.handle('/refresh', () => {
    publish();
    return { ok: true };
  });
}
