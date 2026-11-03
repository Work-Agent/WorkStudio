/**
 * 渲染层启动入口：等待 appBridge 就绪后建立 app 路由投影。
 *
 * 旧 AppSnapshot / app.sync 路径已删除；渲染层只消费 appBridge。
 */
import { initAppRoutes } from './appRouteScope';

let initialized = false;

export async function initAppScope(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const bridge = typeof window !== 'undefined' ? window.appBridge : undefined;
  if (!bridge) throw new Error('appBridge is unavailable');

  // dev / 首帧可能早于主进程 IPC 绑定：短暂重试，绝不回落到 app.sync。
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const available = await bridge.available().catch(() => false);
    if (available) {
      await initAppRoutes();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('appBridge is not ready');
}
