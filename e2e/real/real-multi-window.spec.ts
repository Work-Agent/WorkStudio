import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { closeApp, launchApp } from '../support/fixtures.ts';
import {
  configuredModel,
  prepareDataDir,
  workStudioDataRoot,
} from './support.ts';

/**
 * 多窗口并发：两个工作区窗口各自执行 agent 会话，互不阻塞、互不串流。
 * 仅在 WorkStudio 已配置模型时运行。
 */
test('两个工作区窗口可以同时执行 agent 会话', async () => {
  const sourceRoot = workStudioDataRoot();
  const configured = configuredModel(sourceRoot);
  test.skip(!configured, `WorkStudio 未配置模型：${sourceRoot}`);

  const dataDir = prepareDataDir(sourceRoot);
  const first = mkdtempSync(join(tmpdir(), 'work-studio-mw-a-'));
  const second = mkdtempSync(join(tmpdir(), 'work-studio-mw-b-'));
  const fixture = await launchApp(dataDir);
  try {
    const shellA = await findShell(fixture);
    const workspaceA = await openWorkspace(shellA, first);

    await shellA.evaluate(async () => {
      const result = await window.workStudio.command(
        'agent',
        `${String(window.workStudio.workspaceId)}/sessions`,
        'prompt',
        { text: '只回复：A' },
      );
      if (!result.ok) throw new Error(result.error.message);
    });

    // 打开第二个工作区会创建第二个窗口；B 的 prompt 与 A 并行。
    await shellA.evaluate(async (path) => {
      await window.workStudio.command('workspace', 'registry', 'open', {
        path,
      });
    }, second);
    await expect
      .poll(async () => fixture.app.windows().length, { timeout: 20_000 })
      .toBeGreaterThanOrEqual(2);
    const shellB = (
      await Promise.all(
        fixture.app
          .windows()
          .filter((page) => page.url().endsWith('/shell'))
          .map(async (page) => ({
            page,
            workspaceId: await page.evaluate(
              () => window.workStudio.workspaceId,
            ),
          })),
      )
    ).find((item) => item.workspaceId !== workspaceA)?.page;
    if (!shellB) throw new Error('没有找到第二个工作区窗口');

    const workspaceB = await shellB.evaluate(
      () => window.workStudio.workspaceId,
    );
    if (!workspaceB) throw new Error('第二个窗口没有绑定工作区');

    await shellB.evaluate(async () => {
      const result = await window.workStudio.command(
        'agent',
        `${String(window.workStudio.workspaceId)}/sessions`,
        'prompt',
        { text: '只回复：B' },
      );
      if (!result.ok) throw new Error(result.error.message);
    });

    const [textA, textB] = await Promise.all([
      awaitText(shellA, workspaceA, 'A'),
      awaitText(shellB, workspaceB, 'B'),
    ]);
    expect(textA.toUpperCase()).toContain('A');
    expect(textB.toUpperCase()).toContain('B');
  } finally {
    await closeApp(fixture, true, true);
    rmSync(first, { recursive: true, force: true });
    rmSync(second, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  }
});

async function findShell(fixture: {
  app: import('@playwright/test').ElectronApplication;
}): Promise<import('@playwright/test').Page> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const page = fixture.app
      .windows()
      .find((item) => item.url().endsWith('/shell'));
    if (page) return page;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('没有找到壳层页面');
}

async function openWorkspace(
  page: import('@playwright/test').Page,
  path: string,
): Promise<string> {
  await page.evaluate(async (target) => {
    await window.workStudio.command('workspace', 'registry', 'open', {
      path: target,
    });
  }, path);
  await expect
    .poll(
      async () =>
        page.evaluate(async (target) => {
          const state = (await window.workStudio.subscribe(
            'workspace',
            'registry',
          )) as { current?: { path?: string } | null };
          return state.current?.path === target;
        }, path),
      { timeout: 20_000 },
    )
    .toBe(true);
  const workspaceId = await page.evaluate(() => window.workStudio.workspaceId);
  if (!workspaceId) throw new Error('壳层没有绑定工作区');
  return workspaceId;
}

async function awaitText(
  page: import('@playwright/test').Page,
  workspaceId: string,
  expected: string,
): Promise<string> {
  await expect
    .poll(
      async () =>
        page.evaluate(async (id) => {
          const state = (await window.workStudio.subscribe(
            'agent',
            `${id}/sessions`,
          )) as {
            current?: { isStreaming?: boolean };
            active?: { stream?: { text?: string } };
          } | null;
          return {
            streaming: state?.current?.isStreaming === true,
            text: state?.active?.stream?.text ?? '',
          };
        }, workspaceId),
      { timeout: 180_000 },
    )
    .toMatchObject({ streaming: false });
  const text = await page.evaluate(async (id) => {
    const state = (await window.workStudio.subscribe(
      'agent',
      `${id}/sessions`,
    )) as { active?: { stream?: { text?: string } } } | null;
    return state?.active?.stream?.text ?? '';
  }, workspaceId);
  expect(text.toUpperCase()).toContain(expected);
  return text;
}
