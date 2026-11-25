/**
 * 日志：类型来自 @work-studio/sdk，宿主只提供写入实现。
 */

import type { Log } from '@work-studio/sdk';

export type { Log };

export function createLog(scope: string): Log {
  const write = (level: 'info' | 'warn' | 'error', message: string): void => {
    const line = `[${scope}] ${message}`;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  };
  return {
    info: (message) => write('info', message),
    warn: (message) => write('warn', message),
    error: (message) => write('error', message),
  };
}
