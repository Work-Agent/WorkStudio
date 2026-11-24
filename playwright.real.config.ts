import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/real',
  timeout: 180_000,
  expect: { timeout: 90_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
});
