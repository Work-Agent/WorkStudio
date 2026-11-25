/**
 * 列表框架契约：直接从 SDK 重新导出。
 *
 * 定义归 App，数据归 Workspace，渲染层只消费 ListSnapshot；
 * 插件与宿主使用同一份类型，不再各自维护一套。
 */

export type {
  ListActionSpec,
  ListDefinition,
  ListFieldSpec,
  ListGroup,
  ListItem,
  ListSection,
  ListSnapshot,
  ListSourceScope,
} from '@workstudio/sdk';
