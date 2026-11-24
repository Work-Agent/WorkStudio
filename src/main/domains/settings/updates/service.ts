/**
 * 客户端更新业务：检查 / 下载 / 状态订阅。核心逻辑在 update/updater.ts。
 */

import type { UpdateService, UpdateStatus } from './updater.ts';

export class UpdatesService {
  private readonly listeners = new Set<() => void>();

  constructor(private readonly updater: UpdateService) {
    updater.onChange(() => {
      for (const listener of this.listeners) listener();
    });
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  status(): UpdateStatus {
    return this.updater.currentStatus();
  }

  check(): Promise<UpdateStatus> {
    return this.updater.check();
  }

  download(): Promise<UpdateStatus> {
    return this.updater.download();
  }

  install(): UpdateStatus {
    return this.updater.install();
  }

  cancel(): UpdateStatus {
    return this.updater.cancel();
  }
}
