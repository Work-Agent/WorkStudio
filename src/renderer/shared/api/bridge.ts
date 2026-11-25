import '@workstudio/sdk/global';
/** workStudio 访问与资源订阅：每个模块只订阅自己消费的资源。 */
import { useEffect, useState } from 'react';
import type { WorkStudioBridge, DomainUpdate } from '@workstudio/sdk';

export function workStudio(): WorkStudioBridge | undefined {
  return typeof window !== 'undefined' ? window.workStudio : undefined;
}

/** 当前窗口绑定的工作区；宿主未注入时退回当前工作区。 */
export function useWorkspaceId(): string | null {
  return workStudio()?.workspaceId ?? null;
}

export function useResource<T>(
  domain: string,
  resource: string | null,
  initial: T,
): T {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    const bridge = workStudio();
    if (!bridge || !resource) return;
    const apply = (current: T, data: unknown): T => {
      if (data === null || data === undefined) return current;
      if (Array.isArray(data)) return data as T;
      if (
        typeof data === 'object' &&
        typeof current === 'object' &&
        current !== null
      ) {
        return { ...current, ...(data as Record<string, unknown>) } as T;
      }
      return data as T;
    };
    const off = bridge.onUpdate((update: DomainUpdate) => {
      if (update.domain !== domain || update.resource !== resource) return;
      if (update.type === 'snapshot') {
        setValue((current) => apply(current, update.data));
      } else if (update.type === 'patch') {
        setValue((current) => apply(current, update.data));
      }
    });
    void bridge
      .subscribe(domain, resource)
      .then((data) => setValue((current) => apply(current, data)));
    return () => {
      off();
      bridge.unsubscribe(domain, resource);
    };
  }, [domain, resource]);
  return value;
}

export async function command<T>(
  domain: string,
  resource: string,
  action: string,
  input?: unknown,
): Promise<T> {
  const bridge = workStudio();
  if (!bridge) throw new Error('workStudio is unavailable');
  const result = await bridge.command<T>(domain, resource, action, input);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}
