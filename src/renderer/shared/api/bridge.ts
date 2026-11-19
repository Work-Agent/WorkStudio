/** workStudio 访问与资源订阅：每个模块只订阅自己消费的资源。 */
import { useEffect, useState } from 'react';
import type { WorkStudioBridge } from '../../../main/runtime/client.ts';
import type { DomainUpdate } from '../../../main/runtime/shared.ts';

export function workStudio(): WorkStudioBridge | undefined {
  return typeof window !== 'undefined' ? window.workStudio : undefined;
}

export function useResource<T>(
  domain: string,
  resource: string,
  initial: T,
): T {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    const bridge = workStudio();
    if (!bridge) return;
    const off = bridge.onUpdate((update: DomainUpdate) => {
      if (update.domain !== domain || update.resource !== resource) return;
      if (update.type === 'snapshot') setValue(update.data as T);
      else if (update.type === 'patch') {
        setValue((current) => ({ ...current, ...update.data }) as T);
      }
    });
    void bridge.subscribe(domain, resource).then((data) => setValue(data as T));
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
