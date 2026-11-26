/**
 * 资源树契约：文件列表是「森林」，每个组是一棵树。
 *
 * 数据归 Workspace，定义与来源由宿主或插件注册；渲染层只消费森林。
 */

export type ResourceSourceScope = 'app' | 'workspace';
export type ResourceSection = 'resources' | 'plugins' | 'settings' | 'hidden';

export interface ResourceFieldSpec {
  /** title / subtitle / time / badge / meta.<key> */
  key: string;
  label?: string;
  type: 'text' | 'time' | 'badge' | 'icon' | 'count';
}

export interface ResourceActionSpec {
  id: string;
  label: string;
  icon?: string;
  scope: 'app' | 'workspace' | 'session' | 'ui';
  /** 列表动作命令 */
  action: string;
  confirm?: boolean;
}

export interface ResourceGroupDefinition {
  id: string;
  label: string;
  icon?: string;
  order?: number;
  sourceScope: ResourceSourceScope;
  /**
   * 聚合来源：这些资源变化时只重算本组；缺省只在工作区变化 / 显式刷新时重算。
   */
  deps?: Array<{ domain: string; resource: string; event?: string }>;
  section?: ResourceSection;
  tone?: string;
  unit?: string;
  countLabel?: string;
  itemType: string;
  fields: ResourceFieldSpec[];
  actions: ResourceActionSpec[];
  empty?: { icon?: string; text: string };
}

/** 树节点：目录 / 文件 / 列表叶子。 */
export interface ResourceNode {
  key: string;
  type: 'dir' | 'file' | 'item';
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
  children?: ResourceNode[];
  /** children 未下发；展开时调用资源的 children 命令。 */
  hasChildren?: boolean;
}

export interface ResourceGroup {
  id: string;
  definitionId: string;
  section: ResourceSection;
  label: string;
  icon?: string;
  tone?: string;
  unit?: string;
  countLabel: string;
  updatedAt: number;
  order?: number;
  count: number;
  state: 'loading' | 'ready' | 'error';
  fields: ResourceFieldSpec[];
  actions: ResourceActionSpec[];
  empty?: { icon?: string; text: string };
  roots: ResourceNode[];
  diagnostics?: string[];
}

export interface ResourceForest {
  revision: number;
  groups: ResourceGroup[];
}

export interface ResourceActionRequest {
  action: string;
  node?: ResourceNode;
  input?: Record<string, unknown>;
}

export interface ResourceChildrenRequest {
  groupId: string;
  key: string;
}

export interface ResourceContext {
  workspaceId: string;
  workspacePath: string;
}

export type ResourceSource =
  | {
      type: 'transport';
      /** 宿主用 transport 枚举的根 ref；插件不接触绝对路径。 */
      ref: string;
      include?: string[];
      exclude?: string[];
    }
  | {
      type: 'custom';
      provider: (
        context: ResourceContext,
      ) => Promise<ResourceNode[]> | ResourceNode[];
      children?: (
        node: ResourceNode,
        context: ResourceContext,
      ) => Promise<ResourceNode[]> | ResourceNode[];
    };

/** 插件贡献的文件资源树。 */
export interface PluginResourceGroup {
  definition: ResourceGroupDefinition;
  source: ResourceSource;
}
