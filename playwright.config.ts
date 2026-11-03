import { defineConfig } from '@playwright/test';

const attach = process.env['E2E_ATTACH'] === '1';

export default defineConfig({
  testDir: './e2e',
  globalSetup:
    !attach && process.env['E2E_DEV'] === '1'
      ? './e2e/global-setup.ts'
      : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  projects: attach
    ? [{ name: 'dev-attach', testMatch: [/dev-attach\.spec\.ts/] }]
    : [
        {
          name: 'shared',
          testIgnore: [
            /restart\.spec/,
            /workspace\.spec/,
            /theme\.spec/,
            /dev-attach\.spec/,
          ],
        },
        {
          name: 'isolated',
          testMatch: [/restart\.spec/, /workspace\.spec/, /theme\.spec/],
        },
      ],
  use: {
    trace: 'retain-on-failure',
  },
});
