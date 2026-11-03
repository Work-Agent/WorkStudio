import type { Router } from '../router';

export interface WorkspaceRef {
  id: string;
}

export const idOf = (path: string): string => encodeURIComponent(path);

export function wsIdOf(r: Router): string | null {
  return r.get<WorkspaceRef>('/workspaces/current')?.id ?? null;
}
