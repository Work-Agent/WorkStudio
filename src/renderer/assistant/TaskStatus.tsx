import { useState } from 'react';
import {
  CircleAlert,
  FileCheck2,
  LoaderCircle,
  Square,
  Check,
} from 'lucide-react';
import type { SessionTask } from '../../shared/session-task';
import { bridge } from './bridge';

const labels: Record<string, string> = {
  read: '读取资料',
  write: '写入成果',
  edit: '编辑资料',
  bash: '执行命令',
  grep: '检索内容',
  find: '查找资料',
};

export function TaskStatus({
  task,
  activePath,
}: {
  task: SessionTask | null;
  activePath: string | null;
}) {
  const [confirmRetry, setConfirmRetry] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  if (!task) return null;
  if (task.sessionFile && task.sessionFile !== activePath) return null;
  const busy = ['running', 'stopping', 'unconfirmed'].includes(task.status);
  const activeTool = task.tools.find((tool) => !tool.done && !tool.error);
  const title =
    task.status === 'running'
      ? '正在处理任务'
      : task.status === 'stopping'
        ? '正在停止，等待执行确认'
        : task.status === 'unconfirmed'
          ? '尚未确认执行结束'
          : task.status === 'failed'
            ? '本轮未完成，请检查'
            : task.status === 'stopped'
              ? '本轮已停止'
              : '本轮结束，等待检查';
  const Icon = busy
    ? LoaderCircle
    : task.status === 'failed'
      ? CircleAlert
      : task.status === 'stopped'
        ? Square
        : Check;
  const retry = async (confirmed = false) => {
    if (task.mayHaveSideEffects && !confirmed) {
      setConfirmRetry(true);
      return;
    }
    setPending(true);
    setError('');
    setConfirmRetry(false);
    try {
      const response = await bridge?.cmd('session.retry', { confirmed });
      if (!response) throw new Error('页面连接尚未就绪');
      if (!response.ok) throw new Error(response.error.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };
  const open = async (ref: string) => {
    try {
      const workspace = await window.appBridge?.peek<{ id: string }>(
        '/workspaces/current',
      );
      if (!workspace) throw new Error('工作区尚未就绪');
      const result = await window.appBridge!.call(
        `/workspaces/${workspace.id}/resources/pages/open`,
        { ref },
      );
      if (!result.ok) throw new Error(result.error.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return (
    <section
      className={`wb-task ${task.status === 'failed' ? 'is-error' : ''}`}
      aria-label="本轮任务状态"
    >
      <div
        role={task.status === 'failed' ? 'alert' : 'status'}
        aria-live="polite"
      >
        <strong className="wb-task-title">
          <Icon
            size={15}
            className={
              task.status === 'running' || task.status === 'stopping'
                ? 'wb-spinner'
                : ''
            }
          />
          {title}
        </strong>
        <p>
          {task.status === 'running'
            ? activeTool
              ? `${labels[activeTool.name] ?? activeTool.name}…`
              : task.tools.length
                ? '正在整理回复。'
                : '正在等待模型响应。'
            : task.stage}
        </p>
        {task.error && <p className="wb-task-error">{task.error}</p>}
      </div>
      {!!task.artifacts.length && (
        <div className="wb-task-artifacts">
          {task.artifacts.map((file) => (
            <button key={file.ref} onClick={() => void open(file.ref)}>
              <FileCheck2 size={16} />
              <span>
                {file.label}
                <small>文件已写入 · 打开检查</small>
              </span>
            </button>
          ))}
        </div>
      )}
      <details className="wb-task-details">
        <summary>
          执行详情
          {task.tools.length
            ? ` · ${task.tools.filter((tool) => tool.done && !tool.error).length}/${task.tools.length} 个步骤完成`
            : ''}
        </summary>
        <div>
          <p>
            第 {task.attempt} 次执行
            {task.mayHaveSideEffects && task.status !== 'running'
              ? ' · 已完成的操作不会撤销'
              : ''}
          </p>
          {!!task.tools.length && (
            <ol className="wb-task-steps">
              {task.tools.map((tool) => (
                <li key={tool.id}>
                  {tool.error ? (
                    <CircleAlert size={13} />
                  ) : tool.done ? (
                    <Check size={13} />
                  ) : (
                    <LoaderCircle size={13} />
                  )}
                  <span>
                    {labels[tool.name] ?? tool.name} ·{' '}
                    {tool.error ? '失败' : tool.done ? '已完成' : '等待结果'}
                  </span>
                </li>
              ))}
            </ol>
          )}
          <details>
            <summary>查看原请求</summary>
            <p style={{ whiteSpace: 'pre-wrap' }}>{task.request}</p>
          </details>
        </div>
      </details>
      <div className="wb-task-actions">
        {['failed', 'stopped'].includes(task.status) && (
          <>
            <button
              className="wb-button"
              disabled={pending}
              onClick={() => void retry()}
            >
              {pending ? '正在重试…' : '重试原请求'}
            </button>
            <button
              className="wb-button"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent('wa:editor-text', {
                    detail: { text: task.request },
                  }),
                )
              }
            >
              修改请求
            </button>
          </>
        )}
        {task.status === 'failed' &&
          /连接|认证|密钥|API.?key|unauthori[sz]ed|authentication|401|403/i.test(
            task.error ?? '',
          ) && (
            <button
              className="wb-button"
              onClick={() =>
                void window.appBridge?.call('/settings/open', {
                  pageId: 'models',
                })
              }
            >
              检查模型连接
            </button>
          )}
      </div>
      {confirmRetry && (
        <div className="wb-task-confirm" role="alert">
          <p>
            重试会重新发送原请求。请先检查已经生成的文件，避免重复执行已有操作。
          </p>
          <div className="wb-task-actions">
            <button
              className="wb-button"
              onClick={() => setConfirmRetry(false)}
            >
              取消
            </button>
            <button className="wb-button" onClick={() => void retry(true)}>
              已检查，重新执行
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="wb-task-error">
          {error}
        </p>
      )}
    </section>
  );
}
