import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '../support/app';
import { openResource, switchWorkspace } from '../support/commands';
import { windowByUrl } from '../support/fixtures';
import { fileRef } from '../../src/shared/ura';

interface NativeViewInfo {
  url: string;
  visible: boolean;
}

/** 主进程侧读原生视图（顺序即栈序：后挂的 WebContentsView 在上层）。 */
async function nativeViews(
  app: ElectronApplication,
): Promise<NativeViewInfo[]> {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return (
      win.contentView.children as unknown as Array<{
        webContents: { getURL(): string };
        getVisible(): boolean;
      }>
    ).map((view) => ({
      url: view.webContents.getURL(),
      visible: view.getVisible(),
    }));
  });
}

async function visibleByUrl(
  app: ElectronApplication,
  pattern: RegExp,
): Promise<boolean | null> {
  const views = await nativeViews(app);
  return views.find((view) => pattern.test(view.url))?.visible ?? null;
}

/** 还原停靠形态：浮动态是场景持久状态，会污染同一 worker 的后续用例。 */
async function dockAssistant(assistant: Page): Promise<void> {
  await assistant.getByRole('button', { name: '更多对话操作' }).click();
  await assistant.getByTitle('停靠到右栏').click();
  await expect(assistant.locator('.agent-page')).not.toHaveClass(/is-floating/);
}

test('助手视图加载并显示未配置状态', async ({ electron }) => {
  const assistant = await windowByUrl(electron.app, /assistant\.html/);
  await expect(
    assistant.getByRole('button', { name: '连接模型', exact: true }),
  ).toBeVisible();
  await expect(assistant.locator('textarea')).toBeDisabled();
  await expect
    .poll(() => assistant.evaluate(() => typeof window.appBridge?.call))
    .toBe('function');
});

test('浮动助手压在内容视图之上（不被内容区遮蔽）', async ({
  shell,
  electron,
  dataDir,
}) => {
  const workspace = join(dataDir, 'fixtures', 'floating-stack');
  mkdirSync(workspace, { recursive: true });
  const file = join(workspace, 'note.md');
  writeFileSync(file, '# 浮层\n\nbody\n', 'utf-8');

  await switchWorkspace(shell, workspace);
  await openResource(shell, fileRef(file));
  await windowByUrl(electron.app, /markdown-viewer\/index\.html/);

  const assistant = await windowByUrl(electron.app, /assistant\.html/);
  await assistant.getByRole('button', { name: '更多对话操作' }).click();
  await assistant.getByTitle('浮动为独立面板').click();
  await expect(assistant.locator('.agent-page')).toHaveClass(/is-floating/);

  const stack = (await nativeViews(electron.app)).map((view) => view.url);
  const assistantIndex = stack.findIndex((url) => /assistant\.html/.test(url));
  const contentIndex = stack.findIndex((url) =>
    /markdown-viewer\/index\.html/.test(url),
  );
  expect(assistantIndex).toBeGreaterThan(-1);
  expect(contentIndex).toBeGreaterThan(-1);
  expect(assistantIndex).toBeGreaterThan(contentIndex);

  await dockAssistant(assistant);
});

test('浮动助手收起后隐藏、展开后恢复', async ({ shell, electron }) => {
  const assistant = await windowByUrl(electron.app, /assistant\.html/);
  await assistant.getByRole('button', { name: '更多对话操作' }).click();
  await assistant.getByTitle('浮动为独立面板').click();
  await expect(assistant.locator('.agent-page')).toHaveClass(/is-floating/);

  await shell.getByTitle('收起 AI 对话').click();
  await expect
    .poll(() => visibleByUrl(electron.app, /assistant\.html/))
    .toBe(false);

  await shell.getByTitle('展开 AI 对话').click();
  await expect
    .poll(() => visibleByUrl(electron.app, /assistant\.html/))
    .toBe(true);

  await dockAssistant(assistant);
});

test('浮动助手拖拽期间挂载指针捕获层', async ({ electron }) => {
  const assistant = await windowByUrl(electron.app, /assistant\.html/);
  await assistant.getByRole('button', { name: '更多对话操作' }).click();
  await assistant.getByTitle('浮动为独立面板').click();
  await expect(assistant.locator('.agent-page')).toHaveClass(/is-floating/);

  const capture = /^data:text\/html/;
  await expect.poll(() => visibleByUrl(electron.app, capture)).toBe(false);

  // 从标题栏把手按下：主进程应立即挂上全窗捕获层。
  await assistant.getByTitle('拖动以移动').hover();
  await assistant.mouse.down();
  await expect.poll(() => visibleByUrl(electron.app, capture)).toBe(true);
  await assistant.mouse.up();
  await expect.poll(() => visibleByUrl(electron.app, capture)).toBe(false);

  await dockAssistant(assistant);
});
