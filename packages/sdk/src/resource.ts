/**
 * 资源适配器：结构（Entry）与内容（Item）。
 *
 * 框架只做路由：ref → 域 → adapter；不校验 Item 字段，
 * 不做统一文本化，也不做分页切片，只限制条数并透传 locator。
 */

export type Locator = string;

export interface Entry {
  name: string;
  type: 'file' | 'dir' | 'other';
  size?: number;
  modifiedAt?: number;
  /** 可再次寻址的身份；导出目录时原样透传。 */
  ref: string;
}

/** 读接口的最小条目：至少带 locator，其余字段由域定义。 */
export type Item = { locator: Locator } & Record<string, unknown>;

/** 打开目标：locator 仍由域解释，宿主只负责把 ref / locator 送到页面。 */
export interface OpenTarget {
  ref: string;
  locator?: Locator;
}

export interface ListOptions {
  limit?: number;
  scope?: string;
}

export interface ReadOptions {
  limit?: number;
  offset?: number;
}

export interface ResourceAdapter {
  /** 省略时由框架按工作区路径枚举。 */
  ls?(ref: string, options?: ListOptions): Promise<Entry[]>;
  /** 省略时由框架按工作区路径过滤。 */
  find?(ref: string, query: string): Promise<Entry[]>;
  read(ref: string, options?: ReadOptions): Promise<Item[]>;
  grep(ref: string, query: string): Promise<Item[]>;
  /** 把 ref + locator 解析成可打开目标；省略时宿主按 ref 打开。 */
  open?(ref: string, locator?: Locator): Promise<OpenTarget | null>;
}

/** 插件清单里的认领声明：扩展名 / 地址前缀，冲突按优先级。 */
export interface Claim {
  extensions?: readonly string[];
  prefixes?: readonly string[];
  priority?: number;
}
