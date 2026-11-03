import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/specs',
  globalSetup:
    process.env['E2E_DEV'] === '1'
      ? './e2e/support/global-setup.ts'
      : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  projects: [
    {
      name: 'shared',
      testIgnore: [/restart\.spec/, /workspace\.spec/, /theme\.spec/],
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
