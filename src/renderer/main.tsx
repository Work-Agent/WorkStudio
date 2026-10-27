/**
 * 渲染层入口 —— AppSnapshot 水合 → 领域 store 初始化 → 全局订阅 → mount。
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { bindTitlebarInsets } from './components/titlebar/windowControls';
import { useAgentConfigStore } from './state/agentConfig';
import { initAppScope } from './state/appScope';
import { bindPiEvents, useConversationStore } from './state/conversation';
import './index.css';

async function bootstrap(): Promise<void> {
  try {
    await initAppScope();
    bindPiEvents();
    await Promise.all([
      useConversationStore.getState().init(),
      useAgentConfigStore.getState().init(),
    ]);
    bindTitlebarInsets();
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
