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
  ) {}

  closeAll(): void {
    for (const view of this.registry.list()) this.close(view.id);
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

  command(action: string, call: RouteCall): null {
    const id = String(call.params['viewId']);
    const record = this.registry.get(id);
    if (!record) throw new RouteFailure('unknown', `view ${id} not found`);
    switch (action) {
      case 'activate':
        this.registry.setActive(id);
        this.electron.views.activate(id);
        break;
      case 'close':
        this.close(id);
        break;
      case 'reload':
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
          action: String(input?.action ?? ''),
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
        this.close(active);
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
