/** 插件安装任务由主进程持有，页面离开后仍可订阅同一任务。 */
export type InstallPhase = 'download' | 'verify' | 'install' | 'load';
export interface PluginInstallTask {
  id: string;
  source: string;
  label: string;
  sourceType: 'local' | 'remote';
  status: 'running' | 'cancelling' | 'cancelled' | 'failed' | 'done';
  phase: InstallPhase;
  attempt: number;
  received: number;
  total: number | null;
  installed: boolean;
  loaded: boolean;
  message: string;
  error: string | null;
}
export interface InstallObserver {
  signal?: AbortSignal;
  progress?: (value: {
    phase: Exclude<InstallPhase, 'load'>;
    received?: number;
    total?: number | null;
    message?: string;
  }) => void;
}
