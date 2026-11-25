/**
 * agent 服务的资源：
 * sessions · skills · models · tools · prompts · themes · thinking · extensions · context。
 *
 * Domain 是服务边界；每个 resource 对应一个聚合根或读模型。
 * agent 模块只是生命周期，不是地址前缀。
 */

import { CallFailure } from '../../contract.ts';
import type { DomainRegistry } from '../../registry/registry.ts';
import { AgentContext } from './context.ts';
import type { ToolSurface } from './tools.ts';
import type { WorkspaceAgent } from './runtime/workspace-agent.ts';
import type { BrowserCapability } from '../browser/capability.ts';
import type {
  ModelCatalogItem,
  ParsedMessage,
  PiEventFrame,
  ProviderInfoView,
  SessionMeta,
} from '../../../shared/types.ts';
import type { SessionTask } from '../../../shared/session-task.ts';

// ─── sessions ────────────────────────────────────────────────

export interface SessionToolState {
  id: string;
  name: string;
  args: unknown;
  result: unknown;
  isError: boolean;
  done: boolean;
}

export interface SessionStreamState {
  streaming: boolean;
  text: string;
  thinking: string;
  tools: SessionToolState[];
}

/** 每个工作区一份：投影与任务状态都属于该工作区的 agent runtime。 */
export interface SessionsState {
  readonly workspaceId: string;
  items: SessionMeta[];
  messages: ParsedMessage[];
  stream: SessionStreamState;
  task: SessionTask | null;
  opened: string[];
  commands: Array<{ name: string; description?: string; source?: string }>;
  taskSeq: number;
}

export function createSessionsState(workspaceId: string): SessionsState {
  return {
    workspaceId,
    items: [],
    messages: [],
    stream: { streaming: false, text: '', thinking: '', tools: [] },
    task: null,
    opened: [],
    commands: [],
    taskSeq: 0,
  };
}

function rememberOpened(state: SessionsState, file: string | null): void {
  if (!file) return;
  if (!state.opened.includes(file)) state.opened = [...state.opened, file];
}

/** 把 pi 事件归约成当前会话消息与流式投影；状态是权威，事件只是增量。 */
export function reduceSessionFrame(
  state: SessionsState,
  frame: PiEventFrame,
  host?: WorkspaceAgent | null,
  onSync?: () => void,
): boolean {
  const snapshot = host?.getSnapshot();
  const file = snapshot?.sessionFile ?? null;
  rememberOpened(state, file);
  if (frame.event.type === 'agent_status_changed') return true;
  if (!file) return false;
  const prev = state.stream;
  let next: SessionStreamState | null = null;
  let sync = false;

  switch (frame.event.type) {
    case 'message_start':
      next = { streaming: true, text: '', thinking: '', tools: [] };
      if (frame.event.message.role !== 'user') sync = true;
      break;
    case 'message_update': {
      const inner = frame.event.assistantMessageEvent;
      if (inner.type === 'text_delta') {
        next = { ...prev, streaming: true, text: prev.text + inner.delta };
      } else if (inner.type === 'thinking_delta') {
        next = {
          ...prev,
          streaming: true,
          thinking: prev.thinking + inner.delta,
        };
      } else if (
        inner.type === 'text_end' &&
        typeof inner.content === 'string'
      ) {
        next = { ...prev, text: inner.content };
      } else if (
        inner.type === 'thinking_end' &&
        typeof inner.content === 'string'
      ) {
        next = { ...prev, thinking: inner.content };
      }
      break;
    }
    case 'tool_execution_start': {
      const ev = frame.event;
      next = {
        ...prev,
        streaming: true,
        tools: [
          ...prev.tools,
          {
            id: ev.toolCallId,
            name: ev.toolName,
            args: ev.args,
            result: null,
            isError: false,
            done: false,
          },
        ],
      };
      break;
    }
    case 'tool_execution_end': {
      const ev = frame.event;
      next = {
        ...prev,
        tools: prev.tools.map((tool) =>
          tool.id === ev.toolCallId
            ? {
                ...tool,
                result: ev.result,
                isError: ev.isError,
                done: true,
              }
            : tool,
        ),
      };
      break;
    }
    case 'message_end':
      sync = true;
      break;
    case 'agent_settled':
      next = { ...prev, streaming: false };
      sync = true;
      break;
    default:
      break;
  }
  if (next) state.stream = next;
  if (sync && host) {
    void host
      .getMessages()
      .then((messages) => {
        state.messages = messages;
        onSync?.();
      })
      .catch(() => undefined);
  }
  return true;
}

