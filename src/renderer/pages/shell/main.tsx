/**
 * 渲染层入口 —— workStudio 就绪 → 模块各自订阅 domain → mount。
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { bindTitlebarInsets } from './components/titlebar/windowControls.ts';
import { initAppScope } from '../../shared/api/appScope.ts';
import { initPathDisplay } from '../../shared/api/pathDisplay.ts';
import '../../shared/styles/index.css';

async function bootstrap(): Promise<void> {
  try {
    await initAppScope();
    await initPathDisplay();
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
