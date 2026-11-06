import { readWorkspacePolicy, writeWorkspacePolicy } from '../preferences';
/**
 * pi 配置业务：设置三层 · 模型 · 包 · 技能。
 * 路径绑定在 routes.ts。
 */

import type {
  ModelConfigStore,
  SettingsService,
  SettingsViewResult,
} from '../agent/config-service';
import type {
  ConfiguredPackageView,
  PiPackageService,
} from '../agent/package-service';
import type { SkillInfoView, SkillsManager } from '../harness/skills';
import type {
  AgentSnapshot,
  ModelCatalogItem,
  ModelConfigView,
  ModelsConfigView,
  ProviderConfigView,
  ProviderInfoView,
  ThinkingLevel,
} from '../../shared/types';
import type { AgentHost } from '../agent/agent-host';
import type { Ura } from '../ura/facade';
import { basename } from 'node:path';
import { uraRegistry } from '../ura/registry';
import type { Binding } from '../../shared/ura';

export interface PiConfDeps {
  settings: SettingsService;
  workspaceId?: () => string;
  models: ModelConfigStore;
  packages: PiPackageService;
  skills: SkillsManager;
  agent: AgentHost;
  ura: Ura;
}

export interface PiConfState {
  settings: SettingsViewResult;
  models: ModelsConfigView;
  packages: ConfiguredPackageView[];
  skills: SkillInfoView[];
}

export type PiConfArea = 'settings' | 'models' | 'packages' | 'skills';

export class PiConfService {
  private readonly changeListeners = new Set<(area: PiConfArea) => void>();
  private settings: SettingsService;

  constructor(private readonly deps: PiConfDeps) {
    this.settings = deps.settings;
  }

  /** 工作区切换：project 层 settings 文件随工作区更换。 */
  setSettings(settings: SettingsService): void {
    this.settings = settings;
    this.emitChange('settings');
  }

