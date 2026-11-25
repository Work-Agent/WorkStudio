import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { closeApp, launchApp, shellWindow } from '../support/fixtures.ts';
import {
  configuredModel,
  prepareDataDir,
  workStudioDataRoot,
} from './support.ts';

interface SessionView {
  stream?: { streaming?: boolean; text?: string };
  messages?: unknown[];
}

/**
 * 同一工作区的两个会话并行执行：每个会话有自己的 pi runtime，
 * 互不阻塞、互不串流。仅在 WorkStudio 已配置模型时运行。
 */
test('同一工作区多个会话可并行执行', async () => {
  const sourceRoot = workStudioDataRoot();
  const configured = configuredModel(sourceRoot);
  test.skip(!configured, `WorkStudio 未配置模型：${sourceRoot}`);

  const dataDir = prepareDataDir(sourceRoot);
  const workspaceDir = mkdtempSync(join(tmpdir(), 'work-studio-concurrent-'));
  const fixture = await launchApp(dataDir);
  try {
    const shell = await shellWindow(fixture.app);
    await shell.evaluate(async (path) => {
      await window.workStudio.command('workspace', 'registry', 'open', {
        path,
      });
    }, workspaceDir);
    await expect
      .poll(
        async () =>
          shell.evaluate(async () => {
            const state = (await window.workStudio.subscribe(
              'workspace',
              'registry',
            )) as { current?: { path?: string } | null };
            return state.current?.path ?? null;
          }),
        { timeout: 20_000 },
      )
      .toBe(workspaceDir);

    const sessions = await shell.evaluate(async () => {
      const created: string[] = [];
      for (let index = 0; index < 2; index += 1) {
        const result = await window.workStudio.command<{
          current?: { sessionFile?: string | null } | null;
        }>('agent', `${String(window.workStudio.workspaceId)}/sessions`, 'new');
        if (!result.ok) throw new Error(result.error.message);
        const file = result.data.current?.sessionFile ?? '';
        if (!file) throw new Error('新会话没有会话文件');
        created.push(encodeURIComponent(file));
      }
      return created;
    });
    expect(sessions).toHaveLength(2);

    // 两个会话并行发送：Promise.all 不会互相等待。
    await shell.evaluate(async (keys) => {
      const workspaceId = String(window.workStudio.workspaceId);
      const prompts = keys.map((key, index) =>
        window.workStudio.command(
          'agent',
          `${workspaceId}/session/${key}`,
          'prompt',
          { text: `只回复：${index === 0 ? 'A' : 'B'}` },
        ),
      );
      const results = await Promise.all(prompts);
      for (const result of results) {
        if (!result.ok) throw new Error(result.error.message);
      }
    }, sessions);

    await expect
      .poll(
        async () =>
          shell.evaluate(async (keys) => {
            const workspaceId = String(window.workStudio.workspaceId);
            const states = await Promise.all(
              keys.map(
                async (key) =>
                  (await window.workStudio.subscribe(
                    'agent',
                    `${workspaceId}/session/${key}`,
                  )) as SessionView | null,
              ),
            );
            return states.map((state) => ({
              streaming: state?.stream?.streaming === true,
              text: state?.stream?.text ?? '',
              messages: state?.messages?.length ?? 0,
            }));
          }, sessions),
        { timeout: 180_000 },
      )
      .toMatchObject([{ streaming: false }, { streaming: false }]);

    const texts = await shell.evaluate(async (keys) => {
      const workspaceId = String(window.workStudio.workspaceId);
      const states = await Promise.all(
        keys.map(
          async (key) =>
            (await window.workStudio.subscribe(
              'agent',
              `${workspaceId}/session/${key}`,
            )) as SessionView | null,
        ),
      );
      return states.map((state) => state?.stream?.text ?? '');
    }, sessions);
    expect(texts[0]?.toUpperCase()).toContain('A');
    expect(texts[1]?.toUpperCase()).toContain('B');
  } finally {
    await closeApp(fixture, true, true);
    rmSync(workspaceDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  }
});
