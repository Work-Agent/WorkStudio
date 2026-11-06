/** 一轮助手工作的事实投影；完成不代表用户已检查成果。 */
export interface SessionTask {
  id: number;
  sessionFile: string | null;
  status:
    | 'running'
    | 'stopping'
    | 'stopped'
    | 'failed'
    | 'done'
    | 'unconfirmed';
  request: string;
  attempt: number;
  stage: string;
  error: string | null;
  mayHaveSideEffects: boolean;
  artifacts: Array<{ ref: string; label: string }>;
  tools: Array<{ id: string; name: string; done: boolean; error: boolean }>;
}
