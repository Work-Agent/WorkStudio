/**
 * 渲染层入口 —— 启动编排（hydrate → store 初始化 → 全局订阅 → mount）。
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { bindTitlebarInsets } from './components/titlebar/windowControls';
import { useAgentConfigStore } from './state/agentConfig';
import { bindPiEvents, useConversationStore } from './state/conversation';
import { bindPiUIRequests } from './state/piUI';
import {
  bindContentDelivery,
  bindExternalContentSync,
  bindThemeBroadcast,
  useTabServiceStore,
} from './state/tabService';
import { initShellPresentation } from './state/shell';
import { initAppScope } from './state/appScope';
import { initUiState } from './state/uiState';
import './index.css';

async function bootstrap(): Promise<void> {
  try {
    // 1. AppSnapshot 水合（新主进程契约）+ 旧状态 store 兼容
    await initAppScope();
    await initUiState();
    if (!window.workbench) await initShellPresentation();
    console.log('[bootstrap] shell presentation ready');

    // 2. 领域 store 初始化
    //    新架构（window.workbench 存在）：全线走主进程命令，mock / tabService 不初始化；
    //    旧路径（独立页面开发）保留 mock 初始化。
    const hasMainBridge = Boolean(window.workbench);
    bindPiEvents();
    if (!hasMainBridge) {
      bindPiUIRequests();
    }
    await Promise.all([
      useConversationStore.getState().init(),
      useAgentConfigStore.getState().init(),
      ...(hasMainBridge ? [] : [useTabServiceStore.getState().init()]),
    ]);
    console.log('[bootstrap] stores initialized');

    // 3. 全局编排（内容投递 / 主题广播 / 外部变更重投）
    //    原生三键（WCO）留白 → CSS 变量：先于 TitleBar 挂载（TitleBar 布局依赖它）
    bindTitlebarInsets();
    if (!hasMainBridge) {
      bindContentDelivery();
      bindThemeBroadcast();
      bindExternalContentSync();
    }

    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    console.log('[bootstrap] rendered');
  } catch (e) {
    console.error('[bootstrap] FAILED:', e);
    const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
    const root = document.getElementById('root');
    if (root)
      root.innerHTML = `<pre style="color:red;padding:20px">${msg}</pre>`;
  }
}

void bootstrap();