/** 会话投影按工作区资源化：`agent/<wsId>/sessions`（agent 只服务当前工作区）。 */
export function defineSessionsResources(
  registry: DomainRegistry,
  states: Map<string, SessionsState>,
  thinking: ThinkingState | undefined,
  runtimeOf: (workspaceId: string) => WorkspaceAgent | null,
  ensureRuntime: (workspaceId: string) => Promise<WorkspaceAgent>,
  idleItems: (workspaceId: string) => SessionMeta[],
): {
  ensure: (workspaceId: string) => void;
  remove: (workspaceId: string) => void;
  publish: (workspaceId?: string) => void;
  event: (workspaceId: string, name: string, data: unknown) => void;
  stateOf: (workspaceId: string) => SessionsState;
} {
  const domain = registry.define('agent');
  const registered = new Set<string>();

  const stateOf = (workspaceId: string): SessionsState => {
    let state = states.get(workspaceId);
    if (!state) {
      state = createSessionsState(workspaceId);
      states.set(workspaceId, state);
    }
    return state;
  };

  const publish = (workspaceId?: string): void => {
    if (workspaceId) {
      domain.resourceOf(`${workspaceId}/sessions`)?.publish();
      return;
    }
    for (const id of registered) {
      domain.resourceOf(`${id}/sessions`)?.publish();
    }
  };

  const liveSnapshot = (workspaceId: string): unknown => {
    const runtime = runtimeOf(workspaceId);
    const state = stateOf(workspaceId);
    if (!runtime) {
      return {
        workspaceId,
        current: null,
        active: null,
        items: idleItems(workspaceId),
        commands: [],
        task: null,
        opened: [],
        thinking: { level: null, levels: thinking?.levels ?? [] },
      };
    }
    const snapshot = runtime.getSnapshot();
    rememberOpened(state, snapshot.sessionFile);
    return {
      workspaceId,
      current: snapshot,
      active: {
        sessionId: snapshot.sessionFile
          ? encodeURIComponent(snapshot.sessionFile)
          : null,
        messages: state.messages,
        stream: state.stream,
      },
      items: state.items,
      commands: state.commands,
      task: state.task,
      opened: state.opened,
      thinking: {
        level: snapshot.thinkingLevel,
        levels:
          runtime.session.getAvailableThinkingLevels?.() ??
          (['off', 'low', 'medium', 'high'] as string[]),
      },
    };
  };

  /** 每条命令都路由到该工作区自己的 runtime；没有就按需创建。 */
  const define = (workspaceId: string): void => {
    const state = stateOf(workspaceId);
    const resource = domain.resource(`${workspaceId}/sessions`);
    const agent = (): Promise<WorkspaceAgent> => ensureRuntime(workspaceId);
    resource.snapshot(() => liveSnapshot(workspaceId));

    const guarded: (
      action: string,
      spec: {
        summary: string;
        args?: Parameters<typeof resource.command>[1]['args'];
        run: (
          input: Record<string, any>,
          ctx: unknown,
          runtime: WorkspaceAgent,
        ) => unknown;
      },
    ) => void = (action, spec) => {
      resource.command(action, {
        summary: spec.summary,
        ...(spec.args ? { args: spec.args } : {}),
        run: async (input, ctx) => {
          const runtime = await agent();
          return spec.run(input as never, ctx, runtime);
        },
      });
    };

    guarded('new', {
      summary: '新建会话',
      args: {},
      run: async (_input, _ctx, runtime) => {
        state.task = null;
        await runtime.newSession();
        publish(workspaceId);
        return runtimeSession(runtime.getSnapshot());
      },
    });
    guarded('open', {
      summary: '打开会话',
      args: {
        id: { type: 'string' },
        sessionId: { type: 'string' },
      },
      run: async (input, _ctx, runtime) => {
        const id = String(
          (input as Record<string, unknown>)['id'] ??
            (input as Record<string, unknown>)['sessionId'] ??
            '',
        );
        await runtime.switchSession(id);
        publish(workspaceId);
        return runtimeSession(runtime.getSnapshot());
      },
    });
    guarded('refresh', {
      summary: '刷新会话投影',
      args: {},
      run: (_input, _ctx, runtime) => {
        publish(workspaceId);
        return runtimeSession(runtime.getSnapshot());
      },
    });
    guarded('prompt', {
      summary: '发送消息',
      args: { text: { type: 'string', required: true } },
      run: async (input, _ctx, runtime) => {
        const text = String((input as Record<string, unknown>)['text']);
        const task: SessionTask = {
          id: ++state.taskSeq,
          sessionFile: runtime.getSnapshot().sessionFile,
          status: 'running',
          request: text,
          attempt: 1,
          stage: '正在执行',
          error: null,
          mayHaveSideEffects: false,
          artifacts: [],
          tools: [],
        };
        state.task = task;
        publish(workspaceId);
        try {
          await runtime.prompt({ text });
          task.status = runtime.getSnapshot().isStreaming
            ? 'unconfirmed'
            : 'done';
          task.stage = task.status === 'done' ? '本轮结束' : '等待执行结果';
        } catch (error) {
          task.status = 'failed';
          task.error = error instanceof Error ? error.message : String(error);
          task.stage = '本轮失败';
          throw error;
        } finally {
          publish(workspaceId);
        }
        return runtimeSession(runtime.getSnapshot());
      },
    });
    guarded('abort', {
      summary: '中止当前回合',
      args: {},
      run: async (_input, _ctx, runtime) => {
        if (state.task) {
          state.task.status = 'stopping';
          state.task.stage = '正在停止';
          publish(workspaceId);
        }
        await runtime.abort();
        if (state.task) {
          state.task.status = runtime.getSnapshot().isStreaming
            ? 'unconfirmed'
            : 'stopped';
          state.task.stage = '已请求停止';
        }
        publish(workspaceId);
        return null;
      },
    });
    guarded('setModel', {
      summary: '切换当前会话模型',
      args: {
        provider: { type: 'string', required: true },
        model: { type: 'string', required: true },
      },
      run: async (input, _ctx, runtime) => {
        const value = input as Record<string, unknown>;
        await runtime.setModel(
          String(value['provider']),
          String(value['model']),
        );
        publish(workspaceId);
        return runtimeSession(runtime.getSnapshot());
      },
    });
    guarded('steer', {
      summary: '插入当前回合',
      args: { text: { type: 'string', required: true } },
      run: async (input, _ctx, runtime) => {
        await runtime.steer(String((input as Record<string, unknown>)['text']));
        publish(workspaceId);
        return runtimeSession(runtime.getSnapshot());
      },
    });
    guarded('followUp', {
      summary: '追加下一回合',
      args: { text: { type: 'string', required: true } },
      run: async (input, _ctx, runtime) => {
        await runtime.followUp(
          String((input as Record<string, unknown>)['text']),
        );
        publish(workspaceId);
        return runtimeSession(runtime.getSnapshot());
      },
    });
    guarded('compact', {
      summary: '压缩当前会话',
      args: { instructions: { type: 'string' } },
      run: async (input, _ctx, runtime) => {
        const instructions = (input as Record<string, unknown>)['instructions'];
        await runtime.compact(
          typeof instructions === 'string' ? instructions : undefined,
        );
        publish(workspaceId);
        return runtimeSession(runtime.getSnapshot());
      },
    });
    guarded('retry', {
      summary: '重试上一回合',
      args: { confirmed: { type: 'boolean' } },
      run: async () => {
        throw new CallFailure('failed', '当前 runtime 不支持 retry');
      },
    });
    guarded('fork', {
      summary: '从消息分叉会话',
      args: {
        entryId: { type: 'string', required: true },
        position: { enum: ['before', 'after'] },
      },
      run: async (input, _ctx, runtime) => {
        const value = input as Record<string, unknown>;
        await runtime.fork(
          String(value['entryId']),
          value['position'] === 'before' ? 'before' : 'at',
        );
        publish(workspaceId);
        return runtimeSession(runtime.getSnapshot());
      },
    });
    guarded('rename', {
      summary: '重命名会话',
      args: {
        name: { type: 'string', required: true },
        id: { type: 'string' },
        path: { type: 'string' },
      },
      run: async (input, _ctx, runtime) => {
        const value = input as Record<string, unknown>;
        const id = String(
          value['id'] ??
            value['path'] ??
            runtime.getSnapshot().sessionFile ??
            '',
        );
        runtime.renameSession(id, String(value['name']));
        publish(workspaceId);
        return runtimeSession(runtime.getSnapshot());
      },
    });
    guarded('delete', {
      summary: '删除会话',
      args: {
        id: { type: 'string' },
        path: { type: 'string' },
      },
      run: async (input, _ctx, runtime) => {
        const value = input as Record<string, unknown>;
        const id = String(
          value['id'] ??
            value['path'] ??
            runtime.getSnapshot().sessionFile ??
            '',
        );
        if (!id) throw new CallFailure('not_found', '没有当前会话');
        await runtime.deleteSession(id);
        state.items = state.items.filter(
          (item) => (item as { path?: string }).path !== id,
        );
        publish(workspaceId);
        return null;
      },
    });
    guarded('setThinking', {
      summary: '切换当前思考等级',
      args: { level: { type: 'string', required: true } },
      run: async (input, _ctx, runtime) => {
        const level = String((input as Record<string, unknown>)['level']);
        runtime.setThinkingLevel(level);
        publish(workspaceId);
        return {
          level,
          levels: runtime.session.getAvailableThinkingLevels?.() ?? [],
        };
      },
    });
    guarded('closeOpened', {
      summary: '关闭已打开的会话标签',
      args: {},
      run: () => null,
    });
  };

  return {
    ensure: (workspaceId: string) => {
      const created = !registered.has(workspaceId);
      registered.add(workspaceId);
      stateOf(workspaceId);
      if (!created && domain.resourceOf(`${workspaceId}/sessions`)) return;
      define(workspaceId);
    },
    remove: (workspaceId: string) => {
      registered.delete(workspaceId);
      states.delete(workspaceId);
      domain.remove(`${workspaceId}/sessions`);
    },
    publish,
    event: (workspaceId: string, name: string, data: unknown) => {
      domain.resourceOf(`${workspaceId}/sessions`)?.event(name, data);
    },
    stateOf,
  };
}

