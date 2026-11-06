import { test as base, expect, type Page } from '@playwright/test';
import { closeView, currentPath, switchWorkspace, viewList } from './commands';
import type { AppFixture } from './fixtures';
import { closeApp, launchApp, shellWindow } from './fixtures';

type WorkerApp = AppFixture & { initialWorkspace: string | null };

interface WorkerFixtures {
  electron: WorkerApp;
  dataDir: string;
}

interface TestFixtures {
  shell: Page;
  reset: void;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  electron: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const fixture = await launchApp();
      const shell = await shellWindow(fixture.app);
      const initialWorkspace = await currentPath(shell);
      await use({ ...fixture, initialWorkspace });
      await closeApp(fixture, true, true);
    },
    { scope: 'worker' },
  ],

  dataDir: [
    async ({ electron }, use) => {
      await use(electron.dataDir);
    },
    { scope: 'worker' },
  ],

  shell: async ({ electron }, use) => {
    await use(await shellWindow(electron.app));
  },

  reset: [
    async ({ electron, shell }, use) => {
      for (const view of await viewList(shell)) {
        await closeView(shell, view.id);
      }
      const current = await currentPath(shell);
      if (electron.initialWorkspace && current !== electron.initialWorkspace) {
        await switchWorkspace(shell, electron.initialWorkspace);
      }
      await use();
    },
    { auto: true },
  ],
});

export { expect };
