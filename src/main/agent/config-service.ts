/**
 * 配置服务（architecture.md §8）—— models.json / settings.json 的读写薄层。
 *
 * 归属：pi 的 ModelConfig 是 load-only 快照，models.json 的写侧是本服务补的能力。
 * 规则：
 *   - 读：脱敏视图（apiKey 永不回传渲染层）；
 *   - 写：JSON 合并（未知字段往返保真）+ pi 真实加载校验（ModelRuntime.create）+
 *     失败回滚；写侧不持有 runtime（换代由 AgentHost 负责）；
 *   - 凭证不在 models.json：apiKey 独立走 agent.configure（auth.json / 运行时覆盖）。
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type {
  ModelsConfigView,
  ModelConfigView,
  ProviderConfigView,
} from '../../shared/types';
import { AppSpaceSettingsStorage, readJsonFile } from './settings-storage';

/** models.json 初始内容（空目录；供应商经模型设置页配置）。 */
export const MODELS_JSON_SEED: { providers: Record<string, unknown> } = {
  providers: {},
};

export class ModelConfigStore {
  private readonly modelsJsonFile: string;
  private readonly authFile: string;

  constructor(agentDir: string) {
    this.modelsJsonFile = join(agentDir, 'models.json');
    this.authFile = join(agentDir, 'auth.json');
    this.ensureFile();
  }

  readView(): ModelsConfigView {
    try {
      const parsed = JSON.parse(
        readFileSync(this.modelsJsonFile, 'utf-8'),
      ) as ModelsConfigView;
      const providers: Record<string, ProviderConfigView> = {};
      for (const [id, p] of Object.entries(parsed.providers ?? {})) {
        const { apiKey: _omit, ...rest } = p as ProviderConfigView & {
          apiKey?: string;
        };
        providers[id] = { ...rest, models: rest.models ?? [] };
      }
      return { providers };
    } catch {
      return { providers: {} };
    }
  }

  async saveProvider(
    providerId: string,
    config: ProviderConfigView,
  ): Promise<void> {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(providerId)) {
      throw new Error(
        `Invalid provider id: ${providerId}（小写字母 / 数字 / 连字符）`,
      );
    }
    const parsed = this.readRaw();
    const prev = parsed.providers?.[providerId] ?? {};
    if (!config.baseUrl && !prev.baseUrl) {
      throw new Error('baseUrl 必填（pi 需要 endpoint 才能组装供应商）');
    }
    const cfgRest = { ...config } as ProviderConfigView & { apiKey?: string };
    delete cfgRest.apiKey;
    const next: Record<string, unknown> = { ...prev, ...cfgRest };
    if (!next.api) next.api = 'openai-completions';
    if (!cfgRest.models?.length && prev.models?.length)
      next.models = prev.models;
    parsed.providers = { ...parsed.providers, [providerId]: next };
    await this.writeAndSwap(parsed, providerId);
  }

  async deleteProvider(providerId: string): Promise<void> {
    const parsed = this.readRaw();
    if (parsed.providers?.[providerId]) {
      delete parsed.providers[providerId];
      await this.writeAndSwap(parsed);
    }
  }

  async saveModel(providerId: string, model: ModelConfigView): Promise<void> {
    if (!model.id) throw new Error('Model id is required');
    const parsed = this.readRaw();
    const providers = (parsed.providers ??= {});
    const provider = (providers[providerId] ??= {
      api: 'openai-completions',
      models: [],
    });
    provider.models ??= [];
    const i = provider.models.findIndex((m) => m.id === model.id);
    if (i >= 0) provider.models[i] = { ...provider.models[i]!, ...model };
    else provider.models.push(model);
    await this.writeAndSwap(parsed, providerId, model.id);
  }

  async deleteModel(providerId: string, modelId: string): Promise<void> {
    const parsed = this.readRaw();
    const provider = parsed.providers?.[providerId];
    if (provider?.models) {
      provider.models = provider.models.filter((m) => m.id !== modelId);
      await this.writeAndSwap(parsed);
    }
  }

  // ─── 内部 ───────────────────────────────────────────────

  private ensureFile(): void {
    if (!existsSync(this.modelsJsonFile)) {
      writeFileSync(
        this.modelsJsonFile,
        JSON.stringify(MODELS_JSON_SEED, null, 2),
        'utf-8',
      );
      return;
    }
    // 修复坏文件：空字符串 apiKey 违反 pi schema（minLength:1），会导致整个文件校验失败。
    try {
      const parsed = JSON.parse(readFileSync(this.modelsJsonFile, 'utf-8')) as {
        providers?: Record<string, Record<string, unknown>>;
      };
      let dirty = false;
      for (const provider of Object.values(parsed.providers ?? {})) {
        if (provider.apiKey === '') {
          delete provider.apiKey;
          dirty = true;
        }
      }
      if (dirty)
        writeFileSync(
          this.modelsJsonFile,
          JSON.stringify(parsed, null, 2),
          'utf-8',
        );
    } catch {
      /* 解析失败交给 ModelRuntime 报错 */
    }
  }

  private readRaw(): {
    providers?: Record<string, ProviderConfigView & { apiKey?: string }>;
  } {
    this.ensureFile();
    try {
      return JSON.parse(readFileSync(this.modelsJsonFile, 'utf-8')) as {
        providers?: Record<string, ProviderConfigView & { apiKey?: string }>;
      };
    } catch {
      return { providers: {} };
    }
  }

  /** 写盘 + pi 真实加载校验（失败回滚）。 */
  private async writeAndSwap(
    parsed: unknown,
    expectProvider?: string,
    expectModelId?: string,
  ): Promise<void> {
    const backup = readFileSync(this.modelsJsonFile, 'utf-8');
    writeFileSync(
      this.modelsJsonFile,
      JSON.stringify(parsed, null, 2),
      'utf-8',
    );
    try {
      const runtime = await ModelRuntime.create({
        authPath: this.authFile,
        modelsPath: this.modelsJsonFile,
      });
      if (expectProvider && !runtime.getProvider(expectProvider)) {
        throw new Error(
          `pi 未能加载供应商「${expectProvider}」（schema 不符或缺少必要字段）。`,
        );
      }
      if (
        expectProvider &&
        expectModelId &&
        !runtime.getModel(expectProvider, expectModelId)
      ) {
        throw new Error(
          `pi 校验失败：模型「${expectModelId}」未被 picatalog 收录。`,
        );
      }
    } catch (e) {
      writeFileSync(this.modelsJsonFile, backup, 'utf-8');
      throw e;
    }
  }
}