function runtimeSession(
  snapshot: ReturnType<WorkspaceAgent['getSnapshot']>,
): ReturnType<WorkspaceAgent['getSnapshot']> {
  return snapshot;
}

// ─── providers / models ─────────────────────────────────────

export interface ModelsState {
  providers: ProviderInfoView[];
  models: ModelCatalogItem[];
}

export interface ModelResources {
  sync(): void;
}

export function createModelsState(): ModelsState {
  return { providers: [], models: [] };
}

export function defineModelsResources(
  registry: DomainRegistry,
  state: ModelsState,
  host?: () => WorkspaceAgent | null,
  browser?: BrowserCapability,
): ModelResources {
  const domain = registry.define('agent');
  const providers = domain.resource('providers');
  providers.snapshot(() => state.providers);

  const models = domain.resource('models');
  models.snapshot(() => state.models);

  const ensureProvider = (providerId: string) => {
    const name = providerResourceName(providerId);
    if (domain.resourceOf(name)) return;
    const resource = domain.resource(name);
    resource.snapshot(
      () =>
        state.providers.find((provider) => provider.id === providerId) ?? null,
    );
    resource.command('login', {
      summary: '登录供应商',
      args: {
        type: { enum: ['api_key', 'oauth'] },
        apiKey: { type: 'string' },
        url: { type: 'string' },
      },
      run: async (input) => {
        const runtime = host?.();
        if (!runtime) throw new CallFailure('failed', 'agent runtime 未启动');
        if (input.type !== 'oauth') {
          await runtime.loginProvider({
            providerId,
            type: 'api_key',
            ...(typeof input.apiKey === 'string'
              ? { apiKey: input.apiKey }
              : {}),
          });
          return null;
        }
        await runtime.loginProvider({
          providerId,
          type: 'oauth',
        });
        return null;
      },
    });
    resource.command('completeLogin', {
      summary: '提交 OAuth 授权结果',
      args: {
        state: { type: 'string', required: true },
        accessToken: { type: 'string' },
      },
      run: async (input) => {
        const runtime = host?.();
        if (!runtime) throw new CallFailure('failed', 'agent runtime 未启动');
        await runtime.completeOAuth(
          providerId,
          String(input.state),
          typeof input.accessToken === 'string'
            ? { accessToken: input.accessToken }
            : {},
        );
        resource.publish();
        return null;
      },
    });
    resource.command('logout', {
      summary: '退出供应商',
      args: {},
      run: () => {
        const runtime = host?.();
        if (!runtime) throw new CallFailure('failed', 'agent runtime 未启动');
        return runtime.logoutProvider(providerId);
      },
    });
    resource.command('save', {
      summary: '保存供应商配置',
      args: {},
      run: async (input) => {
        const runtime = host?.();
        if (!runtime) throw new CallFailure('failed', 'agent runtime 未启动');
        await runtime.saveProvider(providerId, input.config);
        resource.publish();
        return null;
      },
    });
    resource.command('delete', {
      summary: '删除供应商配置',
      args: {},
      run: async () => {
        const runtime = host?.();
        if (!runtime) throw new CallFailure('failed', 'agent runtime 未启动');
        await runtime.deleteProvider(providerId);
        resource.publish();
        return null;
      },
    });
    resource.publish();
  };

  const ensureModel = (providerId: string, modelId: string) => {
    const name = modelResourceName(providerId, modelId);
    if (domain.resourceOf(name)) return;
    const resource = domain.resource(name);
    resource.snapshot(
      () =>
        state.models.find(
          (model) => model.provider === providerId && model.modelId === modelId,
        ) ?? null,
    );
    resource.command('save', {
      summary: '保存模型条目',
      args: {},
      run: async (input) => {
        const runtime = host?.();
        if (!runtime) throw new CallFailure('failed', 'agent runtime 未启动');
        await runtime.saveModel(providerId, {
          id: modelId,
          ...(typeof input.config === 'object' && input.config !== null
            ? input.config
            : {}),
        });
        resource.publish();
        return null;
      },
    });
    resource.command('delete', {
      summary: '删除模型条目',
      args: {},
      run: async () => {
        const runtime = host?.();
        if (!runtime) throw new CallFailure('failed', 'agent runtime 未启动');
        await runtime.deleteModel(providerId, modelId);
        resource.publish();
        return null;
      },
    });
    resource.command('setDefault', {
      summary: '设为当前模型',
      args: {},
      run: async () => {
        const runtime = host?.();
        if (!runtime) throw new CallFailure('failed', 'agent runtime 未启动');
        await runtime.setModel(providerId, modelId);
        resource.publish();
        return null;
      },
    });
    resource.publish();
  };

  const sync = (): void => {
    for (const provider of state.providers) ensureProvider(provider.id);
    for (const model of state.models) {
      ensureModel(model.provider, model.modelId);
    }
    providers.publish();
    models.publish();
  };

  providers.command('refresh', {
    summary: '刷新供应商目录',
    args: {},
    run: () => {
      sync();
      return state.providers;
    },
  });
  models.command('refresh', {
    summary: '刷新模型目录',
    args: {},
    run: () => {
      sync();
      return state.models;
    },
  });

  if (state.providers.length || state.models.length) sync();
  return { sync };
}

