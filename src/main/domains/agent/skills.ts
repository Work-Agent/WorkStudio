import type { DomainRegistry } from '../../runtime/domains.ts';

export interface SkillsDeps {
  ensure(): Promise<void>;
  active(): string[];
  setActive(names: string[]): string[];
  catalog(): unknown[];
  reload(): Promise<void>;
  diagnostics(): Array<{ type: string; message: string; path?: string }>;
  openPlugin(pluginId: string): Promise<void>;
  setEnabled(name: string, enabled: boolean): void;
}

/** skills：激活集合、技能清单、诊断与启用策略。 */
export function defineSkillsDomain(
  registry: DomainRegistry,
  deps: SkillsDeps,
): void {
  const domain = registry.define('skills');

  const active = domain.resource('active');
  active.snapshot(() => deps.active());
  active.command<{ names: string[] }, string[]>('setActive', (call) =>
    deps.setActive(call.input.names ?? []),
  );

  const catalog = domain.resource('catalog');
  catalog.snapshot(() => {
    void deps.ensure().catch(() => undefined);
    return deps.catalog();
  });
  catalog.command<null, null>('reload', async () => {
    await deps.ensure();
    await deps.reload();
    catalog.publish();
    return null;
  });
  catalog.command<
    null,
    Array<{ type: string; message: string; path?: string }>
  >('diagnostics', () => deps.diagnostics());
  catalog.command<{ pluginId: string }, null>('openPlugin', async (call) => {
    await deps.openPlugin(String(call.input.pluginId));
    return null;
  });
  catalog.command<{ name: string; enabled: boolean }, null>(
    'setEnabled',
    (call) => {
      deps.setEnabled(String(call.input.name), Boolean(call.input.enabled));
      catalog.publish();
      return null;
    },
  );
}
