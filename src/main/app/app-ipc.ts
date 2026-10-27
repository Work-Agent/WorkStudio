/** App 作用域 IPC：app.sync / app.cmd 的来源校验与分发。 */
import { ipcMain } from 'electron';
import { APP_CMD, APP_SYNC } from '../../shared/channels';
import type { AppCommand } from '../../shared/app';
import type { RouterDeps } from '../command/router';
import { classifySender, isAssistantCommand } from '../command/router';
import type { AppHost } from './app-host';

export function registerAppIpc(deps: RouterDeps, host: () => AppHost): void {
  ipcMain.handle(APP_SYNC, (event) => {
    const type = classifySender(event, deps);
    if (type === 'unknown' || type === 'view') {
      return {
        ok: false,
        error: { code: 'forbidden', message: 'App sync is not allowed' },
      };
    }
    return host().snapshot();
  });

  ipcMain.handle(APP_CMD, (event, command: AppCommand) => {
    const type = classifySender(event, deps);
    if (type === 'unknown' || type === 'view') {
      return {
        ok: false,
        error: {
          code: 'forbidden',
          message: `Command "${command.action}" is not allowed from this sender`,
        },
      };
    }
    if (type === 'assistant' && !isAssistantCommand(command.action)) {
      return {
        ok: false,
        error: {
          code: 'forbidden',
          message: `Command "${command.action}" is not allowed for the assistant view`,
        },
      };
    }
    if (type === 'overlay' && command.action !== 'ui.respond') {
      return {
        ok: false,
        error: {
          code: 'forbidden',
          message: `Command "${command.action}" is not allowed for the overlay view`,
        },
      };
    }
    return host().dispatch(command);
  });
}