function providerResourceName(providerId: string): string {
  return `provider/${encodeURIComponent(providerId)}`;
}

function modelResourceName(providerId: string, modelId: string): string {
  return `model/${encodeURIComponent(providerId)}/${encodeURIComponent(modelId)}`;
}

// ─── skills ──────────────────────────────────────────────────

export interface SkillInfo {
  name: string;
  description: string;
  pluginId?: string;
  path?: string;
}

export interface SkillSourceInfo {
  pluginId: string;
  pluginName: string;
  path: string;
}

export interface SkillsState {
  active: Set<string>;
  disabled: Set<string>;
  catalog: SkillInfo[];
  sources: SkillSourceInfo[];
}

export function createSkillsState(): SkillsState {
  return { active: new Set(), disabled: new Set(), catalog: [], sources: [] };
}

export function defineSkillsResource(
  registry: DomainRegistry,
  state: SkillsState,
  host?: () => WorkspaceAgent | null,
): void {
  const domain = registry.define('agent');
  const resource = domain.resource('skills');
  resource.snapshot(() => ({
    active: [...state.active],
    disabled: [...state.disabled],
    catalog: state.catalog,
    sources: state.sources,
  }));
  resource.command('setActive', {
    summary: '设置激活技能',
    args: {},
    run: async (input) => {
      const names = Array.isArray(input.names)
        ? input.names.filter(
            (value): value is string => typeof value === 'string',
          )
        : [];
      state.active = new Set(names.filter((name) => !state.disabled.has(name)));
      const runtime = host?.();
      runtime?.skillsRef().setActive([...state.active]);
      await runtime?.reloadResources();
      resource.publish();
      return {
        active: [...state.active],
        disabled: [...state.disabled],
        catalog: state.catalog,
        sources: state.sources,
      };
    },
  });
  resource.command('setEnabled', {
    summary: '启用 / 禁用技能',
    args: {
      name: { type: 'string', required: true },
      enabled: { type: 'boolean', required: true },
    },
    run: async (input) => {
      const name = String(input.name);
      if (input.enabled === true) state.disabled.delete(name);
      else {
        state.disabled.add(name);
        state.active.delete(name);
      }
      const runtime = host?.();
      runtime?.skillsRef().setDisabled([...state.disabled]);
      await runtime?.reloadResources();
      resource.publish();
      return {
        active: [...state.active],
        disabled: [...state.disabled],
        catalog: state.catalog,
        sources: state.sources,
      };
    },
  });
  resource.command('diagnostics', {
    summary: '技能装载诊断',
    args: {},
    run: () => host?.()?.skillsRef().getDiagnostics() ?? [],
  });
  resource.command('openPlugin', {
    summary: '打开技能所属插件',
    args: { pluginId: { type: 'string', required: true } },
    run: () => null,
  });
  resource.command('reload', {
    summary: '重新加载技能',
    args: {},
    run: async () => {
      const runtime = host?.();
      if (runtime) {
        await runtime.reloadResources();
        state.catalog = runtime
          .skillsRef()
          .getSkillInfos()
          .map((skill) => ({
            name: skill.name,
            description: skill.description,
            ...(skill.pluginId ? { pluginId: skill.pluginId } : {}),
            ...(skill.path ? { path: skill.path } : {}),
          }));
        resource.publish();
        return state.catalog;
      }
      throw new CallFailure('failed', 'agent runtime 未启动');
    },
  });
}

