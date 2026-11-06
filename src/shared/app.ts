/** 工作区元数据（主进程 / 渲染层共享的稳定投影）。 */
export interface WorkspaceMeta {
  id: string;
  path: string;
  name: string;
  createdAt: number;
  lastOpenedAt: number;
  exists: boolean;
}
