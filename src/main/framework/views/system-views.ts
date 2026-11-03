/** shell / assistant / overlay / capture 系统视图的创建与重建。 */
import type { Grant } from '../../core/types';
import type { ElectronCapability, PreloadName } from '../electron-middleware';
import type { ViewRecord, ViewRegistry } from '../views';
import type { CreateViewRequest } from './types';

export const FRAME_CHANNEL = 'appBridge:frame';

export class SystemViews {
  private shellId: string | null = null;
  private readonly systemViews = new Map<string, string>();

  constructor(
    private readonly electron: ElectronCapability,
    private readonly registry: ViewRegistry,
    private readonly createView: (input: CreateViewRequest) => ViewRecord,
  ) {}

  overlayId(): string | undefined {
    return this.systemViews.get('overlay');
  }

  ensure(): void {
    this.ensureShell();
    this.ensureSystemViews();
  }

  reactivate(): void {
    const current = this.electron.window.webContentsId();
    const shell = this.shellId ? this.registry.get(this.shellId) : null;
    if (shell && current !== null && shell.externalId !== String(current)) {
      this.registry.remove(shell.id);
      this.shellId = null;
      for (const id of this.systemViews.values()) this.registry.remove(id);
      this.systemViews.clear();
    }
    this.ensure();
  }

  private ensureShell(): void {
    if (this.shellId) return;
    const wcId = this.electron.window.webContentsId();
    if (wcId === null) return;
    const record = this.registry.create({
      type: 'shell',
      title: 'Workbench',
      grants: {
        call: ['/**'],
        watch: ['/**'],
      },
      externalId: String(wcId),
    });
    this.shellId = record.id;
    this.registry.attach(record.id, (frame) =>
      this.electron.window.send(FRAME_CHANNEL, frame),
    );
  }

  private ensureSystemViews(): void {
    this.ensureSystemView({
      type: 'assistant',
      page: 'assistant.html',
      preload: 'assistant',
      grants: {
        call: [
          '/views/**',
          '/theme',
          '/layout',
          '/scene/**',
          '/interaction',
          '/dialogs/**',
          '/notices',
          '/notify',
          '/native/**',
          '/piconf/**',
          '/workspaces/:wsId/sessions/**',
        ],
        watch: [
          '/views/**',
          '/theme',
          '/layout',
          '/scene/**',
          '/interaction',
          '/dialogs/**',
          '/notices',
          '/piconf',
          '/workspaces',
          '/workspaces/current',
          '/workspaces/:wsId/sessions/**',
        ],
      },
    });
    this.ensureSystemView({
      type: 'overlay',
      page: 'overlay.html',
      preload: 'overlay',
      grants: {
        call: ['/dialogs/**', '/views/self/**'],
        watch: ['/dialogs'],
      },
    });
    this.ensureSystemView({
      type: 'capture',
      page: 'overlay.html',
      preload: 'capture',
      grants: {},
    });
  }

  private ensureSystemView(input: {
    type: 'assistant' | 'overlay' | 'capture';
    page: string;
    preload: PreloadName;
    grants: Grant;
  }): void {
    if (this.systemViews.has(input.type)) return;
    const record = this.createView({
      type: input.type,
      title: input.type,
      url: this.electron.rendererUrl(input.page),
      preload: input.preload,
      grants: input.grants,
    });
    this.systemViews.set(input.type, record.id);
  }
}
