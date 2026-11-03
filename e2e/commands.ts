import type { Page } from '@playwright/test';

interface ViewInfo {
  id: string;
  title: string;
  active: boolean;
}

export async function hasNext(page: Page): Promise<boolean> {
  return page
    .evaluate(() => window.appBridge?.available?.().catch(() => false) ?? false)
    .catch(() => false);
}

export async function currentPath(page: Page): Promise<string | null> {
  return page
    .evaluate(() =>
      window.appBridge?.peek<{ path: string }>('/workspaces/current'),
    )
    .then((workspace) => workspace?.path ?? null);
}

export async function switchWorkspace(page: Page, path: string): Promise<void> {
  await page.evaluate(
    (target) => window.appBridge?.call('/workspaces/open', { path: target }),
    path,
  );
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if ((await currentPath(page)) === path) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`workspace did not switch: ${path}`);
}

export async function openSettings(page: Page, pageId: string): Promise<void> {
  await page.evaluate(
    (id) => window.appBridge?.call('/settings/open', { pageId: id }),
    pageId,
  );
}

export async function openResource(page: Page, ref: string): Promise<void> {
  await page.evaluate(async (target) => {
    const id = (
      await window.appBridge?.peek<{ id: string }>('/workspaces/current')
    )?.id;
    if (!id) throw new Error('workspace not ready');
    return window.appBridge?.call(`/workspaces/${id}/resources/pages/open`, {
      ref: target,
    });
  }, ref);
}

export async function openBrowser(page: Page, url: string): Promise<void> {
  await page.evaluate(async (target) => {
    const id = (
      await window.appBridge?.peek<{ id: string }>('/workspaces/current')
    )?.id;
    if (!id) throw new Error('workspace not ready');
    return window.appBridge?.call(`/workspaces/${id}/sites/web/open`, {
      url: target,
    });
  }, url);
}

export async function viewList(page: Page): Promise<ViewInfo[]> {
  return (
    (await page.evaluate(() => window.appBridge?.peek<ViewInfo[]>('/views'))) ??
    []
  );
}

export async function closeView(page: Page, id: string): Promise<void> {
  await page.evaluate(
    (viewId) => window.appBridge?.call(`/views/${viewId}/close`),
    id,
  );
}
