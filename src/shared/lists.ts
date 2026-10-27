/**
 * 列表框架契约（architecture.md §2.4 / §4）。
 *
 * 定义归 App，数据归 Workspace，渲染层只消费 ListSnapshot。
 */

export type ListSourceScope = 'app' | 'workspace';
export type ListSection = 'resources' | 'plugins' | 'settings' | 'hidden';

export interface ListFieldSpec {
  /** title / subtitle / time / badge / meta.<key> */
  key: string;
  label?: string;
  type: 'text' | 'time' | 'badge' | 'icon' | 'count';
}

export interface ListActionSpec {
  id: string;
  label: string;
  icon?: string;
  scope: 'app' | 'workspace' | 'session' | 'ui';
  /** AppCommand.action */
  action: string;
  confirm?: boolean;
}

export interface ListDefinition {
  id: string;
  label: string;
  icon?: string;
  order?: number;
  sourceScope: ListSourceScope;
  /** 侧栏主形态；缺省 = resources。 */
  section?: ListSection;
  /** 分组图标底色（Tailwind class）；缺省按 icon 语义。 */
  tone?: string;
  /** 计数单位（项 / 页 / 个标签…）。 */
  unit?: string;
  /** 默认计数文案（Provider 未给时由 count + unit 生成）。 */
  countLabel?: string;
  itemType: string;
  fields: ListFieldSpec[];
  actions: ListActionSpec[];
  empty?: { icon?: string; text: string };
  grouping?: 'flat' | 'domain' | 'custom';
}

export interface ListItem {
  key: string;
  itemType: string;
  title: string;
  subtitle?: string;
  icon?: string;
  badge?: string;
  meta?: Record<string, unknown>;
  actions?: string[];
  state?: {
    open?: boolean;
    active?: boolean;
    dirty?: boolean;
    disabled?: boolean;
  };
}

export interface ListGroup {
  id: string;
  definitionId: string;
  section: ListSection;
  label: string;
  icon?: string;
  tone?: string;
  unit?: string;
  /** 已生成的计数文案（渲染层直接展示）。 */
  countLabel: string;
  /** 最近更新时间（0 = 无）；由 Provider 或数据层给出。 */
  updatedAt: number;
  /** 顶置态（工作区 UI 现场投影）。 */
  pinned: boolean;
  order?: number;
  count: number;
  state: 'loading' | 'ready' | 'error';
  fields: ListFieldSpec[];
  actions: ListActionSpec[];
  empty?: { icon?: string; text: string };
  items: ListItem[];
  diagnostics?: string[];
}

export interface ListSnapshot {
  workspaceEpoch: number;
  groups: ListGroup[];
}
