/**
 * 命令描述：一份声明生成四条通道。
 *
 * args 是页面校验、助手子命令与命令手册的共同来源；
 * 插件只实现 run，不解析 argv。
 */

export type ArgSpec =
  | {
      type: 'string' | 'number' | 'boolean';
      required?: boolean;
      default?: unknown;
    }
  | { type: 'locator'; scheme: string; required?: boolean }
  | { enum: readonly string[]; default?: string };

export interface CommandDecl {
  summary: string;
  args: Record<string, ArgSpec>;
}

/** CLI 退出码：0 成功、1 失败、2 用法、3 未找到。 */
export interface ExitCodes {
  ok: number;
  failed: number;
  invalid: number;
  notFound: number;
}

export const DEFAULT_EXIT_CODES: ExitCodes = {
  ok: 0,
  failed: 1,
  invalid: 2,
  notFound: 3,
};

/** 扫描期产物 commands.json 的一条；不含实现。 */
export interface CommandDescriptor extends CommandDecl {
  name: string;
  exitCodes: ExitCodes;
}

/** 参数助手：`at: locator('docx:para')`；locator 默认必填。 */
export function locator(scheme: string, required = true): ArgSpec {
  return { type: 'locator', scheme, required };
}