  onChange(listener: (area: PiConfArea) => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  view(): PiConfState {
    return {
      settings: this.settings.view(),
      models: this.deps.models.readView(),
      packages: this.deps.packages.listConfigured(),
      skills: this.deps.skills.getSkillInfos(),
    };
  }

  setGlobal(path: string, value: unknown): SettingsViewResult {
    if (path === 'sessionDir' && this.deps.agent.getSnapshot().isStreaming)
      throw new Error('请先结束当前任务，再更改会话目录');
    const result = this.settings.setGlobal(path, value);
    if (path === 'sessionDir') void this.deps.agent.rebuildForWorkspace();
    this.emitChange('settings');
    return result;
  }

  setProject(path: string, value: unknown): SettingsViewResult {
    const result = this.settings.setProject(path, value);
    this.emitChange('settings');
    return result;
  }

  reloadSettings(): SettingsViewResult {
    const result = this.settings.reload();
    this.emitChange('settings');
    return result;
  }

  async saveProvider(
    providerId: string,
    config: ProviderConfigView,
  ): Promise<void> {
    await this.deps.models.saveProvider(providerId, config);
    await this.deps.agent.rebuildForModelChange();
    this.emitChange('models');
  }

  async deleteProvider(providerId: string): Promise<void> {
    await this.deps.models.deleteProvider(providerId);
    await this.deps.agent.rebuildForModelChange();
    this.emitChange('models');
  }

  async saveModel(providerId: string, model: ModelConfigView): Promise<void> {
    await this.deps.models.saveModel(providerId, model);
    await this.deps.agent.rebuildForModelChange();
    this.emitChange('models');
  }

  async deleteModel(providerId: string, modelId: string): Promise<void> {
    await this.deps.models.deleteModel(providerId, modelId);
    await this.deps.agent.rebuildForModelChange();
    this.emitChange('models');
  }

  providers(): ProviderInfoView[] {
    return this.deps.agent.getProviderCatalog(
      Object.keys(this.deps.models.readView().providers ?? {}),
    );
  }

  catalog(): ModelCatalogItem[] {
    return this.deps.agent.getModelCatalog();
  }

  async loginProvider(input: {
    providerId: string;
    type: 'api_key' | 'oauth';
    apiKey?: string;
  }): Promise<AgentSnapshot> {
    await this.deps.agent.loginProvider(input);
    this.emitChange('models');
    return this.deps.agent.getSnapshot();
  }

  async logoutProvider(providerId: string): Promise<AgentSnapshot> {
    await this.deps.agent.logoutProvider(providerId);
    this.emitChange('models');
    return this.deps.agent.getSnapshot();
  }

  async configure(input: {
    provider?: string;
    modelId?: string;
    apiKey?: string;
    thinkingLevel?: ThinkingLevel;
  }): Promise<AgentSnapshot> {
    const snapshot = await this.deps.agent.configure(input);
    this.emitChange('settings');
    return snapshot;
  }

  thinkingLevels(): string[] {
    return this.deps.agent.session.getAvailableThinkingLevels() as string[];
  }

  async installPackage(name: string): Promise<void> {
    await this.deps.packages.install(name);
    this.emitChange('packages');
  }

  async removePackage(
    source: string,
    scope: 'user' | 'project',
  ): Promise<{ removed: boolean }> {
    const result = await this.deps.packages.remove(source, scope);
    this.emitChange('packages');
    return result;
  }

  skillsView(): {
    skills: SkillInfoView[];
    diagnostics: Array<{ type: string; message: string; path?: string }>;
    active: string[];
  } {
    return {
      skills: this.deps.skills.getSkillInfos(),
      diagnostics: this.deps.skills.getDiagnostics(),
      active: this.deps.skills.getActive(),
    };
  }

  welcomeState(): {
    workspace: { path: string; name: string } | null;
    codecs: Array<{
      id: string;
      label: string;
      mime: string;
      extensions: string[];
    }>;
  } {
    const path = this.deps.agent.getWorkspacePath();
    const codecs = uraRegistry
      .snapshot()
      .codecs.filter(
        (codec) =>
          codec.extensions.length > 0 &&
          uraRegistry.codecById(codec.id)?.patchType === 'text' &&
          codec.keys.some(
            (key) =>
              (key.transport === 'file' || key.transport === '*') && key.mime,
          ),
      )
      .map((codec) => {
        const key = codec.keys.find(
          (item) =>
            (item.transport === 'file' || item.transport === '*') && item.mime,
        );
        return {
          id: codec.id,
          label: codec.id,
          mime: key?.mime ?? '',
          extensions: codec.extensions,
        };
      });
    const seen = new Set<string>();
    return {
      workspace: path ? { path, name: basename(path) } : null,
      codecs: codecs.filter((codec) => {
        const key = `${codec.mime}:${codec.extensions.join(',')}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
    };
  }

  uraRegistry(): unknown {
    return {
      ...uraRegistry.snapshot(),
      diagnostics: uraRegistry.diagnostics(),
    };
  }

  bindings(): Binding[] {
    return this.deps.ura.bindings();
  }

  setBinding(binding: Binding): Promise<Binding[]> {
    return this.deps.ura.setBinding(binding);
  }

  removeBinding(transport: string, mime: string): Promise<Binding[]> {
    return this.deps.ura.removeBinding(transport, mime);
  }

  async reloadSkills(): Promise<{
    skills: SkillInfoView[];
    diagnostics: Array<{ type: string; message: string; path?: string }>;
    active: string[];
  }> {
    await this.deps.agent.reloadResources();
    return this.skillsView();
  }

  packagesCatalog(input: {
    query?: string;
    type?: string;
    page?: number;
  }): Promise<unknown> {
    return this.deps.packages.searchCatalog(input);
  }

  packagesList(): ConfiguredPackageView[] {
    return this.deps.packages.listConfigured();
  }

  packagesLoaded(): unknown {
    return this.deps.agent.getLoadedResources();
  }

  async setSkillEnabled(name: string, enabled: boolean): Promise<void> {
    const id = this.deps.workspaceId?.();
    if (!id) throw new Error('工作区尚未就绪');
    if (this.deps.agent.getSnapshot().isStreaming)
      throw new Error('请等待当前任务结束后再修改技能启用状态');
    const disabled = new Set(readWorkspacePolicy(id).disabledSkills);
    if (enabled) disabled.delete(name);
    else disabled.add(name);
    writeWorkspacePolicy(id, { disabledSkills: [...disabled] });
    this.deps.skills.setDisabled([...disabled]);
    await this.deps.agent.reloadResources();
    this.emitChange('skills');
  }

  setActiveSkills(names: string[]): string[] {
    this.deps.skills.setActive(names);
    this.emitChange('skills');
    return this.deps.skills.getActive();
  }

  private emitChange(area: PiConfArea): void {
    for (const listener of this.changeListeners) listener(area);
  }
}
