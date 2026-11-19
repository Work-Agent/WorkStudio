/**
 * dialogs / notices：应用级 UI 状态。
 *
 * dialogs/list 和 notices/list 是各自 domain 的单例 resource。
 */

import type { Domain, DomainRegistry, Resource } from './domains.ts';
import type {
  AppNotice,
  DialogView,
  UiDialogRequest,
  UiDialogResponse,
} from './shared.ts';

export class Dialogs {
  readonly domain: Domain;

  private readonly resource: Resource;
  private readonly items: DialogView[] = [];
  private readonly pending = new Map<
    string,
    (response: UiDialogResponse) => void
  >();
  private seq = 0;

  constructor(
    registry: DomainRegistry,
    private readonly onVisibility?: (visible: boolean) => void,
  ) {
    this.domain = registry.define('dialogs');
    this.resource = this.domain.resource('list');
    this.resource.snapshot(() => this.list());
    this.resource.command<
      Omit<UiDialogRequest, 'id' | 'type'>,
      UiDialogResponse
    >('ask', (call) => this.ask(call.input));
    this.resource.command<{ request?: UiDialogRequest }, { id: string }>(
      'open',
      (call) => this.open(call.input?.request),
    );
    this.resource.command<
      {
        id: string;
        response?: Partial<UiDialogResponse>;
        cancelled?: boolean;
      },
      null
    >('respond', (call) => {
      this.respond(
        call.input.id,
        { ...call.input.response, id: call.input.id },
        call.input.cancelled,
      );
      return null;
    });
  }

  list(): DialogView[] {
    return this.items.map((item) => ({ ...item }));
  }

  ask(
    request: Omit<UiDialogRequest, 'id' | 'type'>,
  ): Promise<UiDialogResponse> {
    const id = `dialog-${(this.seq += 1)}`;
    return new Promise<UiDialogResponse>((resolve) => {
      this.pending.set(id, resolve);
      this.items.push({
        id,
        request: { ...request, id, type: 'dialog' },
        status: 'open',
      });
      this.publish();
    });
  }

  open(request: UiDialogRequest | undefined | null): { id: string } {
    const id = request?.id || `dialog-${(this.seq += 1)}`;
    const existing = this.items.find((item) => item.id === id);
    if (existing) {
      existing.request = request ?? null;
      existing.status = 'open';
    } else {
      this.items.push({ id, request: request ?? null, status: 'open' });
    }
    this.publish();
    return { id };
  }

  respond(id: string, response: UiDialogResponse, cancelled = false): void {
    const item = this.items.find((dialog) => dialog.id === id);
    if (!item) return;
    const next = { ...response, id, ...(cancelled ? { cancelled } : {}) };
    item.status = cancelled ? 'cancelled' : 'resolved';
    item.response = next;
    this.publish();
    const resolve = this.pending.get(id);
    if (!resolve) return;
    this.pending.delete(id);
    resolve(next);
  }

  resolve(id: string): void {
    const item = this.items.find((dialog) => dialog.id === id);
    if (!item || item.status !== 'open') return;
    item.status = 'resolved';
    this.publish();
  }

  private publish(): void {
    this.resource.publish();
    this.onVisibility?.(this.items.some((dialog) => dialog.status === 'open'));
  }
}

export class Notices {
  readonly domain: Domain;

  private readonly resource: Resource;
  private readonly items: AppNotice[] = [];
  private seq = 0;

  constructor(registry: DomainRegistry) {
    this.domain = registry.define('notices');
    this.resource = this.domain.resource('list');
    this.resource.snapshot(() => this.list());
    this.resource.command<
      { level?: AppNotice['level']; message: string; source?: string },
      AppNotice
    >('notify', (call) => this.notify(call.input));
    this.resource.command<{ id?: string }, AppNotice[]>('dismiss', (call) =>
      this.dismiss(call.input?.id),
    );
  }

  list(): AppNotice[] {
    return this.items.map((item) => ({ ...item }));
  }

  notify(input: {
    level?: AppNotice['level'];
    message: string;
    source?: string;
  }): AppNotice {
    const item: AppNotice = {
      id: `notice-${(this.seq += 1)}`,
      level: input.level ?? 'info',
      message: input.message,
      ...(input.source ? { source: input.source } : {}),
    };
    this.items.push(item);
    this.publish();
    return item;
  }

  dismiss(id?: string): AppNotice[] {
    if (id) {
      const index = this.items.findIndex((item) => item.id === id);
      if (index >= 0) this.items.splice(index, 1);
    } else {
      this.items.length = 0;
    }
    this.publish();
    return this.list();
  }

  private publish(): void {
    this.resource.publish();
  }
}
