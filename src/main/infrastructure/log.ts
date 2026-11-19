/**
 * 日志（main/desktop 两环境共用；纯 stderr + 前缀）。
 */
type Level = 'info' | 'warn' | 'error';

export interface Logger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export function createLogger(scope: string): Logger {
  const tag = `[${scope}]`;
  const write = (level: Level, args: unknown[]): void => {
    const fn =
      level === 'error'
        ? console.error
        : level === 'warn'
          ? console.warn
          : console.log;
    fn(tag, ...args);
  };
  return {
    info: (...args) => write('info', args),
    warn: (...args) => write('warn', args),
    error: (...args) => write('error', args),
  };
}
