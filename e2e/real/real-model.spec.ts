import { existsSync, mkdtempSync, readFileSync, rmSync, cpSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { closeApp, launchApp, shellWindow } from '../support/fixtures.ts';

interface Settings {
  defaultProvider?: unknown;
  defaultModel?: unknown;
}

function workStudioDataRoot(): string {
  if (process.env['WA_DATA_DIR']) return process.env['WA_DATA_DIR'];
  if (process.platform === 'darwin') {
    return join(
      homedir(),
      'Library',
      'Application Support',
      'WorkStudio',
      'data',
    );
  }
  if (process.platform === 'win32') {
    return join(
      process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming'),
      'WorkStudio',
      'data',
    );
  }
  return join(
    process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config'),
    'WorkStudio',
    'data',
  );
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function configuredModel(root: string): {
  provider: string;
  model: string;
} | null {
  const auth = readJson<Record<string, { key?: string }>>(
    join(root, 'auth.json'),
  );
  const models = readJson<{ providers?: Record<string, unknown> }>(
    join(root, 'models.json'),
  );
  const settings = readJson<Settings>(join(root, 'settings.json'));
  if (!auth || !models || !settings) return null;
  const provider = settings.defaultProvider;
  const model = settings.defaultModel;
  if (typeof provider !== 'string' || typeof model !== 'string') return null;
  if (!auth[provider]?.key) return null;
  return { provider, model };
}

test('WorkStudio 已配置模型时完成一次真实 prompt / stream', async () => {
  const sourceRoot = workStudioDataRoot();
  const configured = configuredModel(sourceRoot);
  test.skip(!configured, `WorkStudio 未配置模型：${sourceRoot}`);

  const dataDir = mkdtempSync(join(tmpdir(), 'work-studio-real-'));
  const workspaceDir = mkdtempSync(join(tmpdir(), 'work-studio-real-ws-'));
  cpSync(join(sourceRoot, 'auth.json'), join(dataDir, 'auth.json'));
  if (existsSync(join(sourceRoot, 'models.json'))) {
    cpSync(join(sourceRoot, 'models.json'), join(dataDir, 'models.json'));
  }
  cpSync(join(sourceRoot, 'settings.json'), join(dataDir, 'settings.json'));

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
        'sessions',
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
              'sessions',
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
        'sessions',
      )) as { active?: { stream?: { text?: string } } } | null;
      return state?.active?.stream?.text ?? '';
    });
    expect(text.toUpperCase()).toContain('OK');
  } finally {
    await closeApp(fixture, true, true);
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});
