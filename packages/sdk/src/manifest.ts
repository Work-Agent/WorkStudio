/**
 * 插件静态声明：package.json 的 workstudio 字段。
 *
 * 扫描期只读，不执行插件代码；动态实现见 definePlugin。
 */

import type { Claim } from './resource.ts';

export interface WorkStudioManifest {
  /** 域前缀与页面 host。 */
  id: string;
  label?: string;
  icon?: string;
  claims?: Claim[];
  pages: {
    /** 内容页入口（相对插件根）。 */
    content: string;
    /** 插件自渲染的设置页；有 settings.schema 时可省。 */
    settings?: string;
  };
  settings?: { schema: string };
  /** 技能目录（相对插件根）；名称 / 描述由 SKILL.md frontmatter 定义。 */
  skills?: string[];
  /** 允许写入凭证的供应商 id；未声明时一律拒绝。 */
  credentials?: string[];
}
