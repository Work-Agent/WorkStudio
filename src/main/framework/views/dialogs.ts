/** 对话框 / 通知：状态、路由与 overlay 显隐。 */
import type { StateHandle } from '../../core/handles';
import { RouteFailure } from '../../core/failure';
import type { RouteCall } from '../../core/types';
import type { UiDialogRequest, UiDialogResponse } from '../../../shared/types';
import type { GlobalRegistration } from '../middleware';

export interface DialogView {
  id: string;
  request: unknown;
  status: 'open' | 'resolved' | 'cancelled';
  response?: unknown;
}

export interface AppNotice {
  id: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  source?: string;
}

interface OverlayPort {
  setVisible(id: string, visible: boolean): void;
}

export interface DialogsDeps {
  overlay(): OverlayPort | null;
  overlayId(): string | undefined;
}

export class DialogsController {
  private readonly dialogs: DialogView[] = [];
  private dialogSeq = 0;
  private readonly pending = new Map<
    string,
    (response: UiDialogResponse) => void
  >();
  private responder: ((response: UiDialogResponse) => void) | null = null;
  private readonly notices: AppNotice[] = [];
  private noticeSeq = 0;
  private dialogState!: StateHandle<DialogView[]>;
  private noticeState!: StateHandle<AppNotice[]>;

  constructor(private readonly deps: DialogsDeps) {}

  install(global: GlobalRegistration): void {
    this.dialogState = global.state<DialogView[]>('/dialogs');
    this.noticeState = global.state<AppNotice[]>('/notices');
    global.handle('/dialogs/ask', (call) =>
      this.ask(call.input as Omit<UiDialogRequest, 'id' | 'type'>),
    );
    global.handle('/dialogs/open', (call) =>
      this.open(call as RouteCall<{ request?: unknown }>),
    );
    global.handle('/dialogs/:dialogId/respond', (call) =>
      this.respond(
        call as RouteCall<{
          response?: unknown;
          cancelled?: boolean;
        }>,
      ),
    );
    global.handle('/notify', (call) =>
      this.notify(
        call.input as {
          level?: AppNotice['level'];
          message?: string;
          source?: string;
        },
      ),
    );
    global.handle('/notices/dismiss', (call) =>
      this.dismiss(call.input as { id?: string } | undefined),
    );
  }

  activate(): void {
    this.dialogState.publish([...this.dialogs]);
    this.noticeState.publish([...this.notices]);
  }

  ask(
    request: Omit<UiDialogRequest, 'id' | 'type'>,
  ): Promise<UiDialogResponse> {
    const id = `app-dialog-${++this.dialogSeq}`;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.dialogs.push({
        id,
        request: { ...request, id, type: 'dialog' },
        status: 'open',
      });
      this.publishDialogs();
    });
  }

  setResponder(responder: (response: UiDialogResponse) => void): void {
    this.responder = responder;
  }

  /** DialogHost 结算（超时 / 会话关闭）后撤卡。 */
  resolve(id: string): void {
    const dialog = this.dialogs.find((item) => item.id === id);
    if (!dialog || dialog.status !== 'open') return;
    dialog.status = 'resolved';
    this.publishDialogs();
  }

  private open(call: RouteCall<{ request?: unknown }>): { id: string } {
    const request = call.input?.request;
    const requestedId =
      request && typeof request === 'object' && 'id' in request
        ? String((request as { id?: unknown }).id ?? '')
        : '';
    const id = requestedId || `dialog-${(this.dialogSeq += 1)}`;
    const existing = this.dialogs.find((item) => item.id === id);
    if (existing) {
      existing.request = request ?? null;
      existing.status = 'open';
    } else {
      this.dialogs.push({ id, request: request ?? null, status: 'open' });
    }
    this.publishDialogs();
    return { id };
  }

  private respond(
    call: RouteCall<{ response?: unknown; cancelled?: boolean }>,
  ): null {
    const id = String(call.params['dialogId']);
    const dialog = this.dialogs.find((item) => item.id === id);
    if (!dialog) throw new RouteFailure('unknown', `dialog ${id} not found`);
    const raw = (call.input?.response ?? {}) as Partial<UiDialogResponse>;
    const response = {
      ...raw,
      id,
      ...(call.input?.cancelled !== undefined
        ? { cancelled: call.input.cancelled }
        : {}),
    } as UiDialogResponse;
    dialog.status = response.cancelled ? 'cancelled' : 'resolved';
    dialog.response = response;
    this.publishDialogs();
    const resolve = this.pending.get(id);
    if (resolve) {
      this.pending.delete(id);
      resolve(response);
    } else this.responder?.(response);
    return null;
  }

  private notify(input: {
    level?: AppNotice['level'];
    message?: string;
    source?: string;
  }): null {
    this.notices.push({
      id: `notice-${(this.noticeSeq += 1)}`,
      level: input.level ?? 'info',
      message: String(input.message ?? ''),
      ...(input.source ? { source: input.source } : {}),
    });
    this.publishNotices();
    return null;
  }

  private dismiss(input: { id?: string } | undefined): AppNotice[] {
    if (input?.id) {
      const index = this.notices.findIndex((item) => item.id === input.id);
      if (index >= 0) this.notices.splice(index, 1);
    } else {
      this.notices.splice(0);
    }
    this.publishNotices();
    return [...this.notices];
  }

  private publishDialogs(): void {
    this.dialogState.publish([...this.dialogs]);
    const overlay = this.deps.overlay();
    const id = this.deps.overlayId();
    if (overlay && id) {
      overlay.setVisible(
        id,
        this.dialogs.some((dialog) => dialog.status === 'open'),
      );
    }
  }

  private publishNotices(): void {
    this.noticeState.publish([...this.notices]);
  }
}
