/**
 * agent 服务的资源：
 * sessions · skills · models · tools · prompts · themes · thinking · extensions · context。
 *
 * Domain 是服务边界；每个 resource 对应一个聚合根或读模型。
 * agent 模块只是生命周期，不是地址前缀。
 */

import { randomUUID } from 'node:crypto';
import { CallFailure } from '../../contract.ts';
import type { DomainRegistry } from '../../registry/registry.ts';
import type { AgentContext } from './context.ts';
import { Session } from './session.ts';
import type { ToolSurface } from './tools.ts';
import type { AgentHost } from './runtime/agent-host.ts';
import type { BrowserCapability } from '../browser/capability.ts';
import type { SessionSnapshot } from './session.ts';
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

export interface SessionsState {
  workspaceId: string;
  currentId: string | null;
  readonly sessions: Map<string, Session>;
  items: SessionMeta[];
  messages: ParsedMessage[];
  stream: SessionStreamState;
  task: SessionTask | null;
  opened: string[];
  commands: Array<{ name: string; description?: string; source?: string }>;
  taskSeq: number;
}

export function createSessionsState(): SessionsState {
  return {
    workspaceId: '',
    currentId: null,
    sessions: new Map(),
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
  host?: AgentHost | null,
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

export function defineSessionsResource(
  registry: DomainRegistry,
  state: SessionsState,
  context: AgentContext,
  thinking?: ThinkingState,
  host?: () => AgentHost | null,
): void {
  const domain = registry.define('agent');
  const sessions = domain.resource('sessions');

  const publish = (): void => {
    sessions.publish();
    if (state.currentId) {
      domain
        .resourceOf(sessionResourceName(state.workspaceId, state.currentId))
        ?.publish();
    }
  };

  const ensureSessionResource = (id: string): void => {
    const name = sessionResourceName(state.workspaceId, id);
    if (domain.resourceOf(name)) return;
    const resource = domain.resource(name);
    resource.snapshot(() => state.sessions.get(id)?.snapshot() ?? null);
    resource.command('prompt', {
      summary: '向该会话发送消息',
      args: { text: { type: 'string', required: true } },
      run: async (input) => {
        const session = requireSessionById(state, id);
        await session.prompt(String(input.text));
        publish();
        return session.snapshot();
      },
    });
    resource.command('abort', {
      summary: '中止该会话当前回合',
      args: {},
      run: async () => {
        await requireSessionById(state, id).abort();
        publish();
        return null;
      },
    });
    resource.command('setModel', {
      summary: '切换该会话模型',
      args: {
        provider: { type: 'string', required: true },
        model: { type: 'string', required: true },
      },
      run: (input) => {
        const session = requireSessionById(state, id);
        session.setModel(String(input.provider), String(input.model));
        publish();
        return session.snapshot();
      },
    });
    resource.command('steer', {
      summary: '插入该会话当前回合',
      args: { text: { type: 'string', required: true } },
      run: async (input) => {
        const session = requireSessionById(state, id);
        await session.steer(String(input.text));
        publish();
        return session.snapshot();
      },
    });
    resource.command('followUp', {
      summary: '追加该会话下一回合',
      args: { text: { type: 'string', required: true } },
      run: async (input) => {
        const session = requireSessionById(state, id);
        await session.followUp(String(input.text));
        publish();
        return session.snapshot();
      },
    });
    resource.command('compact', {
      summary: '压缩该会话',
      args: { instructions: { type: 'string' } },
      run: async (input) => {
        const session = requireSessionById(state, id);
        await session.compact(
          typeof input.instructions === 'string'
            ? input.instructions
            : undefined,
        );
        publish();
        return session.snapshot();
      },
    });
    resource.command('retry', {
      summary: '重试该会话上一回合',
      args: { confirmed: { type: 'boolean' } },
      run: async (input) => {
        const session = requireSessionById(state, id);
        await session.retry(input.confirmed === true);
        publish();
        return session.snapshot();
      },
    });
    resource.command('fork', {
      summary: '从该会话消息分叉',
      args: {
        entryId: { type: 'string', required: true },
        position: { enum: ['before', 'after'] },
      },
      run: async (input) => {
        const session = requireSessionById(state, id);
        await session.fork(
          String(input.entryId),
          input.position === 'before' ? 'before' : 'after',
        );
        publish();
        return session.snapshot();
      },
    });
    resource.command('rename', {
      summary: '重命名该会话',
      args: { name: { type: 'string', required: true } },
      run: (input) => {
        const session = requireSessionById(state, id);
        session.rename(String(input.name));
        publish();
        return session.snapshot();
      },
    });
  };

  sessions.snapshot(() => {
    const runtime = host?.();
    if (runtime) {
      const snapshot = runtime.getSnapshot();
      rememberOpened(state, snapshot.sessionFile);
      return {
        workspaceId: state.workspaceId,
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
    }
    return {
      workspaceId: state.workspaceId,
      current: currentSession(state)?.snapshot() ?? null,
      active: activeSession(state),
      items: state.items,
      commands: state.commands,
      task: state.task,
      opened: state.opened,
      thinking: {
        level: thinking?.level ?? null,
        levels: thinking?.levels ?? [],
      },
    };
  });

  sessions.command('new', {
    summary: '新建会话',
    args: {},
    run: async () => {
      const runtime = host?.();
      if (runtime) {
        state.task = null;
        await runtime.newSession();
        state.currentId = runtime.getSnapshot().sessionId ?? null;
        publish();
        return runtimeSession(runtime.getSnapshot());
      }
      const id = `session-${state.sessions.size + 1}`;
      const session = new Session(id, context);
      state.sessions.set(id, session);
      state.currentId = id;
      ensureSessionResource(id);
      publish();
      return session.snapshot();
    },
  });
  sessions.command('open', {
    summary: '打开会话',
    args: {
      id: { type: 'string' },
      sessionId: { type: 'string' },
    },
    run: async (input) => {
      const id = String(input.id ?? input.sessionId ?? '');
      const runtime = host?.();
      if (runtime) {
        await runtime.switchSession(id);
        state.currentId = id;
        publish();
        return runtimeSession(runtime.getSnapshot());
      }
      const session = state.sessions.get(id);
      if (!session) throw new CallFailure('not_found', `会话不存在：${id}`);
      state.currentId = id;
      ensureSessionResource(id);
      publish();
      return session.snapshot();
    },
  });
  sessions.command('refresh', {
    summary: '刷新会话投影',
    args: {},
    run: () => {
      publish();
      return sessions.snapshotValue();
    },
  });
  sessions.command('prompt', {
    summary: '发送消息',
    args: { text: { type: 'string', required: true } },
    run: async (input) => {
      const runtime = host?.();
      if (runtime) {
        const text = String(input.text);
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
        publish();
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
          publish();
        }
        return runtimeSession(runtime.getSnapshot());
      }
      const session = requireSession(state);
      await session.prompt(String(input.text));
      publish();
      return session.snapshot();
    },
  });
  sessions.command('abort', {
    summary: '中止当前回合',
    args: {},
    run: async () => {
      const runtime = host?.();
      if (runtime) {
        if (state.task) {
          state.task.status = 'stopping';
          state.task.stage = '正在停止';
          publish();
        }
        await runtime.abort();
        if (state.task) {
          state.task.status = runtime.getSnapshot().isStreaming
            ? 'unconfirmed'
            : 'stopped';
          state.task.stage = '已请求停止';
        }
        publish();
        return null;
      }
      await currentSession(state)?.abort();
      publish();
      return null;
    },
  });
  sessions.command('setModel', {
    summary: '切换当前会话模型',
    args: {
      provider: { type: 'string', required: true },
      model: { type: 'string', required: true },
    },
    run: async (input) => {
      const runtime = host?.();
      if (runtime) {
        await runtime.setModel(String(input.provider), String(input.model));
        publish();
        return runtimeSession(runtime.getSnapshot());
      }
      const session = requireSession(state);
      session.setModel(String(input.provider), String(input.model));
      publish();
      return session.snapshot();
    },
  });
  sessions.command('steer', {
    summary: '插入当前回合',
    args: { text: { type: 'string', required: true } },
    run: async (input) => {
      const runtime = host?.();
      if (runtime) {
        await runtime.steer(String(input.text));
        publish();
        return runtimeSession(runtime.getSnapshot());
      }
      const session = requireSession(state);
      await session.steer(String(input.text));
      publish();
      return session.snapshot();
    },
  });
  sessions.command('followUp', {
    summary: '追加下一回合',
    args: { text: { type: 'string', required: true } },
    run: async (input) => {
      const runtime = host?.();
      if (runtime) {
        await runtime.followUp(String(input.text));
        publish();
        return runtimeSession(runtime.getSnapshot());
      }
      const session = requireSession(state);
      await session.followUp(String(input.text));
      publish();
      return session.snapshot();
    },
  });
  sessions.command('compact', {
    summary: '压缩当前会话',
    args: { instructions: { type: 'string' } },
    run: async (input) => {
      const runtime = host?.();
      if (runtime) {
        await runtime.compact(
          typeof input.instructions === 'string'
            ? input.instructions
            : undefined,
        );
        publish();
        return runtimeSession(runtime.getSnapshot());
      }
      const session = requireSession(state);
      await session.compact(
        typeof input.instructions === 'string' ? input.instructions : undefined,
      );
      publish();
      return session.snapshot();
    },
  });
  sessions.command('retry', {
    summary: '重试上一回合',
    args: { confirmed: { type: 'boolean' } },
    run: async (input) => {
      const session = requireSession(state);
      await session.retry(input.confirmed === true);
      publish();
      return session.snapshot();
    },
  });
  sessions.command('fork', {
    summary: '从消息分叉会话',
    args: {
      entryId: { type: 'string', required: true },
      position: { enum: ['before', 'after'] },
    },
    run: async (input) => {
      const runtime = host?.();
      if (runtime) {
        await runtime.fork(
          String(input.entryId),
          input.position === 'before' ? 'before' : 'at',
        );
        publish();
        return runtimeSession(runtime.getSnapshot());
      }
      const session = requireSession(state);
      await session.fork(
        String(input.entryId),
        input.position === 'before' ? 'before' : 'after',
      );
      publish();
      return session.snapshot();
    },
  });
  sessions.command('rename', {
    summary: '重命名会话',
    args: {
      name: { type: 'string', required: true },
      id: { type: 'string' },
      path: { type: 'string' },
    },
    run: (input) => {
      const id = String(input.id ?? input.path ?? state.currentId ?? '');
      const runtime = host?.();
      if (runtime) {
        runtime.renameSession(id, String(input.name));
        publish();
        return runtimeSession(runtime.getSnapshot());
      }
      const session = requireSessionById(state, id);
      session.rename(String(input.name));
      publish();
      return session.snapshot();
    },
  });
  sessions.command('delete', {
    summary: '删除会话',
    args: {
      id: { type: 'string' },
      path: { type: 'string' },
    },
    run: async (input) => {
      const id = String(input.id ?? input.path ?? state.currentId ?? '');
      if (!id) throw new CallFailure('not_found', '没有当前会话');
      const runtime = host?.();
      if (runtime) {
        await runtime.deleteSession(id);
        state.currentId = runtime.getSnapshot().sessionId ?? null;
      }
      state.sessions.delete(id);
      domain.remove(sessionResourceName(state.workspaceId, id));
      if (state.currentId === id) state.currentId = null;
      publish();
      return null;
    },
  });
  sessions.command('setThinking', {
    summary: '切换当前思考等级',
    args: { level: { type: 'string', required: true } },
    run: (input) => {
      const runtime = host?.();
      if (runtime) {
        runtime.setThinkingLevel(String(input.level));
        publish();
        return {
          level: String(input.level),
          levels: runtime.session.getAvailableThinkingLevels?.() ?? [],
        };
      }
      if (!thinking) return null;
      thinking.level = String(input.level);
      publish();
      return {
        level: thinking.level,
        levels: thinking.levels,
      };
    },
  });
  sessions.command('closeOpened', {
    summary: '关闭已打开的会话标签',
    args: {},
    run: () => null,
  });
}

function runtimeSession(
  snapshot: ReturnType<AgentHost['getSnapshot']>,
): ReturnType<AgentHost['getSnapshot']> {
  return snapshot;
}

function activeSession(state: SessionsState): {
  id: string;
  messages: unknown[];
  streaming: boolean;
} | null {
  const session = currentSession(state);
  if (!session) return null;
  const snapshot = session.snapshot();
  return {
    id: snapshot.id,
    messages: snapshot.messages,
    streaming: snapshot.streaming,
  };
}

function sessionResourceName(workspaceId: string, id: string): string {
  return `${workspaceId}/session/${id}`;
}

function requireSessionById(state: SessionsState, id: string): Session {
  const session = state.sessions.get(id);
  if (!session) throw new CallFailure('not_found', `会话不存在：${id}`);
  return session;
}

function currentSession(state: SessionsState): Session | null {
  if (!state.currentId) return null;
  return state.sessions.get(state.currentId) ?? null;
}

function requireSession(state: SessionsState): Session {
  const session = currentSession(state);
  if (!session) throw new CallFailure('not_found', '没有当前会话');
  return session;
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
  host?: () => AgentHost | null,
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
        await runtime.completeOAuth(providerId, String(input.state), {
          ...(typeof input.accessToken === 'string'
            ? { accessToken: input.accessToken }
            : {}),
        });
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
  host?: () => AgentHost | null,
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
  host?: () => AgentHost | null,
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
  host?: () => AgentHost | null,
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
  host?: () => AgentHost | null,
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

export function defineContextResource(
  registry: DomainRegistry,
  context: AgentContext,
): void {
  const resource = registry.define('agent').resource('context');
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
}

// ─── runtime ─────────────────────────────────────────────────

export function defineRuntimeResource(
  registry: DomainRegistry,
  host: () => AgentHost | null,
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
