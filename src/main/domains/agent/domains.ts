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
import type { SessionAgent } from './runtime/session-agent.ts';
import type { BrowserCapability } from '../browser/capability.ts';
import type {
  ModelCatalogItem,
  ModelConfigView,
  ModelsConfigView,
  ParsedMessage,
  ProviderCredentialInput,
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

/** 一个打开会话的增量状态（消息、流式、任务）。 */
export interface SessionEntryState {
  key: string;
  messages: ParsedMessage[];
  stream: SessionStreamState;
  task: SessionTask | null;
}

/** 工作区的会话集合：多个会话可以同时打开并各自执行。 */
export interface SessionsState {
  readonly workspaceId: string;
  items: SessionMeta[];
  opened: string[];
  current: string | null;
  readonly sessions: Map<string, SessionEntryState>;
  commands: Array<{ name: string; description?: string; source?: string }>;
  taskSeq: number;
  draftSeq: number;
}

export function createSessionsState(workspaceId: string): SessionsState {
  return {
    workspaceId,
    items: [],
    opened: [],
    current: null,
    sessions: new Map(),
    commands: [],
    taskSeq: 0,
    draftSeq: 0,
  };
}

export function sessionEntryOf(
  state: SessionsState,
  key: string,
): SessionEntryState {
  let entry = state.sessions.get(key);
  if (!entry) {
    entry = {
      key,
      messages: [],
      stream: { streaming: false, text: '', thinking: '', tools: [] },
      task: null,
    };
    state.sessions.set(key, entry);
  }
  return entry;
}

/** 把 pi 事件归约成该会话的消息与流式投影。 */
export function reduceSessionFrame(
  entry: SessionEntryState,
  frame: PiEventFrame,
  host?: SessionAgent | null,
  onSync?: () => void,
): boolean {
  const snapshot = host?.getSnapshot();
  if (frame.event.type === 'agent_status_changed') return true;
  const prev = entry.stream;
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
  if (next) entry.stream = next;
  if (sync && host) {
    void host
      .getMessages()
      .then((messages) => {
        entry.messages = messages;
        onSync?.();
      })
      .catch(() => undefined);
  }
  return Boolean(snapshot) || sync;
}

export interface SessionsPort {
  workspacePath(workspaceId: string): string | null;
  listItems(workspaceId: string): Promise<SessionMeta[]>;
  agentOf(workspaceId: string, key: string): SessionAgent | null;
  ensureAgent(
    workspaceId: string,
    input: { sessionFile?: string; draftKey?: string },
  ): Promise<SessionAgent>;
  disposeAgent(workspaceId: string, key: string): Promise<void>;
}

export function defineSessionsResources(
  registry: DomainRegistry,
  states: Map<string, SessionsState>,
  port: SessionsPort,
  thinking: ThinkingState | undefined,
  resolveAgent: (workspaceId: string, key: string) => SessionAgent | null,
): {
  ensure: (workspaceId: string) => void;
  remove: (workspaceId: string) => void;
  publish: (workspaceId: string, key?: string) => void;
  event: (
    workspaceId: string,
    key: string,
    name: string,
    data: unknown,
  ) => void;
  stateOf: (workspaceId: string) => SessionsState;
  rekey: (workspaceId: string, from: string, to: string) => void;
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

  const publish = (workspaceId: string, key?: string): void => {
    domain.resourceOf(`${workspaceId}/sessions`)?.publish();
    if (key) {
      domain.resourceOf(`${workspaceId}/session/${key}`)?.publish();
    }
  };

  const entrySnapshot = (state: SessionsState, key: string): unknown => {
    const agent = resolveAgent(state.workspaceId, key);
    if (!agent) return null;
    const entry = state.sessions.get(key) ?? null;
    return {
      sessionId: key,
      workspaceId: state.workspaceId,
      snapshot: agent.getSnapshot(),
      messages: entry?.messages ?? [],
      stream: entry?.stream ?? {
        streaming: false,
        text: '',
        thinking: '',
        tools: [],
      },
      task: entry?.task ?? null,
    };
  };

  const aggregateSnapshot = (workspaceId: string): unknown => {
    const state = stateOf(workspaceId);
    const key = state.current;
    const agent = key ? resolveAgent(workspaceId, key) : null;
    const entry = key ? (state.sessions.get(key) ?? null) : null;
    const file = agent?.getSnapshot().sessionFile ?? null;
    return {
      workspaceId,
      current: agent?.getSnapshot() ?? null,
      active:
        agent && key
          ? {
              sessionId: file ? encodeURIComponent(file) : null,
              messages: entry?.messages ?? [],
              stream: entry?.stream ?? {
                streaming: false,
                text: '',
                thinking: '',
                tools: [],
              },
            }
          : null,
      items: state.items,
      opened: state.opened,
      commands: agent?.getCommands() ?? [],
      task: entry?.task ?? null,
      thinking: {
        level: (agent?.getSnapshot().thinkingLevel ?? null) as string | null,
        levels:
          agent?.session.getAvailableThinkingLevels?.() ??
          thinking?.levels ??
          [],
      },
    };
  };

  const defineSession = (workspaceId: string, key: string): void => {
    const name = `${workspaceId}/session/${key}`;
    if (domain.resourceOf(name)) return;
    const resource = domain.resource(name);
    const state = stateOf(workspaceId);
    resource.snapshot(() => entrySnapshot(state, key));

    const guard = (): SessionAgent => {
      const agent = resolveAgent(workspaceId, key);
      if (!agent) throw new CallFailure('not_found', `会话未运行：${key}`);
      return agent;
    };
    resource.command('prompt', {
      summary: '向该会话发送消息',
      args: { text: { type: 'string', required: true } },
      run: async (input) => {
        const agent = guard();
        await agent.prompt({ text: String(input.text) });
        publish(workspaceId, key);
        return entrySnapshot(state, key);
      },
    });
    resource.command('abort', {
      summary: '中止该会话当前回合',
      args: {},
      run: async () => {
        await guard().abort();
        publish(workspaceId, key);
        return null;
      },
    });
    resource.command('steer', {
      summary: '插入该会话当前回合',
      args: { text: { type: 'string', required: true } },
      run: async (input) => {
        await guard().steer(String(input.text));
        publish(workspaceId, key);
        return entrySnapshot(state, key);
      },
    });
    resource.command('followUp', {
      summary: '追加该会话下一回合',
      args: { text: { type: 'string', required: true } },
      run: async (input) => {
        await guard().followUp(String(input.text));
        publish(workspaceId, key);
        return entrySnapshot(state, key);
      },
    });
    resource.command('compact', {
      summary: '压缩该会话',
      args: { instructions: { type: 'string' } },
      run: async (input) => {
        const instructions = input.instructions;
        await guard().compact(
          typeof instructions === 'string' ? instructions : undefined,
        );
        publish(workspaceId, key);
        return entrySnapshot(state, key);
      },
    });
    resource.command('fork', {
      summary: '从该会话消息分叉',
      args: {
        entryId: { type: 'string', required: true },
        position: { enum: ['before', 'after'] },
      },
      run: async (input) => {
        await guard().fork(
          String(input.entryId),
          input.position === 'before' ? 'before' : 'at',
        );
        publish(workspaceId, key);
        return entrySnapshot(state, key);
      },
    });
    resource.command('rename', {
      summary: '重命名该会话',
      args: { name: { type: 'string', required: true } },
      run: (input) => {
        const agent = guard();
        const id = agent.getSnapshot().sessionFile ?? '';
        if (id) agent.renameSession(id, String(input.name));
        publish(workspaceId, key);
        return entrySnapshot(state, key);
      },
    });
    resource.command('delete', {
      summary: '删除该会话',
      args: {},
      run: async () => {
        const agent = guard();
        const file = agent.getSnapshot().sessionFile;
        if (file) await agent.deleteSession(file);
        await port.disposeAgent(workspaceId, key);
        state.opened = state.opened.filter((item) => item !== key);
        if (state.current === key) state.current = state.opened[0] ?? null;
        domain.remove(name);
        state.items = await port
          .listItems(workspaceId)
          .catch(() => state.items);
        publish(workspaceId);
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
        const agent = guard();
        void agent.setModel(String(input.provider), String(input.model));
        publish(workspaceId, key);
        return entrySnapshot(state, key);
      },
    });
    resource.command('setThinking', {
      summary: '切换该会话思考等级',
      args: { level: { type: 'string', required: true } },
      run: (input) => {
        const agent = guard();
        agent.setThinkingLevel(String(input.level));
        publish(workspaceId, key);
        return entrySnapshot(state, key);
      },
    });
  };

  const define = (workspaceId: string): void => {
    const name = `${workspaceId}/sessions`;
    if (domain.resourceOf(name)) return;
    const state = stateOf(workspaceId);
    const resource = domain.resource(name);
    resource.snapshot(() => aggregateSnapshot(workspaceId));

    const agentFor = (key: string | null): SessionAgent => {
      const agent = key ? resolveAgent(workspaceId, key) : null;
      if (!agent) throw new CallFailure('failed', '没有运行中的会话');
      return agent;
    };
    const currentKey = (): string => {
      if (!state.current) throw new CallFailure('failed', '没有当前会话');
      return state.current;
    };

    resource.command('new', {
      summary: '新建会话',
      args: {},
      run: async () => {
        const draftKey = `draft-${++state.draftSeq}`;
        const agent = await port.ensureAgent(workspaceId, { draftKey });
        const key = agent.sessionKey;
        sessionEntryOf(state, key);
        state.current = key;
        defineSession(workspaceId, key);
        state.items = await port
          .listItems(workspaceId)
          .catch(() => state.items);
        publish(workspaceId, key);
        return aggregateSnapshot(workspaceId);
      },
    });
    resource.command('open', {
      summary: '打开会话',
      args: {
        id: { type: 'string' },
        sessionId: { type: 'string' },
      },
      run: async (input) => {
        const file = String(input.id ?? input.sessionId ?? '');
        if (!file) throw new CallFailure('invalid', '缺少会话文件');
        const agent = await port.ensureAgent(workspaceId, {
          sessionFile: file,
        });
        const key = agent.sessionKey;
        sessionEntryOf(state, key);
        state.opened = [...new Set([...state.opened, file])];
        state.current = key;
        defineSession(workspaceId, key);
        state.items = await port
          .listItems(workspaceId)
          .catch(() => state.items);
        publish(workspaceId, key);
        return aggregateSnapshot(workspaceId);
      },
    });
    resource.command('refresh', {
      summary: '刷新会话投影',
      args: {},
      run: async () => {
        state.items = await port
          .listItems(workspaceId)
          .catch(() => state.items);
        publish(workspaceId);
        return aggregateSnapshot(workspaceId);
      },
    });
    resource.command('prompt', {
      summary: '发送消息',
      args: { text: { type: 'string', required: true } },
      run: async (input) => {
        const agent = agentFor(currentKey());
        const entry = sessionEntryOf(state, state.current!);
        const text = String(input.text);
        const task: SessionTask = {
          id: ++state.taskSeq,
          sessionFile: agent.getSnapshot().sessionFile,
          status: 'running',
          request: text,
          attempt: 1,
          stage: '正在执行',
          error: null,
          mayHaveSideEffects: false,
          artifacts: [],
          tools: [],
        };
        entry.task = task;
        publish(workspaceId, state.current ?? undefined);
        try {
          await agent.prompt({ text });
          task.status = agent.getSnapshot().isStreaming
            ? 'unconfirmed'
            : 'done';
          task.stage = task.status === 'done' ? '本轮结束' : '等待执行结果';
        } catch (error) {
          task.status = 'failed';
          task.error = error instanceof Error ? error.message : String(error);
          task.stage = '本轮失败';
          throw error;
        } finally {
          publish(workspaceId, state.current ?? undefined);
        }
        return aggregateSnapshot(workspaceId);
      },
    });
    resource.command('abort', {
      summary: '中止当前回合',
      args: {},
      run: async () => {
        const agent = agentFor(currentKey());
        const entry = sessionEntryOf(state, state.current!);
        if (entry.task) {
          entry.task.status = 'stopping';
          entry.task.stage = '正在停止';
          publish(workspaceId, state.current ?? undefined);
        }
        await agent.abort();
        if (entry.task) {
          entry.task.status = agent.getSnapshot().isStreaming
            ? 'unconfirmed'
            : 'stopped';
          entry.task.stage = '已请求停止';
        }
        publish(workspaceId, state.current ?? undefined);
        return null;
      },
    });
    resource.command('setModel', {
      summary: '切换当前会话模型',
      args: {
        provider: { type: 'string', required: true },
        model: { type: 'string', required: true },
      },
      run: async (input) => {
        await agentFor(currentKey()).setModel(
          String(input.provider),
          String(input.model),
        );
        publish(workspaceId, state.current ?? undefined);
        return aggregateSnapshot(workspaceId);
      },
    });
    resource.command('steer', {
      summary: '插入当前回合',
      args: { text: { type: 'string', required: true } },
      run: async (input) => {
        await agentFor(currentKey()).steer(String(input.text));
        publish(workspaceId, state.current ?? undefined);
        return aggregateSnapshot(workspaceId);
      },
    });
    resource.command('followUp', {
      summary: '追加下一回合',
      args: { text: { type: 'string', required: true } },
      run: async (input) => {
        await agentFor(currentKey()).followUp(String(input.text));
        publish(workspaceId, state.current ?? undefined);
        return aggregateSnapshot(workspaceId);
      },
    });
    resource.command('compact', {
      summary: '压缩当前会话',
      args: { instructions: { type: 'string' } },
      run: async (input) => {
        const instructions = input.instructions;
        await agentFor(currentKey()).compact(
          typeof instructions === 'string' ? instructions : undefined,
        );
        publish(workspaceId, state.current ?? undefined);
        return aggregateSnapshot(workspaceId);
      },
    });
    resource.command('retry', {
      summary: '重试上一回合',
      args: { confirmed: { type: 'boolean' } },
      run: async () => {
        throw new CallFailure('failed', '当前 runtime 不支持 retry');
      },
    });
    resource.command('fork', {
      summary: '从消息分叉会话',
      args: {
        entryId: { type: 'string', required: true },
        position: { enum: ['before', 'after'] },
      },
      run: async (input) => {
        await agentFor(currentKey()).fork(
          String(input.entryId),
          input.position === 'before' ? 'before' : 'at',
        );
        publish(workspaceId, state.current ?? undefined);
        return aggregateSnapshot(workspaceId);
      },
    });
    resource.command('rename', {
      summary: '重命名会话',
      args: {
        name: { type: 'string', required: true },
        id: { type: 'string' },
        path: { type: 'string' },
      },
      run: (input) => {
        const file = String(input.id ?? input.path ?? '');
        const key = file ? encodeURIComponent(file) : currentKey();
        const agent = agentFor(key);
        agent.renameSession(
          file || (agent.getSnapshot().sessionFile ?? ''),
          String(input.name),
        );
        publish(workspaceId, key);
        return aggregateSnapshot(workspaceId);
      },
    });
    resource.command('delete', {
      summary: '删除会话',
      args: {
        id: { type: 'string' },
        path: { type: 'string' },
      },
      run: async (input) => {
        const file = String(input.id ?? input.path ?? '');
        const key = file ? encodeURIComponent(file) : currentKey();
        const agent = resolveAgent(workspaceId, key);
        if (agent) {
          await agent.deleteSession(
            file || (agent.getSnapshot().sessionFile ?? ''),
          );
          await port.disposeAgent(workspaceId, key);
        }
        state.opened = state.opened.filter((item) => item !== file);
        state.sessions.delete(key);
        if (state.current === key) {
          state.current = state.opened[0]
            ? encodeURIComponent(state.opened[0])
            : null;
        }
        domain.remove(`${workspaceId}/session/${key}`);
        state.items = await port
          .listItems(workspaceId)
          .catch(() => state.items);
        publish(workspaceId);
        return null;
      },
    });
    resource.command('setThinking', {
      summary: '切换当前思考等级',
      args: { level: { type: 'string', required: true } },
      run: (input) => {
        const agent = agentFor(currentKey());
        agent.setThinkingLevel(String(input.level));
        publish(workspaceId, state.current ?? undefined);
        return {
          level: String(input.level),
          levels: agent.session.getAvailableThinkingLevels?.() ?? [],
        };
      },
    });
    resource.command('closeOpened', {
      summary: '关闭已打开的会话标签',
      args: {},
      run: async (input) => {
        const paths = Array.isArray(input.paths)
          ? input.paths.filter(
              (item): item is string => typeof item === 'string',
            )
          : [];
        for (const file of paths) {
          const key = encodeURIComponent(file);
          await port.disposeAgent(workspaceId, key);
          state.opened = state.opened.filter((item) => item !== file);
          if (state.current === key) {
            state.current = state.opened[0]
              ? encodeURIComponent(state.opened[0])
              : null;
          }
          state.sessions.delete(key);
          domain.remove(`${workspaceId}/session/${key}`);
        }
        publish(workspaceId);
        return aggregateSnapshot(workspaceId);
      },
    });
  };

  const rekey = (workspaceId: string, from: string, to: string): void => {
    const state = stateOf(workspaceId);
    const entry = state.sessions.get(from);
    if (entry) {
      state.sessions.delete(from);
      entry.key = to;
      state.sessions.set(to, entry);
    }
    if (state.current === from) state.current = to;
    const file = resolveAgent(workspaceId, to)?.getSnapshot().sessionFile;
    if (file && !state.opened.includes(file)) {
      state.opened = [...state.opened, file];
    }
    domain.remove(`${workspaceId}/session/${from}`);
    defineSession(workspaceId, to);
    publish(workspaceId, to);
  };

  return {
    rekey,
    ensure: (workspaceId: string) => {
      const created = !registered.has(workspaceId);
      registered.add(workspaceId);
      stateOf(workspaceId);
      if (!created && domain.resourceOf(`${workspaceId}/sessions`)) return;
      define(workspaceId);
    },
    remove: (workspaceId: string) => {
      registered.delete(workspaceId);
      const state = states.get(workspaceId);
      if (state) {
        for (const key of state.opened) {
          domain.remove(`${workspaceId}/session/${key}`);
        }
      }
      states.delete(workspaceId);
      domain.remove(`${workspaceId}/sessions`);
    },
    publish,
    event: (workspaceId: string, key: string, name: string, data: unknown) => {
      domain.resourceOf(`${workspaceId}/session/${key}`)?.event(name, data);
    },
    stateOf,
  };
}

// ─── providers / models ─────────────────────────────────────

export interface ModelsState {
  providers: ProviderInfoView[];
  models: ModelCatalogItem[];
  config: ModelsConfigView;
}

/** 供应商作用域的模型视图：目录模型 + 自定义模型，避免前端跨供应商过滤。 */
export interface ProviderModelsView {
  providerId: string;
  catalog: ModelCatalogItem[];
  configured: ModelConfigView[];
}

export interface ModelResources {
  sync(): void;
}

export function createModelsState(): ModelsState {
  return { providers: [], models: [], config: { providers: {} } };
}

export function defineModelsResources(
  registry: DomainRegistry,
  state: ModelsState,
  host?: () => SessionAgent | null,
  browser?: BrowserCapability,
): ModelResources {
  const domain = registry.define('agent');
  const providers = domain.resource('providers');
  providers.snapshot(() => state.providers);

  const models = domain.resource('models');
  models.snapshot(() => state.models);

  const config = domain.resource('modelsConfig');
  config.snapshot(() => state.config);

  const ensureProvider = (providerId: string) => {
    const name = providerResourceName(providerId);
    if (domain.resourceOf(name)) return;
    const modelsOf = domain.resource(`${name}/models`);
    modelsOf.snapshot(
      (): ProviderModelsView => ({
        providerId,
        catalog: state.models.filter((model) => model.provider === providerId),
        configured: state.config.providers[providerId]?.models ?? [],
      }),
    );
    // 模型属于供应商：作用域资源上的命令不需要重复传 providerId。
    modelsOf.command('save', {
      summary: '保存该供应商下的模型',
      args: { modelId: { type: 'string', required: true } },
      run: async (input) => {
        const runtime = host?.();
        if (!runtime) throw new CallFailure('failed', 'agent runtime 未启动');
        await runtime.saveModel(providerId, {
          id: String(input.modelId),
          ...(typeof input.config === 'object' && input.config !== null
            ? input.config
            : {}),
        });
        sync();
        return null;
      },
    });
    modelsOf.command('delete', {
      summary: '删除该供应商下的模型',
      args: { modelId: { type: 'string', required: true } },
      run: async (input) => {
        const runtime = host?.();
        if (!runtime) throw new CallFailure('failed', 'agent runtime 未启动');
        await runtime.deleteModel(providerId, String(input.modelId));
        sync();
        return null;
      },
    });
    modelsOf.command('setDefault', {
      summary: '把该供应商下的模型设为当前模型',
      args: { modelId: { type: 'string', required: true } },
      run: async (input) => {
        const runtime = host?.();
        if (!runtime) throw new CallFailure('failed', 'agent runtime 未启动');
        await runtime.setModel(providerId, String(input.modelId));
        sync();
        return null;
      },
    });
    const resource = domain.resource(name);
    resource.snapshot(
      () =>
        state.providers.find((provider) => provider.id === providerId) ?? null,
    );
    // 两条路线分开：OAuth 叫登录/退出，API Key 只是配置/清除。
    resource.command('login', {
      summary: '登录供应商（OAuth）',
      args: {},
      run: async () => {
        const runtime = host?.();
        if (!runtime) throw new CallFailure('failed', 'agent runtime 未启动');
        await runtime.loginProvider({ providerId });
        resource.publish();
        return null;
      },
    });
    // API Key 只是配置：写入凭证，不产生登录语义。
    resource.command('configureApiKey', {
      summary: '配置供应商 API Key',
      args: { apiKey: { type: 'string', required: true } },
      run: async (input) => {
        const runtime = host?.();
        if (!runtime) throw new CallFailure('failed', 'agent runtime 未启动');
        await runtime.configureApiKey(providerId, String(input.apiKey));
        resource.publish();
        return null;
      },
    });
    resource.command('logout', {
      summary: '退出供应商登录（OAuth）',
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
    modelsOf.publish();
  };

  const publishProviderModels = (providerId: string): void => {
    domain.resourceOf(`${providerResourceName(providerId)}/models`)?.publish();
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
    // 自定义供应商可能还没进目录，也要能管理它下面的模型。
    for (const providerId of Object.keys(state.config.providers)) {
      ensureProvider(providerId);
    }
    for (const model of state.models) {
      ensureModel(model.provider, model.modelId);
    }
    providers.publish();
    models.publish();
    config.publish();
    for (const providerId of Object.keys(state.config.providers)) {
      publishProviderModels(providerId);
    }
    for (const provider of state.providers) publishProviderModels(provider.id);
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
  // 模型发现：用已存凭证拉 OpenAI 兼容的 /models，写回 models.json。
  providers.command('refreshModels', {
    summary: '按供应商凭证刷新模型目录',
    args: { providerId: { type: 'string', required: true } },
    run: async (input) => {
      const runtime = host?.();
      if (!runtime) throw new CallFailure('failed', 'agent runtime 未启动');
      const added = await runtime.refreshProviderModels(
        String(input.providerId),
      );
      sync();
      return { added };
    },
  });
  // 快捷登录：打开供应商登录页，等它回调本机后直接写库（主进程全程处理）。
  providers.command('openLogin', {
    summary: '打开供应商登录页并等待回调',
    args: { providerId: { type: 'string', required: true } },
    run: async (input) => {
      const runtime = host?.();
      if (!runtime) throw new CallFailure('failed', 'agent runtime 未启动');
      await runtime.loginViaPage(String(input.providerId));
      sync();
      return { ok: true };
    },
  });
  providers.command('save', {
    summary: '保存供应商配置',
    args: { providerId: { type: 'string', required: true } },
    run: async (input) => {
      const runtime = host?.();
      if (!runtime) throw new CallFailure('failed', 'agent runtime 未启动');
      await runtime.saveProvider(String(input.providerId), input.config);
      sync();
      return state.providers;
    },
  });
  providers.command('delete', {
    summary: '删除供应商配置',
    args: { providerId: { type: 'string', required: true } },
    run: async (input) => {
      const runtime = host?.();
      if (!runtime) throw new CallFailure('failed', 'agent runtime 未启动');
      await runtime.deleteProvider(String(input.providerId));
      sync();
      return null;
    },
  });
  models.command('save', {
    summary: '保存模型条目',
    args: {
      providerId: { type: 'string', required: true },
      modelId: { type: 'string', required: true },
    },
    run: async (input) => {
      const runtime = host?.();
      if (!runtime) throw new CallFailure('failed', 'agent runtime 未启动');
      await runtime.saveModel(String(input.providerId), {
        id: String(input.modelId),
        ...(typeof input.config === 'object' && input.config !== null
          ? input.config
          : {}),
      });
      sync();
      return state.models;
    },
  });
  models.command('delete', {
    summary: '删除模型条目',
    args: {
      providerId: { type: 'string', required: true },
      modelId: { type: 'string', required: true },
    },
    run: async (input) => {
      const runtime = host?.();
      if (!runtime) throw new CallFailure('failed', 'agent runtime 未启动');
      await runtime.deleteModel(
        String(input.providerId),
        String(input.modelId),
      );
      sync();
      return null;
    },
  });
  models.command('setDefault', {
    summary: '设为当前模型',
    args: {
      providerId: { type: 'string', required: true },
      modelId: { type: 'string', required: true },
    },
    run: async (input) => {
      const runtime = host?.();
      if (!runtime) throw new CallFailure('failed', 'agent runtime 未启动');
      await runtime.setModel(String(input.providerId), String(input.modelId));
      sync();
      return null;
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
  host?: () => SessionAgent | null,
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
  host?: () => SessionAgent | null,
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
  host?: () => SessionAgent | null,
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
  host?: () => SessionAgent | null,
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