// ─── tools ───────────────────────────────────────────────────

export function defineToolsResource(
  registry: DomainRegistry,
  tools: ToolSurface,
): void {
  const resource = registry.define('agent').resource('tools');
  resource.snapshot(() => tools.list());
}

// ─── prompts ─────────────────────────────────────────────────

export interface PromptInfo {
  name: string;
  description: string;
  path?: string;
}

export interface PromptsState {
  prompts: PromptInfo[];
}

export function createPromptsState(): PromptsState {
  return { prompts: [] };
}

export function definePromptsResource(
  registry: DomainRegistry,
  state: PromptsState,
  host?: () => WorkspaceAgent | null,
): void {
  const resource = registry.define('agent').resource('prompts');
  resource.snapshot(() => state.prompts);
  resource.command('reload', {
    summary: '重新加载提示模板',
    args: {},
    run: async () => {
      const runtime = host?.();
      if (runtime) {
        await runtime.reloadResources();
        state.prompts = runtime.getLoadedResources().prompts.map((item) => ({
          name: item.name,
          description: '',
          path: item.path,
        }));
        resource.publish();
        return state.prompts;
      }
      throw new CallFailure('failed', 'agent runtime 未启动');
    },
  });
}

// ─── themes ──────────────────────────────────────────────────

export interface ThemeInfo {
  id: string;
  label: string;
  path?: string;
}

