import type {
  AppearanceSettings,
  AppearanceSnapshot,
} from '../../shared/appearance.ts';
import type { UpdateStatus } from '../modules/updates/updater.ts';
import type { SettingsViewResult } from '../modules/agent/config-service.ts';
import type { DomainRegistry } from '../runtime/domains.ts';

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
  reloadSkills(): Promise<void>;
  skillDiagnostics(): Array<{ type: string; message: string; path?: string }>;
  openPlugin(pluginId: string): Promise<void>;
  resourceDiagnostics(): unknown;
  browser(): { allowlist: string[] };
  setBrowser(allowlist: string[]): { allowlist: string[] };
  skills(): SettingsSkillView[];
  setSkillEnabled(name: string, enabled: boolean): void;
  preferences(): SettingsPreferences;
  setPreferences(patch: Partial<SettingsPreferences>): SettingsPreferences;
  models(): unknown;
  loginProvider(input: {
    providerId: string;
    type: 'api_key' | 'oauth';
    apiKey?: string;
  }): Promise<void>;
  logoutProvider(providerId: string): Promise<void>;
  saveProvider(providerId: string, config: unknown): Promise<void>;
  deleteProvider(providerId: string): Promise<void>;
  saveModel(providerId: string, model: unknown): Promise<void>;
  deleteModel(providerId: string, modelId: string): Promise<void>;
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

  const skills = domain.resource('skills');
  skills.snapshot(() => deps.skills());
  skills.command<null, null>('reload', async () => {
    await deps.reloadSkills();
    skills.publish();
    return null;
  });
  skills.command<null, Array<{ type: string; message: string; path?: string }>>(
    'diagnostics',
    () => deps.skillDiagnostics(),
  );
  skills.command<{ pluginId: string }, null>('openPlugin', async (call) => {
    await deps.openPlugin(String(call.input.pluginId));
    return null;
  });
  skills.command<{ name: string; enabled: boolean }, null>(
    'setEnabled',
    (call) => {
      deps.setSkillEnabled(
        String(call.input.name),
        Boolean(call.input.enabled),
      );
      return null;
    },
  );

  const preferences = domain.resource('preferences');
  preferences.snapshot(() => deps.preferences());
  preferences.command<Partial<SettingsPreferences>, SettingsPreferences>(
    'set',
    (call) => deps.setPreferences(call.input),
  );

  const models = domain.resource('models');
  models.snapshot(() => deps.models());
  models.command<
    { providerId: string; type: 'api_key' | 'oauth'; apiKey?: string },
    null
  >('login', async (call) => {
    await deps.loginProvider(call.input);
    models.publish();
    return null;
  });
  models.command<{ providerId: string }, null>('logout', async (call) => {
    await deps.logoutProvider(String(call.input.providerId));
    models.publish();
    return null;
  });
  models.command<{ providerId: string; config: unknown }, null>(
    'saveProvider',
    async (call) => {
      await deps.saveProvider(String(call.input.providerId), call.input.config);
      models.publish();
      return null;
    },
  );
  models.command<{ providerId: string }, null>(
    'deleteProvider',
    async (call) => {
      await deps.deleteProvider(String(call.input.providerId));
      models.publish();
      return null;
    },
  );
  models.command<{ providerId: string; model: unknown }, null>(
    'saveModel',
    async (call) => {
      await deps.saveModel(String(call.input.providerId), call.input.model);
      models.publish();
      return null;
    },
  );
  models.command<{ providerId: string; modelId: string }, null>(
    'deleteModel',
    async (call) => {
      await deps.deleteModel(
        String(call.input.providerId),
        String(call.input.modelId),
      );
      models.publish();
      return null;
    },
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
