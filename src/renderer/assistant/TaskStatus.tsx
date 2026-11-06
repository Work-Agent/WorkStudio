import { useState } from 'react';
import {
  CircleAlert,
  FileCheck2,
  LoaderCircle,
  Square,
  Check,
  Circle,
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
  if (task.sessionFile && activePath && task.sessionFile !== activePath)
    return (
      <button
        className="wb-button"
        onClick={() =>
          void bridge?.cmd('session.openTab', { path: task.sessionFile })
        }
      >
        查看上一轮任务状态
      </button>
    );
  const busy = ['running', 'stopping', 'unconfirmed'].includes(task.status);
  const title =
    task.status === 'running'
      ? '正在处理任务'
      : task.status === 'stopping'
        ? '正在停止，等待执行确认'
        : task.status === 'unconfirmed'
          ? '尚未确认停止'
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
  const retry = async (confirmed = false): Promise<void> => {
    if (task.mayHaveSideEffects && !confirmed) {
      setConfirmRetry(true);
      return;
    }
    setPending(true);
    setError('');
    setConfirmRetry(false);
    const response = await bridge?.cmd('session.retry', { confirmed });
    if (response && !response.ok) setError(response.error.message);
    setPending(false);
  };
  const open = async (ref: string): Promise<void> => {
    const workspace = await window.appBridge?.peek<{ id: string }>(
      '/workspaces/current',
    );
    if (!workspace) return;
    const result = await window.appBridge?.call(
      `/workspaces/${workspace.id}/resources/pages/open`,
      { ref },
    );
    if (result && !result.ok) setError(result.error.message);
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
            ? task.tools.length
              ? '正在执行下面的工具步骤。'
              : '正在等待模型响应。'
            : task.stage}
        </p>
        {task.error && <p className="wb-task-error">{task.error}</p>}
      </div>
      {!!task.tools.length && (
        <ol className="wb-task-steps">
          {task.tools.map((tool) => (
            <li key={tool.id}>
              {tool.error ? (
                <CircleAlert size={13} />
              ) : tool.done ? (
                <Check size={13} />
              ) : busy ? (
                <LoaderCircle size={13} className="wb-spinner" />
              ) : (
                <Circle size={13} />
              )}
              <span>
                {labels[tool.name] ?? tool.name}
                {tool.error
                  ? ' · 失败'
                  : tool.done
                    ? ' · 已完成'
                    : ' · 等待结果'}
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="wb-task-meta">
        第 {task.attempt} 次执行
        {task.mayHaveSideEffects && task.status !== 'running'
          ? ' · 已完成的操作不会撤销'
          : ''}
      </p>
      {!!task.artifacts.length && (
        <div className="wb-task-artifacts">
          {task.artifacts.map((file) => (
            <button key={file.ref} onClick={() => void open(file.ref)}>
              <FileCheck2 size={16} />
              <span>
                {file.label}
                <small>写入已确认 · 打开检查</small>
              </span>
            </button>
          ))}
        </div>
      )}
      <details className="wb-task-meta">
        <summary>查看原请求</summary>
        <p style={{ whiteSpace: 'pre-wrap' }}>{task.request}</p>
      </details>
      <div className="wb-task-actions">
        {task.status === 'running' && (
          <button
            className="wb-button"
            onClick={() => void bridge?.cmd('session.abort')}
          >
            停止本轮
          </button>
        )}
        {task.status === 'stopping' && (
          <button className="wb-button" disabled>
            等待停止确认
          </button>
        )}
        {task.status === 'unconfirmed' && (
          <button
            className="wb-button"
            onClick={() => void bridge?.cmd('session.abort')}
          >
            再次确认停止
          </button>
        )}
        {['failed', 'stopped'].includes(task.status) && (
          <button
            className="wb-button"
            disabled={pending}
            onClick={() => void retry()}
          >
            {pending ? '正在重试…' : '重试原请求'}
          </button>
        )}
        {task.status === 'failed' && (
          <button
            className="wb-button"
            onClick={() =>
              void window.appBridge?.call('/settings/open', {
                pageId: 'models',
              })
            }
          >
            模型连接
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
      {['failed', 'stopped'].includes(task.status) && (
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
          编辑原请求
        </button>
      )}
      {error && (
        <p role="alert" className="wb-task-error">
          {error}
        </p>
      )}
    </section>
  );
}