export interface ThemesState {
  themes: ThemeInfo[];
}

export function createThemesState(): ThemesState {
  return { themes: [] };
}

export function defineThemesResource(
  registry: DomainRegistry,
  state: ThemesState,
  host?: () => WorkspaceAgent | null,
): void {
  const resource = registry.define('agent').resource('themes');
  resource.snapshot(() => state.themes);
  resource.command('reload', {
    summary: '重新加载主题',
    args: {},
    run: async () => {
      const runtime = host?.();
      if (runtime) {
        await runtime.reloadResources();
        state.themes = runtime.getLoadedResources().themes.map((item) => ({
          id: item.name,
          label: item.name,
          path: item.path,
        }));
        resource.publish();
        return state.themes;
      }
      throw new CallFailure('failed', 'agent runtime 未启动');
    },
  });
}

// ─── thinking ────────────────────────────────────────────────

export interface ThinkingState {
  level: string | null;
  levels: string[];
}

export function createThinkingState(): ThinkingState {
  return { level: null, levels: [] };
}

// ─── extensions ──────────────────────────────────────────────

export interface ExtensionInfo {
  id: string;
  source: string;
}

export interface ExtensionsState {
  list: ExtensionInfo[];
  errors: string[];
  configured: Array<{ source: string; scope: string; installedPath?: string }>;
  catalog: Array<{
    name: string;
    description: string;
    author: string;
    types: string[];
    downloads: number;
    updatedAt: number;
    installSource: string;
  }>;
}

