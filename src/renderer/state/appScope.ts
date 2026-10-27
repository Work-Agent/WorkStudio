/**
 * AppSnapshot 投影入口（Phase 6）。
 *
 * 渲染层启动 / 重连走 app.sync；后续快照按 epoch 收敛到各投影 store。
 * 会话事件仍在 Phase 6 后续迁移到 AppEvent。
 */

import { create } from 'zustand';
import type { AppEvent, AppSnapshot } from '../../shared/app';
import { toAgentStatus, useAgentConfigStore } from './agentConfig';
import { useListsStore } from './lists';
import { useShellStore } from './shell';
import { useUiStore } from './uiState';

export const useAppScope = create<{ snapshot: AppSnapshot | null }>(() => ({
  snapshot: null,
}));

let initialized = false;
let workspaceEpoch = -1;
let sessionEpoch = -1;

export async function initAppScope(): Promise<void> {
  if (initialized) return;
  initialized = true;
  const bridge = typeof window !== 'undefined' ? window.workbench : undefined;
  if (!bridge) return;

  const snapshot = await bridge.appSync();
  applySnapshot(snapshot);
  bridge.onAppSnapshot((next) => {
    if (!isFresh(next)) return;
    applySnapshot(next);
  });
  bridge.onAppEvent((event) => {
    if (event.epoch < epochOf(event.scope)) return;
    // Phase 6 后续：AppEvent 直接写入对应切片；当前由快照收敛。
  });
}

function epochOf(scope: AppEvent['scope']): number {
  if (scope === 'workspace' || scope === 'ui') return workspaceEpoch;
  if (scope === 'session') return sessionEpoch;
  return 0;
}

function isFresh(snapshot: AppSnapshot): boolean {
  if (snapshot.workspaceEpoch < workspaceEpoch) return false;
  if (
    snapshot.workspaceEpoch === workspaceEpoch &&
    snapshot.sessionEpoch < sessionEpoch
  )
    return false;
  workspaceEpoch = snapshot.workspaceEpoch;
  sessionEpoch = snapshot.sessionEpoch;
  return true;
}

function applySnapshot(snapshot: AppSnapshot): void {
  useAppScope.setState({ snapshot });
  workspaceEpoch = snapshot.workspaceEpoch;
  sessionEpoch = snapshot.sessionEpoch;

  useShellStore.setState({
    layout: snapshot.layout,
    views: snapshot.workspace.views,
  });
  useListsStore.setState({
    groups: snapshot.workspace.lists.groups,
    loading: false,
  });
  useAgentConfigStore.setState({
    status: snapshot.session.snapshot
      ? toAgentStatus(snapshot.session.snapshot)
      : { configured: false },
    models: snapshot.app.models.models,
  });

  const ui = snapshot.ui;
  useUiStore.setState({
    hydrated: true,
    theme: ui.theme,
    aiOpen: ui.assistant.open,
    aiFloating: ui.assistant.floating,
    sidebarView: ui.sidebar.view,
    sidebarDomain: ui.sidebar.domain,
    sidebarCollapsed: ui.sidebar.collapsed,
    paneWidths: ui.paneWidths,
    inputExpanded: ui.assistant.inputExpanded,
    openPaths: ui.openSessionPaths,
    activePath: snapshot.session.meta?.path ?? null,
    selectedSkills: snapshot.session.context.activeSkills,
  });
}
