/**
 * 取数面：助手工具、页面 bridge 与插件上下文共用同一契约。
 *
 * 四个动词只认资源 ref，不认绝对路径；实现方由宿主提供，三条通道拿到
 * 的是同一份实现，所以「助手 ls 到的东西」与「页面 ls 到的东西」一致。
 * 第五条通道（写）不是独立动词：它落到命令表，由技能说明。
 */

import type { Entry, Item, ListOptions, ReadOptions } from './resource.ts';

export interface ResourceAccess {
  /** 结构：认领该 ref 的适配器并发执行后合并。 */
  ls(ref: string, options?: ListOptions): Promise<Entry[]>;
  /** 结构：按名字过滤，聚合规则与 ls 一致。 */
  find(ref: string, query: string): Promise<Entry[]>;
  /** 内容：返回条目列表，每条带 locator。 */
  read(ref: string, options?: ReadOptions): Promise<Item[]>;
  /** 内容：按查询匹配，结果带 locator。 */
  grep(ref: string, query: string): Promise<Item[]>;
}
