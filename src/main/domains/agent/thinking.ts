import type { DomainRegistry } from '../../runtime/domains.ts';

export interface ThinkingState {
  level: string | null;
  levels: string[];
}

export interface ThinkingDeps {
  ensure(): Promise<void>;
  state(): ThinkingState;
  set(level: string): void;
}

/** thinking：推理档位状态与切换。 */
export function defineThinkingDomain(
  registry: DomainRegistry,
  deps: ThinkingDeps,
): void {
  const resource = registry.define('thinking').resource('current');
  resource.snapshot(() => deps.state());
  resource.command<{ level: string }, null>('set', (call) => {
    deps.set(String(call.input.level));
    resource.publish();
    return null;
  });
}
