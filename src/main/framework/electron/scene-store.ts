/** NativeScene 的工作区级持久化（<agentDir>/ws/<wsId>/scene.json）。 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getWorkspaceBase } from '../../agent/workspace';
import type { NativeScene } from '../scene';

export function readScene(wsId: string): NativeScene | null {
  const file = join(getWorkspaceBase(wsId), 'scene.json');
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as Partial<
      NativeScene & { paneWidths?: Partial<NativeScene['paneWidths']> }
    >;
    return {
      sidebarCollapsed: raw.sidebarCollapsed ?? false,
      aiOpen: raw.aiOpen ?? true,
      aiFloating: raw.aiFloating ?? false,
      paneWidths: {
        left: raw.paneWidths?.left ?? 240,
        right: raw.paneWidths?.right ?? 420,
      },
      floating: raw.floating ?? null,
    };
  } catch {
    return null;
  }
}

export function writeScene(wsId: string, scene: NativeScene): void {
  const base = getWorkspaceBase(wsId);
  mkdirSync(base, { recursive: true });
  writeFileSync(
    join(base, 'scene.json'),
    JSON.stringify(scene, null, 2),
    'utf-8',
  );
}
