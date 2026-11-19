import type { DomainRegistry } from '../runtime/domains.ts';
import type {
  MenuItem,
  SaveFileOptions,
  SystemActions,
} from '../runtime/native.ts';

/** native/app：一次性系统动作，无持久状态。 */
export function defineNativeDomain(
  registry: DomainRegistry,
  actions: SystemActions,
): void {
  const resource = registry.define('native').resource('app');
  resource.command<{ path?: string }, null>('openPath', (call) => {
    actions.openPath(String(call.input?.path ?? ''));
    return null;
  });
  resource.command<{ url?: string }, null>('openExternal', (call) => {
    actions.openExternal(String(call.input?.url ?? ''));
    return null;
  });
  resource.command<{ wsId?: string | null }, string | null>(
    'pickDirectory',
    (call) => actions.pickDirectory(call.input?.wsId ?? undefined),
  );
  resource.command<{ wsId?: string | null } & SaveFileOptions, string | null>(
    'pickSaveFile',
    (call) => actions.pickSaveFile(call.input?.wsId ?? null, call.input ?? {}),
  );
  resource.command<{ wsId?: string | null; items?: MenuItem[] }, string | null>(
    'popupMenu',
    (call) =>
      actions.popupMenu(call.input?.wsId ?? null, call.input?.items ?? []),
  );
}
