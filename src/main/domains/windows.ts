import type { DomainRegistry } from '../runtime/domains.ts';
import type { SystemActions, WindowManager } from '../runtime/native.ts';

export interface WindowState {
  activeWsId: string | null;
  count: number;
  list: Array<{ wsId: string; windowId: number }>;
}

/** windows/list：窗口集合与系统动作。 */
export function defineWindowsDomain(
  registry: DomainRegistry,
  windows: WindowManager,
  actions: SystemActions,
  openWindow: ((wsId: string) => void) | undefined,
): () => void {
  const resource = registry.define('windows').resource('list');
  const publish = (): void => {
    resource.patch({
      activeWsId: windows.lastWorkspaceId,
      count: windows.list().length,
      list: windows.list().map((window) => ({
        wsId: window.wsId,
        windowId: window.windowId,
      })),
    });
  };

  resource.snapshot(
    (): WindowState => ({
      activeWsId: windows.lastWorkspaceId,
      count: windows.list().length,
      list: windows.list().map((window) => ({
        wsId: window.wsId,
        windowId: window.windowId,
      })),
    }),
  );
  resource.command<string, null>('focus', (call) => {
    windows.focus(String(call.input));
    return null;
  });
  resource.command<string, null>('close', (call) => {
    windows.close(String(call.input));
    return null;
  });
  resource.command<string, null>('open', (call) => {
    openWindow?.(String(call.input));
    return null;
  });
  resource.command<{ wsId: string }, boolean>('beginMove', (call) =>
    actions.beginWindowMove(call.input.wsId),
  );
  resource.command<null, boolean>('updateMove', () =>
    actions.updateWindowMove(),
  );
  resource.command<null, null>('endMove', () => {
    actions.endWindowMove();
    return null;
  });

  const offOpen = windows.onOpen(publish);
  const offClose = windows.onClose(publish);
  return () => {
    offOpen();
    offClose();
  };
}
