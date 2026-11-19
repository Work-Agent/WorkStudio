import type { UpdateStatus } from '../modules/updates/updater.ts';
import type { DomainRegistry } from '../runtime/domains.ts';

export interface UpdatesDeps {
  status(): UpdateStatus;
  check(): Promise<UpdateStatus>;
  download(): Promise<UpdateStatus>;
  cancel(): UpdateStatus;
  open(): void;
}

/** updates/status：应用级更新状态与动作；设置页只是消费者。 */
export function defineUpdatesDomain(
  registry: DomainRegistry,
  deps: UpdatesDeps,
): void {
  const resource = registry.define('updates').resource('status');
  resource.snapshot(() => deps.status());
  resource.command<null, UpdateStatus>('check', () => deps.check());
  resource.command<null, UpdateStatus>('download', () => deps.download());
  resource.command<null, UpdateStatus>('cancel', () => deps.cancel());
  resource.command<null, null>('open', () => {
    deps.open();
    return null;
  });
}
