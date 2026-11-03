import { CdpSession, CDP_ENDPOINT } from './cdp.ts';
import { createCdpContext } from './cdp-context.ts';
import type { E2ECase } from './contract.ts';
import { selectCases, type CaseFilter } from './registry.ts';

export interface CaseResult {
  id: string;
  title: string;
  ok: boolean;
  error?: string;
  screenshot?: string;
}

export interface RunOptions {
  endpoint?: string;
  allowMutating?: boolean;
  screenshotPath?: string;
  /** 传入常驻连接时由调用方持有；否则本次运行结束后关闭。 */
  session?: CdpSession;
}

async function closeOpenViews(session: CdpSession): Promise<void> {
  const views = await session.evaluate<Array<{ id: string }> | null>(
    `window.appBridge.peek('/views')`,
  );
  for (const view of views ?? []) {
    await session.evaluate(`window.appBridge.call('/views/${view.id}/close')`);
  }
}

export async function runCdpCases(
  testCases: readonly E2ECase[],
  options: RunOptions,
): Promise<CaseResult[]> {
  const ownSession = !options.session;
  const session =
    options.session ?? (await CdpSession.connectShell(options.endpoint));
  const results: CaseResult[] = [];

  try {
    for (const testCase of testCases) {
      // 每个用例从壳层开始，避免上一个用例的标签/侧栏状态污染。
      await closeOpenViews(session).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const ctx = createCdpContext(session, {
        endpoint: options.endpoint ?? CDP_ENDPOINT,
        screenshotPath: options.screenshotPath,
      });
      try {
        await testCase.run(ctx);
        results.push({ id: testCase.id, title: testCase.title, ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const shot = await ctx.screenshot().catch(() => undefined);
        results.push({
          id: testCase.id,
          title: testCase.title,
          ok: false,
          error: message,
          screenshot: shot,
        });
      } finally {
        ctx.dispose?.();
      }
    }
  } finally {
    await closeOpenViews(session).catch(() => undefined);
    if (ownSession) session.close();
  }
  return results;
}

export async function runCdpFilter(
  filter: CaseFilter,
  options: Omit<RunOptions, 'filter'> = {},
): Promise<CaseResult[]> {
  const selected = selectCases(filter, {
    allowMutating: options.allowMutating,
  });
  return runCdpCases(selected, options);
}
