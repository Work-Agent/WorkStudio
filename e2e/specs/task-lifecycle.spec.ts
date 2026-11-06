import { test, expect } from '@playwright/test';
import { SessionsService } from '../../src/main/service/sessions';
import { PluginsService } from '../../src/main/service/plugins';
import type { AgentHost } from '../../src/main/agent/agent-host';
import type { PluginsDeps } from '../../src/main/service/plugins';
import type { PiSessionEvent } from '../../src/shared/types';
import type { InstallObserver } from '../../src/shared/plugin-install';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function agentHarness() {
  let streaming = false;
  let seq = 0;
  let run = async (_input: unknown) => {};
  let stop = async () => {
    streaming = false;
  };
  const inputs: unknown[] = [];
  const agent = {
    get currentSeq() {
      return seq;
    },
    getSnapshot: () => ({
      sessionFile: '/tmp/task.jsonl',
      workspacePath: '/tmp',
      isStreaming: streaming,
    }),
    getMessages: async () => [],
    listSessions: async () => [],
    prompt: async (input: unknown) => {
      inputs.push(input);
      streaming = true;
      try {
        await run(input);
      } finally {
        streaming = false;
      }
    },
    abort: async () => stop(),
    newSession: async () => {},
    switchSession: async () => {},
  } as unknown as AgentHost;
  const service = new SessionsService(agent);
  const push = (event: PiSessionEvent) =>
    service.receiveFrame({ seq: ++seq, event });
  return {
    service,
    inputs,
    push,
    run: (fn: typeof run) => {
      run = fn;
    },
    stop: (fn: typeof stop) => {
      stop = fn;
    },
  };
}

test('停止等待确认，完成回调不把已停止任务改成成功', async () => {
  const h = agentHarness();
  const gate = deferred();
  h.run(async () => {
    await gate.promise;
    h.push({
      type: 'error',
      message: 'Request was aborted',
    } as unknown as PiSessionEvent);
    throw new Error('Request was aborted');
  });
  const pending = h.service.prompt({ text: '执行原请求' });
  expect(h.service.task?.status).toBe('running');
  await expect(h.service.newSession()).rejects.toThrow('先停止');
  await h.service.abort();
  expect(h.service.task?.status).toBe('stopped');
  gate.resolve();
  await pending;
  expect(h.service.task?.status).toBe('stopped');
});

test('停止未确认时禁止重试，实际结束后才能继续', async () => {
  const h = agentHarness();
  const gate = deferred();
  h.run(() => gate.promise);
  h.stop(async () => {});
  const pending = h.service.prompt({ text: '等待操作' });
  await h.service.abort();
  expect(h.service.task?.status).toBe('unconfirmed');
  await expect(h.service.prompt({ text: '重复操作' })).rejects.toThrow(
    '尚未结束',
  );
  gate.resolve();
  await pending;
  expect(h.service.task?.status).toBe('stopped');
});

test('实际写入成果可打开；失败重试保留原请求并要求检查已有操作', async () => {
  const h = agentHarness();
  h.run(async () => {
    h.push({
      type: 'tool_execution_start',
      toolCallId: 'w',
      toolName: 'write',
      args: { path: 'report.md' },
    });
    h.push({
      type: 'tool_execution_end',
      toolCallId: 'w',
      isError: false,
      result: 'written',
    });
    throw new Error('连接中断');
  });
  await h.service.prompt({ text: '整理报告', activeSkills: ['research'] });
  expect(h.service.task).toMatchObject({
    status: 'failed',
    error: '连接中断',
    mayHaveSideEffects: true,
    artifacts: [{ ref: 'file:///tmp/report.md', label: 'report.md' }],
  });
  await expect(h.service.retry()).rejects.toThrow('先检查成果');
  h.run(async () => {});
  await h.service.retry(true);
  expect(h.service.task).toMatchObject({
    status: 'done',
    attempt: 2,
    request: '整理报告',
    artifacts: [],
  });
  expect(h.inputs).toEqual([
    { text: '整理报告', activeSkills: ['research'] },
    { text: '整理报告', activeSkills: ['research'], newSession: false },
  ]);
});

test('插件加载失败与安装成功分别报告，重试只重新加载', async () => {
  let installs = 0,
    loads = 0;
  const entry = {
    source: '/tmp/demo',
    type: 'local',
    name: 'demo',
    version: '1.0.0',
  };
  const service = new PluginsService({
    service: {
      list: () => [entry],
      installRootOf: () => '/tmp/demo',
      install: async (_source: string, observer: InstallObserver) => {
        installs++;
        observer.progress?.({ phase: 'verify', message: '校验' });
        observer.progress?.({ phase: 'install', message: '登记' });
        return entry;
      },
    },
    host: {
      activate: async () => {
        loads++;
        if (loads === 1) throw new Error('注册失败');
        return {};
      },
      pluginInfoList: () => [],
    },
  } as unknown as PluginsDeps);
  await expect(service.install(entry.source)).rejects.toThrow('注册失败');
  expect(service.task).toMatchObject({
    status: 'failed',
    phase: 'load',
    installed: true,
    loaded: false,
  });
  await service.retryInstall();
  expect(installs).toBe(1);
  expect(loads).toBe(2);
  expect(service.task).toMatchObject({
    status: 'done',
    installed: true,
    loaded: true,
    attempt: 2,
  });
});

test('取消插件下载等待实际中止，不发出已安装或已加载状态', async () => {
  const entered = deferred();
  const service = new PluginsService({
    service: {
      install: async (_source: string, observer: InstallObserver) => {
        entered.resolve();
        await new Promise((_resolve, reject) =>
          observer.signal!.addEventListener('abort', () =>
            reject(observer.signal!.reason),
          ),
        );
      },
    },
    host: {},
  } as unknown as PluginsDeps);
  const pending = service.install('https://example.test/demo.zip');
  const rejected = expect(pending).rejects.toThrow('取消');
  await entered.promise;
  service.cancelInstall();
  expect(service.task?.status).toBe('cancelling');
  await rejected;
  expect(service.task).toMatchObject({
    status: 'cancelled',
    installed: false,
    loaded: false,
  });
});
