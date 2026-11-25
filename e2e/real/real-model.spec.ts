import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { closeApp, launchApp, shellWindow } from '../support/fixtures.ts';
import {
  configuredModel,
  prepareDataDir,
  workStudioDataRoot,
} from './support.ts';

test('WorkStudio 已配置模型时完成一次真实 prompt / stream', async () => {
  const sourceRoot = workStudioDataRoot();
  const configured = configuredModel(sourceRoot);
  test.skip(!configured, `WorkStudio 未配置模型：${sourceRoot}`);

  const dataDir = prepareDataDir(sourceRoot);
  const workspaceDir = mkdtempSync(join(tmpdir(), 'work-studio-real-ws-'));

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

    await shell.evaluate(async () => {
      const result = await window.workStudio.command(
        'agent',
        `${String(window.workStudio.workspaceId)}/sessions`,
        'prompt',
        { text: '只回复：OK' },
      );
      if (!result.ok) throw new Error(result.error.message);
    });

    await expect
      .poll(
        async () =>
          shell.evaluate(async () => {
            const state = (await window.workStudio.subscribe(
              'agent',
              `${String(window.workStudio.workspaceId)}/sessions`,
            )) as {
              current?: { isStreaming?: boolean };
              active?: { messages?: unknown[]; stream?: { text?: string } };
            } | null;
            return {
              streaming: state?.current?.isStreaming === true,
              messages: state?.active?.messages?.length ?? 0,
              text: state?.active?.stream?.text ?? '',
            };
          }),
        { timeout: 90_000 },
      )
      .toMatchObject({ streaming: false });

    const text = await shell.evaluate(async () => {
      const state = (await window.workStudio.subscribe(
        'agent',
        `${String(window.workStudio.workspaceId)}/sessions`,
      )) as { active?: { stream?: { text?: string } } } | null;
      return state?.active?.stream?.text ?? '';
    });
    expect(text.toUpperCase()).toContain('OK');
  } finally {
    await closeApp(fixture, true, true);
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});
