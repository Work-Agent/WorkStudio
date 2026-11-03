import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from './app';
import type { Page } from '@playwright/test';
import { windowByUrl } from './fixtures';

async function bridgeWindow(
  app: Parameters<typeof windowByUrl>[0],
  pattern: RegExp,
): Promise<Page> {
  for (const page of app.windows().filter((item) => pattern.test(item.url()))) {
    const ready = await page
      .evaluate(() =>
        Boolean((window as unknown as { appBridge?: unknown }).appBridge),
      )
      .catch(() => false);
    if (ready) return page;
  }
  throw new Error(`bridge window not found: ${pattern}`);
}

test('设置页命令经过新桥可用', async ({ electron, shell }) => {
  const opened = await shell.evaluate(async () =>
    window.appBridge!.call('/settings/open', { pageId: 'skills' }),
  );
  expect(opened.ok).toBe(true);
  const page = await windowByUrl(electron.app, /settings\/skills\/index\.html/);
  const result = await page.evaluate(async () => {
    try {
      const response = await window.appBridge!.call<{
        skills: unknown[];
      }>('/piconf/skills/view');
      if (!response.ok) throw new Error(response.error.message);
      return { ok: true, hasSkills: Array.isArray(response.data.skills) };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  });
  expect(result).toEqual({ ok: true, hasSkills: true });
});

test('切换工作区后 Agent 也切到新域', async ({ shell }) => {
  const target = mkdtempSync(join(tmpdir(), 'wa-workspace-domain-'));
  await shell.evaluate(
    async (path) => window.appBridge!.call('/workspaces/open', { path }),
    target,
  );
  await expect
    .poll(async () =>
      shell.evaluate(async () => {
        const current = await window.appBridge!.peek<{
          id: string;
        }>('/workspaces/current');
        if (!current) return null;
        const agent = await window.appBridge!.peek<{
          workspacePath?: string;
        }>(`/workspaces/${current.id}/sessions/current`);
        return agent?.workspacePath ?? null;
      }),
    )
    .toBe(target);
});

test('助手会话标签跟随当前会话而不是资源视图', async ({ electron, shell }) => {
  await shell.evaluate(async () => {
    const current = await window.appBridge!.peek<{ id: string }>(
      '/workspaces/current',
    );
    if (current) {
      await window.appBridge!.call(`/workspaces/${current.id}/sessions/new`);
    }
  });
  const assistant = await windowByUrl(electron.app, /assistant\.html/);
  await expect
    .poll(() =>
      assistant.evaluate(
        () => document.querySelector('[data-testid="chat-tab-new"]') === null,
      ),
    )
    .toBe(true);
});

test('对话框请求经 overlay 状态展示并能应答', async ({ electron, shell }) => {
  await shell.evaluate(async () =>
    window.appBridge!.call('/dialogs/open', {
      request: {
        type: 'dialog',
        id: 'regression-dialog',
        dialogType: 'confirm',
        title: '回归对话框',
        message: '请确认',
      },
    }),
  );
  const overlay = await bridgeWindow(electron.app, /overlay\.html/);
  await expect
    .poll(() =>
      overlay.evaluate(
        () =>
          document.body.innerText.includes('回归对话框') &&
          !document.body.innerText.includes('正在加载'),
      ),
    )
    .toBe(true);
  await overlay.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find(
      (item) => item.textContent === '确认',
    ) as HTMLButtonElement | undefined;
    button?.click();
  });
  await expect
    .poll(() =>
      overlay.evaluate(async () => {
        const dialogs =
          await window.appBridge!.peek<Array<{ status: string }>>('/dialogs');
        return dialogs?.[0]?.status ?? 'none';
      }),
    )
    .toBe('resolved');
});
