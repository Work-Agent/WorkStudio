import type {
  AppearanceSettings,
  AppearanceSnapshot,
} from '../../../shared/appearance.ts';
import type { SettingsViewResult } from '../../agent/config-service.ts';
import type { DomainRegistry } from '../../runtime/domains.ts';

export interface SettingsPageInfo {
  id: string;
  label: string;
  desc: string;
  icon: string;
  internal?: boolean;
}

export interface SettingsStorageView {
  dataRoot: string;
  appPath: string;
  workspacePath: string;
  workspaceId: string;
  sceneFile: string;
  sessionsDir: string;
  versions: {
    app: string;
    electron: string;
    chrome: string;
    node: string;
  };
}

export interface SettingsSkillView {
  name: string;
  description: string;
  pluginName: string;
  pluginId?: string;
  scope: string;
  enabled?: boolean;
}

export interface SettingsPreferences {
  theme: 'light' | 'dark';
  locale: string | null;
  proxy: string | null;
  githubToken: string | null;
}

export interface SettingsExtension {
  source: string;
  scope: 'user' | 'project';
  installedPath?: string;
}

export interface SettingsDeps {
  pages(): SettingsPageInfo[];
  open(pageId: string): Promise<{ id: string }>;
  appearance(): AppearanceSnapshot;
  setAppearance(patch: Partial<AppearanceSettings>): AppearanceSnapshot;
  storage(): SettingsStorageView;
  openPath(path: string): void;
  changeDataRoot(): Promise<string | null>;
  changeSessionDir(): Promise<string | null>;
  resourceDiagnostics(): unknown;
  browser(): { allowlist: string[] };
  setBrowser(allowlist: string[]): { allowlist: string[] };
  preferences(): SettingsPreferences;
  setPreferences(patch: Partial<SettingsPreferences>): SettingsPreferences;
  advanced(): { settings: SettingsViewResult | null; bindings: unknown[] };
  setGlobalSetting(path: string, value: unknown): SettingsViewResult | null;
  setProjectSetting(path: string, value: unknown): SettingsViewResult | null;
  replaceSettings(
    scope: 'global' | 'project',
    value: Record<string, unknown>,
  ): SettingsViewResult | null;
  reloadAdvanced(): SettingsViewResult | null;
  setBinding(binding: unknown): Promise<unknown>;
  removeBinding(transport: string, mime: string): Promise<unknown>;
  extensions(): SettingsExtension[];
  installExtension(name: string): Promise<void>;
  removeExtension(source: string, scope: 'user' | 'project'): Promise<void>;
  searchExtensions(input: {
    query?: string;
    type?: string;
    page?: number;
  }): Promise<unknown>;
}

/** settings/pages：设置页清单与打开入口；页面数据由各自 domain 提供。 */
export function defineSettingsDomain(
  registry: DomainRegistry,
  deps: SettingsDeps,
): void {
  const domain = registry.define('settings');
  const resource = domain.resource('pages');
  resource.snapshot(() => deps.pages());
  resource.command<{ pageId: string }, { id: string }>('open', (call) =>
    deps.open(String(call.input.pageId)),
  );

  const appearance = domain.resource('appearance');
  appearance.snapshot(() => deps.appearance());
  appearance.command<Partial<AppearanceSettings>, AppearanceSnapshot>(
    'set',
    (call) => deps.setAppearance(call.input),
  );

  const storage = domain.resource('storage');
  storage.snapshot(() => deps.storage());
  storage.command<{ path: string }, null>('open', (call) => {
    deps.openPath(String(call.input.path));
    return null;
  });
  storage.command<null, string | null>('changeRoot', () =>
    deps.changeDataRoot(),
  );
  storage.command<null, string | null>('changeSessionDir', () =>
    deps.changeSessionDir(),
  );

  const browser = domain.resource('browser');
  browser.snapshot(() => deps.browser());
  browser.command<{ allowlist: string[] }, { allowlist: string[] }>(
    'set',
    (call) => deps.setBrowser(call.input.allowlist ?? []),
  );

  const preferences = domain.resource('preferences');
  preferences.snapshot(() => deps.preferences());
  preferences.command<Partial<SettingsPreferences>, SettingsPreferences>(
    'set',
    (call) => deps.setPreferences(call.input),
  );

  const advanced = domain.resource('advanced');
  advanced.snapshot(() => deps.advanced());
  advanced.command<{ path: string; value: unknown }, SettingsViewResult | null>(
    'setGlobal',
    (call) => deps.setGlobalSetting(call.input.path, call.input.value),
  );
  advanced.command<{ path: string; value: unknown }, SettingsViewResult | null>(
    'setProject',
    (call) => deps.setProjectSetting(call.input.path, call.input.value),
  );
  advanced.command<null, SettingsViewResult | null>('reload', () =>
    deps.reloadAdvanced(),
  );
  advanced.command<
    { scope: 'global' | 'project'; value: Record<string, unknown> },
    SettingsViewResult | null
  >('replace', (call) =>
    deps.replaceSettings(call.input.scope, call.input.value),
  );
  advanced.command<{ binding: unknown }, unknown>(
    'setBinding',
    async (call) => {
      const result = await deps.setBinding(call.input.binding);
      advanced.publish();
      return result;
    },
  );
  advanced.command<{ transport: string; mime: string }, unknown>(
    'removeBinding',
    async (call) => {
      const result = await deps.removeBinding(
        call.input.transport,
        call.input.mime,
      );
      advanced.publish();
      return result;
    },
  );

  const extensions = domain.resource('extensions');
  extensions.snapshot(() => deps.extensions());
  extensions.command<{ query?: string; type?: string; page?: number }, unknown>(
    'catalog',
    (call) => deps.searchExtensions(call.input),
  );
  extensions.command<{ name: string }, null>('install', async (call) => {
    await deps.installExtension(String(call.input.name));
    extensions.publish();
    return null;
  });
  extensions.command<{ source: string; scope: 'user' | 'project' }, null>(
    'remove',
    async (call) => {
      await deps.removeExtension(
        String(call.input.source),
        call.input.scope === 'project' ? 'project' : 'user',
      );
      extensions.publish();
      return null;
    },
  );

  const resourceInfo = domain.resource('resourceInfo');
  resourceInfo.snapshot(() => deps.resourceDiagnostics());
}
