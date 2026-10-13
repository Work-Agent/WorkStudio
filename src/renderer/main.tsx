/**
 * 渲染层入口 —— 启动编排（hydrate → store 初始化 → 全局订阅 → mount）。
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { bindTitlebarInsets } from './components/titlebar/windowControls';
import { useAgentConfigStore } from './state/agentConfig';
import { bindPiEvents, useConversationStore } from './state/conversation';
import { useDocumentsStore } from './state/documents';
import { bindPiUIRequests } from './state/piUI';
import {
  bindContentDelivery,
  bindExternalContentSync,
  bindThemeBroadcast,
  useTabServiceStore,
} from './state/tabService';
import { initUiState } from './state/uiState';
import './index.css';

async function bootstrap(): Promise<void> {
  try {
    // 1. 用户操作状态 hydrate（主进程 ui-state.json 真相源）
    await initUiState();
    console.log('[bootstrap] uiState hydrated');

    // 2. 领域 store 初始化（IPC 拉取 + 事件订阅）
    bindPiEvents();
    bindPiUIRequests();
    await Promise.all([
      useConversationStore.getState().init(),
      useTabServiceStore.getState().init(),
      useDocumentsStore.getState().init(),
      useAgentConfigStore.getState().init(),
    ]);
    console.log('[bootstrap] stores initialized');

    // 3. 全局编排（内容投递 / 主题广播 / 外部变更重投）
    //    原生三键（WCO）留白 → CSS 变量：先于 TitleBar 挂载（TitleBar 布局依赖它）
    bindTitlebarInsets();
    bindContentDelivery();
    bindThemeBroadcast();
    bindExternalContentSync();

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
