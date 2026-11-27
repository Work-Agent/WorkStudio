/**
 * 模态对话框的调用面：打开 `shell/<wsId>/dialogs` 上的对话框，
 * 订阅同资源直到结算。对话框本身由 overlay 视图渲染。
 */
import { command, workStudio } from './bridge.ts';

interface DialogView {
  id: string;
  status: 'open' | 'resolved' | 'cancelled';
  response?: { value?: string; confirmed?: boolean };
}

function settle<T>(
  resource: string,
  id: string,
  read: (view: DialogView) => T,
): Promise<T> {
  const bridge = workStudio();
  if (!bridge) return Promise.resolve(read({ id, status: 'cancelled' }));
  return new Promise<T>((resolve) => {
    let released = false;
    let off: () => void = () => undefined;
    const release = (): void => {
      if (released) return;
      released = true;
      off();
      bridge.unsubscribe('shell', resource);
    };
    const check = (data: unknown): void => {
      if (!Array.isArray(data)) return;
      const view = (data as DialogView[]).find((item) => item.id === id);
      if (!view || view.status === 'open') return;
      release();
      resolve(read(view));
    };
    off = bridge.onUpdate((update) => {
      if (update.domain !== 'shell' || update.resource !== resource) return;
      if (update.type === 'snapshot' || update.type === 'patch') {
        check(update.data);
      }
    });
    void bridge
      .subscribe('shell', resource)
      .then((data) => check(data))
      .catch(() => undefined);
  });
}

async function open(
  workspaceId: string,
  request: Record<string, unknown>,
): Promise<DialogView> {
  return command<DialogView>(
    'shell',
    `${workspaceId}/dialogs`,
    'open',
    request,
  );
}

/** 输入框：取消返回 null。 */
export async function askInput(
  workspaceId: string,
  input: { title: string; message?: string; prefill?: string },
): Promise<string | null> {
  const view = await open(workspaceId, {
    dialogType: 'input',
    title: input.title,
    ...(input.message ? { message: input.message } : {}),
    ...(input.prefill ? { prefill: input.prefill } : {}),
  });
  return settle(`${workspaceId}/dialogs`, view.id, (result) =>
    result.status === 'resolved' ? (result.response?.value ?? '') : null,
  );
}

/** 确认框：只有明确确认才返回 true。 */
export async function askConfirm(
  workspaceId: string,
  input: { title: string; message?: string },
): Promise<boolean> {
  const view = await open(workspaceId, {
    dialogType: 'confirm',
    title: input.title,
    ...(input.message ? { message: input.message } : {}),
  });
  return settle(
    `${workspaceId}/dialogs`,
    view.id,
    (result) =>
      result.status === 'resolved' && result.response?.confirmed === true,
  );
}
