import type { AgentSnapshot, ParsedMessage } from '../../../shared/types.ts';
import type {
  SessionListItem,
  SessionStreamState,
} from '../../agent/sessions/service.ts';
import type { DomainRegistry } from '../../runtime/domains.ts';
import type { SessionTask } from '../../../shared/session-task.ts';

export interface SessionsActive {
  sessionId: string | null;
  messages: ParsedMessage[];
  stream: SessionStreamState;
}

export interface SessionsDeps {
  ensure(): Promise<void>;
  current(): AgentSnapshot | null;
  list(): SessionListItem[];
  commands(): Array<{ name: string; description: string; source: string }>;
  active(): SessionsActive;
  task(): SessionTask | null;
  opened(): string[];
  closeTabs(paths: string[]): void;
  newSession(): Promise<void>;
  open(sessionId: string): Promise<void>;
  prompt(input: {
    text: string;
    newSession?: boolean;
    activeSkills?: string[];
  }): Promise<void>;
  steer(text: string): Promise<void>;
  followUp(text: string): Promise<void>;
  abort(): Promise<void>;
  compact(instructions?: string): Promise<void>;
  retry(confirmed?: boolean): Promise<void>;
  fork(
    entryId: string,
    position?: 'before' | 'at',
    sessionId?: string,
  ): Promise<unknown>;
  rename(name: string, sessionId?: string): void;
  deleteActive(sessionId?: string): Promise<void>;
  setModel(provider: string, modelId: string): Promise<void>;
  refresh(): Promise<void>;
}

/** sessions：当前会话、列表、消息流、任务与操作。 */
export function defineSessionsDomain(
  registry: DomainRegistry,
  deps: SessionsDeps,
): void {
  const domain = registry.define('sessions');
  const current = domain.resource('current');
  const list = domain.resource('list');
  const commands = domain.resource('commands');
  const active = domain.resource('active');
  const task = domain.resource('task');
  const opened = domain.resource('opened');

  current.snapshot(() => deps.current());
  list.snapshot(() => deps.list());
  commands.snapshot(() => deps.commands());
  active.snapshot(() => deps.active());
  task.snapshot(() => deps.task());
  opened.snapshot(() => deps.opened());
  opened.command<{ paths: string[] }, null>('close', (call) => {
    deps.closeTabs(call.input.paths ?? []);
    opened.publish();
    return null;
  });

  const run = async <T>(action: () => T | Promise<T>): Promise<T> => {
    await deps.ensure();
    return action();
  };

  current.command<null, null>('new', () =>
    run(async () => {
      await deps.newSession();
      return null;
    }),
  );
  current.command<{ sessionId: string }, null>('open', (call) =>
    run(async () => {
      await deps.open(String(call.input.sessionId));
      return null;
    }),
  );
  current.command<
    { text: string; newSession?: boolean; activeSkills?: string[] },
    null
  >('prompt', (call) =>
    run(async () => {
      await deps.prompt(call.input);
      return null;
    }),
  );
  current.command<{ text: string }, null>('steer', (call) =>
    run(async () => {
      await deps.steer(String(call.input.text));
      return null;
    }),
  );
  current.command<{ text: string }, null>('followUp', (call) =>
    run(async () => {
      await deps.followUp(String(call.input.text));
      return null;
    }),
  );
  current.command<null, null>('abort', () =>
    run(async () => {
      await deps.abort();
      return null;
    }),
  );
  current.command<{ instructions?: string }, null>('compact', (call) =>
    run(async () => {
      await deps.compact(call.input?.instructions);
      return null;
    }),
  );
  current.command<{ confirmed?: boolean }, null>('retry', (call) =>
    run(async () => {
      await deps.retry(Boolean(call.input?.confirmed));
      return null;
    }),
  );
  current.command<
    { entryId: string; position?: 'before' | 'at'; path?: string },
    unknown
  >('fork', (call) =>
    run(() =>
      deps.fork(call.input.entryId, call.input.position, call.input.path),
    ),
  );
  current.command<{ name: string; path?: string }, null>('rename', (call) => {
    deps.rename(String(call.input.name), call.input.path);
    return null;
  });
  current.command<{ path?: string } | null, null>('delete', (call) =>
    run(async () => {
      await deps.deleteActive(call.input?.path);
      return null;
    }),
  );
  current.command<{ provider: string; modelId: string }, null>(
    'setModel',
    (call) =>
      run(async () => {
        await deps.setModel(call.input.provider, call.input.modelId);
        return null;
      }),
  );
  current.command<null, null>('refresh', () =>
    run(async () => {
      await deps.refresh();
      return null;
    }),
  );
}