export function createExtensionsState(): ExtensionsState {
  return { list: [], errors: [], configured: [], catalog: [] };
}

export interface PackageController {
  searchCatalog(input: {
    query?: string;
    type?: string;
    page?: number;
  }): Promise<{
    packages: ExtensionsState['catalog'];
    total: number;
    page: number;
    pageSize: number;
  }>;
  install(name: string): Promise<void>;
  remove(
    source: string,
    scope: 'user' | 'project',
  ): Promise<{ removed: boolean }>;
  listConfigured(): Array<{
    source: string;
    scope: 'user' | 'project';
    installedPath?: string;
  }>;
}

export function defineExtensionsResource(
  registry: DomainRegistry,
  state: ExtensionsState,
  host?: () => WorkspaceAgent | null,
  packages?: () => PackageController | null,
): void {
  const domain = registry.define('agent');
  const resource = domain.resource('extensions');
  resource.snapshot(() => ({
    list: state.list,
    errors: state.errors,
    configured: state.configured,
    catalog: state.catalog,
  }));
  resource.command('reload', {
    summary: '重新加载扩展',
    args: {},
    run: async () => {
      const runtime = host?.();
      if (runtime) {
        await runtime.reloadResources();
        const loaded = runtime.getLoadedResources();
        state.list = loaded.extensions.map((extension) => ({
          id: extension.path,
          source: extension.path,
        }));
        state.errors = loaded.errors.map((error) => error.message);
        state.configured = packages?.()?.listConfigured() ?? [];
        resource.publish();
        return null;
      }
      throw new CallFailure('failed', 'agent runtime 未启动');
    },
  });
  resource.command('catalog', {
    summary: '搜索扩展目录',
    args: {},
    run: async (input) => {
      const service = packages?.();
      if (!service) throw new CallFailure('failed', '扩展目录未接入');
      const result = await service.searchCatalog({
        ...(typeof input.query === 'string' ? { query: input.query } : {}),
        ...(typeof input.type === 'string' ? { type: input.type } : {}),
        ...(typeof input.page === 'number' ? { page: input.page } : {}),
      });
      state.catalog = result.packages;
      resource.publish();
      return result;
    },
  });
  resource.command('install', {
    summary: '安装扩展包',
    args: { name: { type: 'string', required: true } },
    run: async (input) => {
      const service = packages?.();
      if (!service) throw new CallFailure('failed', '扩展安装未接入');
      await service.install(String(input.name));
      state.configured = service.listConfigured();
      resource.publish();
      return null;
    },
  });
  resource.command('remove', {
    summary: '卸载扩展包',
    args: {
      source: { type: 'string', required: true },
      scope: { enum: ['user', 'project'] },
    },
    run: async (input) => {
      const service = packages?.();
      if (!service) throw new CallFailure('failed', '扩展卸载未接入');
      const result = await service.remove(
        String(input.source),
        input.scope === 'project' ? 'project' : 'user',
      );
      state.configured = service.listConfigured();
      resource.publish();
      return result;
    },
  });
}

