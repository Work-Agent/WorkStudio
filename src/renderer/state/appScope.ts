/**
 * AppSnapshot 投影入口。
 *
 * 渲染层启动 / 重连走 app.sync；后续快照按 epoch 收敛到各投影 store。
 * 主窗口只消费快照；会话事件由助手视图订阅。
 */

import type { AppSnapshot } from '../../shared/app';
import { toAgentStatus, useAppStore } from './app';
import { useNotificationsStore } from './notifications';
import { useUiStore } from './ui';
import { useWorkspaceStore } from './workspace';

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
  // 几何帧：拖拽 / 缩放期间只更新 layout，不重建业务投影。
  bridge.onLayout((layout) => {
    useWorkspaceStore.setState({ layout });
  });
  bridge.onUi((request) => {
    if (request.type !== 'notify') return;
    useNotificationsStore.getState().push({
      id: request.id,
      message: request.message,
      level: request.level,
      ...(request.source ? { source: request.source } : {}),
    });
  });
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
  workspaceEpoch = snapshot.workspaceEpoch;
  sessionEpoch = snapshot.sessionEpoch;

  useWorkspaceStore.setState({
    layout: snapshot.layout,
    views: snapshot.workspace.views,
    groups: snapshot.workspace.lists.groups,
  });
  useAppStore.setState({
    status: snapshot.session.snapshot
      ? toAgentStatus(snapshot.session.snapshot)
      : { configured: false },
    models: snapshot.app.models.models,
  });

  const ui = snapshot.ui;
  useUiStore.setState({
    theme: ui.theme,
    aiOpen: ui.assistant.open,
    aiFloating: ui.assistant.floating,
    sidebarView: ui.sidebar.view,
    sidebarDomain: ui.sidebar.domain,
    sidebarCollapsed: ui.sidebar.collapsed,
    sidebarGroup: ui.sidebar.group,
    paneWidths: ui.paneWidths,
    inputExpanded: ui.assistant.inputExpanded,
    openPaths: ui.openSessionPaths,
    activePath: snapshot.session.meta?.path ?? null,
    selectedSkills: snapshot.session.context.activeSkills,
  });
}
