/**
 * origin 判定：主进程按发送方（webContents）查到来源。
 *
 * 页面不能自称是哪个视图；来源表由窗口 / 视图宿主在创建时登记，
 * 销毁时注销。服务与工具来源由组合根登记。
 */

import type { Origin } from '../contract.ts';

export class Origins {
  private readonly bySender = new Map<string, Origin>();

  register(senderId: string, origin: Origin): () => void {
    this.bySender.set(senderId, origin);
    return () => {
      this.bySender.delete(senderId);
    };
  }

  of(senderId: string): Origin | null {
    return this.bySender.get(senderId) ?? null;
  }

  /** 网页视图导航后更新来源地址（域名校验读它）。 */
  setUrl(senderId: string, url: string): void {
    const origin = this.bySender.get(senderId);
    if (origin?.type === 'view' && origin.viewType === 'web') {
      this.bySender.set(senderId, { ...origin, url });
    }
  }

  /** 发送方 → 视图的反查；用于把更新投递给正确的 webContents。 */
  senderOfView(viewId: string): string | null {
    for (const [senderId, origin] of this.bySender) {
      if (origin.type === 'view' && origin.viewId === viewId) {
        return senderId;
      }
    }
    return null;
  }

  remove(senderId: string): void {
    this.bySender.delete(senderId);
  }
}