/** settings.json 两层视图 + 生效视图 + 通用路径写入（设置页数据面）。 */
export interface SettingsViewResult {
  global: Record<string, unknown>;
  project: Record<string, unknown>;
  /** 生效值：global ← project 深度合并（与 pi 的合并顺序一致）。 */
  effective: Record<string, unknown>;
  /** 两层落盘位置（页面上展示「改的是哪个文件」）。 */
  paths: { global: string; project: string };
}

export class SettingsService {
  constructor(private readonly storage: AppSpaceSettingsStorage) {}

  view(): SettingsViewResult {
    const global = readJsonFile(this.storage.globalFile);
    const project = readJsonFile(this.storage.projectFile);
    const effective = deepMerge(structuredClone(global), project);
    return {
      global,
      project,
      effective,
      paths: {
        global: this.storage.globalFile,
        project: this.storage.projectFile,
      },
    };
  }

  setGlobal(path: string, value: unknown): SettingsViewResult {
    this.storage.withLock('global', (current) =>
      JSON.stringify(setPath(parseJson(current), path, value), null, 2),
    );
    return this.view();
  }

  setProject(path: string, value: unknown): SettingsViewResult {
    this.storage.withLock('project', (current) =>
      JSON.stringify(setPath(parseJson(current), path, value), null, 2),
    );
    return this.view();
  }

  reload(): SettingsViewResult {
    return this.view();
  }
}

/** 源覆盖目标（嵌套对象合并，数组 / 标量整取）。 */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  for (const [key, value] of Object.entries(source)) {
    const prev = target[key];
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      prev &&
      typeof prev === 'object' &&
      !Array.isArray(prev)
    ) {
      deepMerge(
        prev as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      target[key] = structuredClone(value);
    }
  }
  return target;
}

function parseJson(text: string | undefined): Record<string, unknown> {
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** 点号路径写入（浅合并；null = 删除该键回落默认；未知字段保真）。 */
function setPath(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const keys = path.split('.').filter(Boolean);
  if (keys.length === 0) return target;
  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    const next = cursor[key];
    if (typeof next !== 'object' || next === null || Array.isArray(next))
      cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  const last = keys[keys.length - 1];
  if (value === null) delete cursor[last];
  else cursor[last] = value;
  pruneEmpty(target, keys);
  return target;
}

/** 删除后清理变空的父级对象（保持 settings.json 干净；数组与标量不动）。 */
function pruneEmpty(target: Record<string, unknown>, keys: string[]): void {
  for (let depth = keys.length - 2; depth > 0; depth--) {
    let cursor: Record<string, unknown> = target;
    for (let i = 0; i < depth; i++) {
      const next = cursor[keys[i]];
      if (typeof next !== 'object' || next === null) return;
      cursor = next as Record<string, unknown>;
    }
    const key = keys[depth];
    const value = cursor[key];
    if (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0
    ) {
      delete cursor[key];
    }
  }
}
