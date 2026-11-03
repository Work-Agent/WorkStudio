/**
 * 极简 CDP 客户端：只依赖 Electron 自带的 remote debugging 端口。
 *
 * dev extension 持有长连接；Playwright 不参与。
 */
import { writeFileSync } from 'node:fs';

export const CDP_ENDPOINT = 'http://127.0.0.1:9222/json/list';

export interface CdpTarget {
  id: string;
  type: string;
  title?: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

const SHELL_TARGET =
  /(?:localhost|127\.0\.0\.1):\d+\/index\.html$|^file:.*\/index\.html$/;

function isShellTarget(target: CdpTarget): boolean {
  return (
    target.type === 'page' &&
    !!target.webSocketDebuggerUrl &&
    !/overlay/i.test(target.url) &&
    !/overlay/i.test(target.title ?? '') &&
    SHELL_TARGET.test(target.url)
  );
}

export async function listCdpTargets(
  endpoint = CDP_ENDPOINT,
): Promise<CdpTarget[]> {
  const response = await fetch(endpoint, {
    signal: AbortSignal.timeout(1500),
  });
  if (!response.ok) {
    throw new Error(`CDP 未响应（${endpoint}）`);
  }
  return (await response.json()) as CdpTarget[];
}

export async function findShellTarget(
  endpoint = CDP_ENDPOINT,
): Promise<CdpTarget> {
  const targets = await listCdpTargets(endpoint);
  const target = targets.find(isShellTarget);
  if (!target) throw new Error('未找到 WorkStudio 壳层页面 target');
  return target;
}

export async function waitForCdpTarget(
  pattern: RegExp,
  options: { endpoint?: string; timeoutMs?: number } = {},
): Promise<CdpTarget> {
  const endpoint = options.endpoint ?? CDP_ENDPOINT;
  const deadline = Date.now() + (options.timeoutMs ?? 10_000);
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const target = (await listCdpTargets(endpoint)).find(
        (item) =>
          item.type === 'page' &&
          !!item.webSocketDebuggerUrl &&
          pattern.test(`${item.title ?? ''} ${item.url}`),
      );
      if (target) return target;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `等待 CDP target 超时：${pattern}${
      lastError instanceof Error ? `（${lastError.message}）` : ''
    }`,
  );
}

interface PendingCommand {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class CdpSession {
  readonly target: CdpTarget;
  private readonly socket: WebSocket;
  private pending = new Map<number, PendingCommand>();
  private seq = 0;
  private closed = false;

  private constructor(target: CdpTarget, socket: WebSocket) {
    this.target = target;
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String((event as MessageEvent).data)) as {
        id?: number;
        error?: { message: string };
        result?: unknown;
      };
      if (message.id == null) return;
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
    });
    socket.addEventListener('close', () => {
      this.closed = true;
      for (const entry of this.pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error('CDP 连接已关闭'));
      }
      this.pending.clear();
    });
  }

  static async connect(target: CdpTarget): Promise<CdpSession> {
    if (!target.webSocketDebuggerUrl) {
      throw new Error(`target 缺少 WebSocket 地址：${target.url}`);
    }
    const WebSocketCtor = (
      globalThis as { WebSocket?: new (url: string) => WebSocket }
    ).WebSocket;
    if (!WebSocketCtor) throw new Error('当前运行环境没有 WebSocket');

    const socket = new WebSocketCtor(target.webSocketDebuggerUrl);
    const opened = await new Promise<boolean>((resolve) => {
      socket.addEventListener('open', () => resolve(true), { once: true });
      socket.addEventListener('error', () => resolve(false), { once: true });
    });
    if (!opened) throw new Error(`CDP WebSocket 连接失败：${target.url}`);

    const session = new CdpSession(target, socket);
    await session.send('Page.enable').catch(() => undefined);
    await session.send('Runtime.enable').catch(() => undefined);
    return session;
  }

  static async connectShell(endpoint = CDP_ENDPOINT): Promise<CdpSession> {
    return CdpSession.connect(await findShellTarget(endpoint));
  }

  static async connectTo(
    pattern: RegExp,
    endpoint = CDP_ENDPOINT,
  ): Promise<CdpSession> {
    return CdpSession.connect(await waitForCdpTarget(pattern, { endpoint }));
  }

  isClosed(): boolean {
    return this.closed;
  }

  async send(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 8_000,
  ): Promise<any> {
    if (this.closed) throw new Error('CDP 连接已关闭');
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} 超时（${timeoutMs}ms）`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate<T = unknown>(expression: string): Promise<T> {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result?.exceptionDetails) {
      const detail =
        result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text ??
        '页面脚本执行失败';
      throw new Error(detail);
    }
    return result?.result?.value as T;
  }

  async evaluateFunction<T = unknown>(fn: () => T | Promise<T>): Promise<T> {
    return this.evaluate<T>(`(${fn.toString()})()`);
  }

  async screenshot(path: string): Promise<string> {
    const shot = (await this.send(
      'Page.captureScreenshot',
      { format: 'png' },
      15_000,
    )) as { data: string };
    writeFileSync(path, Buffer.from(shot.data, 'base64'));
    return path;
  }

  close(): void {
    this.closed = true;
    this.socket.close();
  }
}