// ─── context ─────────────────────────────────────────────────

export function contextResourceName(workspaceId: string): string {
  return `${workspaceId}/context`;
}

/** 「助手看到什么」按工作区一份：cwd、打开的资源与当前选择。 */
export function defineContextResources(
  registry: DomainRegistry,
  contexts: Map<string, AgentContext>,
): {
  ensure: (workspaceId: string) => void;
  remove: (workspaceId: string) => void;
} {
  const define = (workspaceId: string): void => {
    const domain = registry.define('agent');
    const name = contextResourceName(workspaceId);
    if (domain.resourceOf(name)) return;
    let context = contexts.get(workspaceId);
    if (!context) {
      context = new AgentContext();
      contexts.set(workspaceId, context);
    }
    const resource = domain.resource(name);
    resource.snapshot(() => context.snapshot());
    resource.command('opened', {
      summary: '登记打开的资源',
      args: { ref: { type: 'string', required: true } },
      run: (input) => {
        context.opened(String(input.ref));
        resource.publish();
        return context.snapshot();
      },
    });
    resource.command('closed', {
      summary: '移除打开的资源',
      args: { ref: { type: 'string', required: true } },
      run: (input) => {
        context.closed(String(input.ref));
        resource.publish();
        return context.snapshot();
      },
    });
    resource.command('select', {
      summary: '设置当前选择',
      args: { ref: { type: 'string' } },
      run: (input) => {
        context.select(
          typeof input.ref === 'string' && input.ref ? input.ref : null,
        );
        resource.publish();
        return context.snapshot();
      },
    });
  };

  return {
    ensure: (workspaceId: string) => define(workspaceId),
    remove: (workspaceId: string) => {
      contexts.delete(workspaceId);
      registry.define('agent').remove(contextResourceName(workspaceId));
    },
  };
}

// ─── runtime ─────────────────────────────────────────────────

export function defineRuntimeResource(
  registry: DomainRegistry,
  host: () => WorkspaceAgent | null,
): void {
  const resource = registry.define('agent').resource('runtime');
  resource.snapshot(() => host()?.getSnapshot() ?? null);
  resource.command('prompt', {
    summary: '发送消息',
    args: { text: { type: 'string', required: true } },
    run: async (input) => {
      const runtime = host();
      if (!runtime) throw new CallFailure('failed', 'agent runtime 未启动');
      await runtime.prompt({ text: String(input.text) });
      resource.publish();
      return runtime.getSnapshot();
    },
  });
  resource.command('abort', {
    summary: '中止当前回合',
    args: {},
    run: async () => {
      await host()?.abort();
      resource.publish();
      return null;
    },
  });
  resource.command('new', {
    summary: '新建会话',
    args: {},
    run: async () => {
      const runtime = host();
      if (!runtime) throw new CallFailure('failed', 'agent runtime 未启动');
      await runtime.newSession();
      resource.publish();
      return runtime.getSnapshot();
    },
  });
  resource.command('setModel', {
    summary: '切换模型',
    args: {
      provider: { type: 'string', required: true },
      model: { type: 'string', required: true },
    },
    run: async (input) => {
      const runtime = host();
      if (!runtime) throw new CallFailure('failed', 'agent runtime 未启动');
      await runtime.setModel(String(input.provider), String(input.model));
      resource.publish();
      return runtime.getSnapshot();
    },
  });
  resource.command('refresh', {
    summary: '刷新 agent 状态',
    args: {},
    run: () => {
      resource.publish();
      return host()?.getSnapshot() ?? null;
    },
  });
}
