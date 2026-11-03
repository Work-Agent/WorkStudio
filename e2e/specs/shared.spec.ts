import { test } from '../support/app';
import { runPlaywrightCase } from '../runner/playwright-adapter.ts';
import { cases } from '../runner/registry.ts';

/**
 * Playwright 薄壳：只负责启动隔离进程和注入 fixture。
 * 真正的用户路径全部在 e2e/cases，由 dev extension 的 CDP runner 共用。
 */
for (const testCase of cases) {
  test(testCase.title, async ({ shell, electron }) => {
    await runPlaywrightCase(testCase, { shell, app: electron.app });
  });
}
