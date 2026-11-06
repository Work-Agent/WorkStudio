import type { UiDialogRequest, UiDialogResponse } from '../../../shared/types';
/** 视图集合运行时：关闭族 / 标签命令 / 快捷键。 */
import type { WebContents } from 'electron';
import { CH_BUS } from '../../../shared/channels';
import { RouteFailure } from '../../core/failure';
import type { RouteCall } from '../../core/types';
import type { ElectronCapability } from '../electron-middleware';
import type { ProviderRegistry } from '../providers';
import type { ViewRegistry } from '../views';

export class ViewRuntime {
  constructor(
    private readonly registry: ViewRegistry,
    private readonly electron: ElectronCapability,
    private readonly providers: ProviderRegistry,
    private readonly ask: (
      request: Omit<UiDialogRequest, 'id' | 'type'>,
    ) => Promise<UiDialogResponse>,
  ) {}

  private preparing = false;

  async prepare(
    ids = this.registry.list().map((view) => view.id),
  ): Promise<boolean> {
    if (this.preparing) return false;
    this.preparing = true;
    try {
      for (const id of ids) {
        const view = this.registry.get(id);
        if (!view?.dirty) continue;
        this.registry.setActive(id);
        this.electron.views.activate(id);
        const manualSave = /\/(models|storage|updates|browser)$/.test(
          view.contentPath ?? '',
        );
        const response = await this.ask({
          dialogType: 'select',
          title: '要保存修改吗？',
          message: `${view.title} 有未保存的修改。${manualSave ? '\n请取消后，在对应表单中保存设置。' : ''}${view.conflict ? '\n外部文件已变化，请取消后先另存草稿或检查文件。' : ''}`,
          options:
            view.conflict || manualSave
              ? ['放弃修改']
              : ['保存并继续', '放弃修改'],
        });
        if (response.cancelled || !response.value) return false;
        if (response.value === '放弃修改') continue;
        if (view.conflict || !(await this.save(id))) return false;
      }
      return true;
    } finally {
      this.preparing = false;
    }
  }

  private save(id: string): Promise<boolean> {
    return new Promise((resolve) => {
      const wc = this.electron.views.webContents(id);
      if (!wc) {
        resolve(false);
        return;
      }
      let finished = false;
      const finish = (ok: boolean): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        off();
        wc.removeListener('ipc-message', onBus);
        resolve(ok);
      };
      const off = this.registry.onChange(() => {
        if (this.registry.get(id)?.dirty === false) finish(true);
      });
      const onBus = (
        _event: unknown,
        channel: string,
        message: { type?: string; ok?: boolean },
      ): void => {
        if (
          channel === CH_BUS &&
          message?.type === 'save-result' &&
          !message.ok
        )
          finish(false);
      };
      wc.on('ipc-message', onBus);
      const timer = setTimeout(() => finish(false), 8000);
      this.electron.views.send(id, CH_BUS, { type: 'action', id: 'save' });
    });
  }

  async closeAll(guard = true): Promise<boolean> {
    if (guard && !(await this.prepare())) return false;
    for (const view of this.registry.list()) this.close(view.id);
    return true;
  }

  close(id: string): void {
    const record = this.registry.remove(id);
    if (!record) return;
    if (record.contentPath) {
      const provider = this.providers.match(record.contentPath);
      provider?.release?.(record.contentPath);
    }
    this.electron.views.close(id);
    if (this.registry.activeId()) return;
    const remaining = this.registry.list();
    const last = remaining[remaining.length - 1];
    if (last) {
      this.registry.setActive(last.id);
      this.electron.views.activate(last.id);
    }
  }

  async command(action: string, call: RouteCall): Promise<null> {
    const id = String(call.params['viewId']);
    const record = this.registry.get(id);
    if (!record) throw new RouteFailure('unknown', `view ${id} not found`);
    const list = this.registry.list();
    const index = list.findIndex((view) => view.id === id);
    const targets =
      action === 'close-others'
        ? list.filter((view) => view.id !== id).map((view) => view.id)
        : action === 'close-to-left'
          ? list.slice(0, index).map((view) => view.id)
          : action === 'close-to-right'
            ? list.slice(index + 1).map((view) => view.id)
            : [id];
    if (
      [
        'close',
        'reload',
        'navigate',
        'close-others',
        'close-to-left',
        'close-to-right',
      ].includes(action) &&
      !(await this.prepare(targets))
    )
      return null;
    switch (action) {
      case 'activate':
        this.registry.setActive(id);
        this.electron.views.activate(id);
        break;
      case 'close':
        this.close(id);
        break;
      case 'reload':
        if (record.contentPath)
          await this.providers
            .match(record.contentPath)
            ?.refresh?.(record.contentPath);
        this.electron.views.reload(id);
        break;
      case 'navigate': {
        const input = call.input as { url?: string } | undefined;
        this.electron.views.navigate(id, String(input?.url ?? ''));
        break;
      }
      case 'toggle-pin':
        this.registry.togglePin(id);
        break;
      case 'move': {
        const input = call.input as { toId?: string } | undefined;
        if (input?.toId) this.registry.move(id, input.toId);
        break;
      }
      case 'close-others': {
        for (const view of this.registry.list()) {
          if (view.id !== id) this.close(view.id);
        }
        this.registry.setActive(id);
        this.electron.views.activate(id);
        break;
      }
      case 'close-to-left': {
        const list = this.registry.list();
        const index = list.findIndex((view) => view.id === id);
        if (index < 0) break;
        for (const view of list.slice(0, index)) this.close(view.id);
        break;
      }
      case 'close-to-right': {
        const list = this.registry.list();
        const index = list.findIndex((view) => view.id === id);
        if (index < 0) break;
        for (const view of list.slice(index + 1)) this.close(view.id);
        break;
      }
      case 'go-back':
        this.electron.views.goBack(id);
        break;
      case 'go-forward':
        this.electron.views.goForward(id);
        break;
      case 'action':
      case 'run-action': {
        const input = call.input as { action?: string } | undefined;
        this.electron.views.send(id, CH_BUS, {
          type: 'action',
          id: String(input?.action ?? ''),
        });
        break;
      }
      default:
        break;
    }
    return null;
  }

  attachShortcuts(wc: WebContents): void {
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      if (!(input.meta || input.control) || input.alt) return;
      if (input.key.toLowerCase() === 'w') {
        const active = this.registry.list().find((view) => view.active)?.id;
        if (!active) return;
        event.preventDefault();
        void this.command('close', {
          path: `/views/${active}/close`,
          base: '',
          params: { viewId: active },
          input: null,
          origin: { type: 'service', id: 'views', base: '' },
        });
        return;
      }
      const digit = Number.parseInt(input.key, 10);
      if (Number.isNaN(digit) || digit < 1 || digit > 9) return;
      const target = this.registry.list()[digit - 1];
      if (!target) return;
      event.preventDefault();
      this.registry.setActive(target.id);
      this.electron.views.activate(target.id);
    });
  }
}
