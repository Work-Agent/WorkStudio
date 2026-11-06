import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { SKINS, type AppearanceSnapshot } from '../../../shared/appearance';
/**
 * S1 应用壳层 TitleBar —— architecture.md §2.2。
 *
 *   - 左区：① 工作区选择器 + ② 侧栏开关（同一布局分组，次序可互换）
 *   - 中区：资源地址栏（浏览器地址栏语义：url + spinner + 按类型动作）
 *   - 右区：AI / 主题 / W 徽标（资源 / 插件 / 设置切换在 Sidebar 顶部导航，见 SidebarNav）
 */
import { Palette, PanelLeftClose, PanelLeftOpen, Sparkles } from 'lucide-react';
import { setUiState, useUiStore } from '../../state/ui';
import { ResourceToolbar } from './ResourceToolbar';
import { WorkspaceSelect } from './WorkspaceSelect';
import { electronAPI } from '../../api/runtime';

export function TitleBar() {
  const manualWindowMove = electronAPI.platform === 'darwin';
  const movingPointer = useRef<number | null>(null);
  const moveFrame = useRef(0);
  const finishMove = (): void => {
    if (movingPointer.current === null) return;
    movingPointer.current = null;
    cancelAnimationFrame(moveFrame.current);
    moveFrame.current = 0;
    void window.appBridge?.call('/native/window-move/end');
  };
  useEffect(() => {
    window.addEventListener('blur', finishMove);
    return () => {
      window.removeEventListener('blur', finishMove);
      finishMove();
    };
  }, []);
  const beginMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!manualWindowMove || event.button !== 0) return;
    if (
      (event.target as Element).closest(
        'button, input, select, textarea, a, [role="button"], .no-drag',
      )
    )
      return;
    event.preventDefault();
    const handle = event.currentTarget,
      pointerId = event.pointerId;
    movingPointer.current = pointerId;
    handle.setPointerCapture(pointerId);
    void window.appBridge
      ?.call<boolean>('/native/window-move/begin')
      .then((result) => {
        if (result.ok && result.data) return;
        finishMove();
        if (handle.hasPointerCapture(pointerId))
          handle.releasePointerCapture(pointerId);
      });
  };
  const updateMove = (): void => {
    if (movingPointer.current === null || moveFrame.current) return;
    moveFrame.current = requestAnimationFrame(() => {
      moveFrame.current = 0;
      if (movingPointer.current !== null)
        void window.appBridge?.call('/native/window-move/update');
    });
  };
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const aiOpen = useUiStore((s) => s.aiOpen);
  const [appearance, setAppearance] = useState<AppearanceSnapshot | null>(null);
  useEffect(() => {
    const bridge = window.appBridge;
    if (!bridge) return;
    const off = bridge.on((f) => {
      if (f.type === 'state' && f.path === '/appearance')
        setAppearance(f.value as AppearanceSnapshot);
    });
    void bridge.watch(['/appearance']);
    return off;
  }, []);
  const chooseSkin = async (): Promise<void> => {
    const r = await window.appBridge?.call<string | null>(
      '/native/popup-menu',
      {
        items: [
          ...Object.entries(SKINS).map(([id, skin]) => ({
            id,
            label: `${appearance?.mode === 'fixed' && appearance.skin === id ? '✓ ' : ''}${skin.label}`,
          })),
          {
            id: 'system',
            label: `${appearance?.mode === 'system' ? '✓ ' : ''}跟随系统`,
          },
          { id: 'settings', label: '外观与皮肤设置…' },
        ],
      },
    );
    if (!r?.ok || !r.data) return;
    if (r.data === 'settings') {
      await window.appBridge?.call('/settings/open', { pageId: 'appearance' });
      return;
    }
    await window.appBridge?.call(
      '/appearance/set',
      r.data === 'system'
        ? { mode: 'system' }
        : { mode: 'fixed', skin: r.data },
    );
  };

  const iconButton = (active: boolean): string =>
    `h-8 w-8 rounded-md flex items-center justify-center transition-colors ${
      active
        ? 'text-[var(--biz-accent)] dark:text-[var(--biz-accent)] hover:bg-[var(--biz-surface)] dark:hover:bg-[var(--biz-surface)]'
        : 'text-[var(--biz-text-muted)] hover:bg-[var(--biz-surface)] dark:hover:bg-[var(--biz-surface)] hover:text-[var(--biz-text)] dark:hover:text-[var(--biz-text)]'
    }`;

  return (
    <div
      className="titlebar shrink-0 flex items-center gap-1.5 border-b border-l border-[var(--biz-border)] bg-[var(--biz-surface)] select-none"
      data-testid="window-titlebar"
      data-manual-move={manualWindowMove || undefined}
      onPointerDown={beginMove}
      onPointerMove={updateMove}
      onPointerUp={finishMove}
      onPointerCancel={finishMove}
      onLostPointerCapture={finishMove}
    >
      {/* ── 左区：① 工作区选择器 + ② 侧栏开关（弹出层 = 原生菜单） ── */}
      <div className="flex items-center gap-0.5 shrink-0">
        <WorkspaceSelect />
        <button
          onClick={() => setUiState({ sidebarCollapsed: !sidebarCollapsed })}
          data-testid="sidebar-toggle"
          title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
          className="h-8 w-8 rounded-md flex items-center justify-center text-[var(--biz-text-muted)] hover:bg-[var(--biz-surface)] dark:hover:bg-[var(--biz-surface)] hover:text-[var(--biz-text)] dark:hover:text-[var(--biz-text)] transition-colors"
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen className="w-4 h-4" />
          ) : (
            <PanelLeftClose className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* 顶部非交互区域统一拖动窗口；工具按钮保持独立点击。 */}
      <div className="flex-1 min-w-0 flex justify-center px-2">
        <ResourceToolbar />
      </div>

      {/* ── 右区 · ④ 动作组：AI / 主题 / W 徽标（图标本色高亮制） ── */}
      <div className="flex items-center">
        <button
          onClick={() => setUiState({ aiOpen: !aiOpen })}
          title={aiOpen ? '收起 AI 对话' : '展开 AI 对话'}
          className={iconButton(aiOpen)}
        >
          <Sparkles className="w-4 h-4" />
        </button>
        <button
          onClick={() => void chooseSkin()}
          title="外观与皮肤"
          aria-label="外观与皮肤"
          data-testid="appearance-menu"
          className="h-8 w-8 rounded-md flex items-center justify-center transition-colors text-[var(--biz-text-muted)] hover:bg-[var(--biz-surface)] dark:hover:bg-[var(--biz-surface)] hover:text-[var(--biz-text)] dark:hover:text-[var(--biz-text)]"
        >
          <Palette className="w-4 h-4" />
        </button>
        <div
          title="Work Studio"
          className="ml-1 h-7 w-7 rounded-full flex items-center justify-center bg-[var(--biz-accent)] text-[var(--biz-primary-ink)] text-[12px] font-semibold"
        >
          W
        </div>
      </div>
    </div>
  );
}
