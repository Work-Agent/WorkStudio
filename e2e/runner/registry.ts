import type { CaseTag, E2ECase } from './contract.ts';
import browserOpen from '../cases/browser-open.ts';
import browserLinks from '../cases/browser-links.ts';
import dialogOverlay from '../cases/dialog-overlay.ts';
import navigation from '../cases/navigation.ts';
import pathDisplay from '../cases/path-display.ts';
import pluginEntry from '../cases/plugin-entry.ts';
import settingsOpen from '../cases/settings-open.ts';
import settingsSidebar from '../cases/settings-sidebar.ts';
import siteOpen from '../cases/site-open.ts';
import tabs from '../cases/tabs.ts';
import themeToggle from '../cases/theme-toggle.ts';
import settingsStorage from '../cases/settings-storage.ts';
import browserAutomation from '../cases/browser-automation.ts';
import pluginSkills from '../cases/plugin-skills.ts';
import shellCapture from '../cases/shell-capture.ts';
import pluginSave from '../cases/plugin-save.ts';
import pluginContent from '../cases/plugin-content.ts';
import assistantSessions from '../cases/assistant-sessions.ts';
import pluginInstall from '../cases/plugin-install.ts';
import dialogSelect from '../cases/dialog-select.ts';
import settingsPreferences from '../cases/settings-preferences.ts';
import pluginLifecycle from '../cases/plugin-lifecycle.ts';
import assistantFloating from '../cases/assistant-floating.ts';
import layoutPersist from '../cases/layout-persist.ts';
import workspaceSwitch from '../cases/workspace-switch.ts';
import settingsCards from '../cases/settings-cards.ts';
import workspaceRegistry from '../cases/workspace-registry.ts';
import notices from '../cases/notices.ts';
import dialogInput from '../cases/dialog-input.ts';
import tabsActions from '../cases/tabs-actions.ts';
import panelToggle from '../cases/panel-toggle.ts';
import windowDefaults from '../cases/window-defaults.ts';
import viewLifecycle from '../cases/view-lifecycle.ts';
import welcome from '../cases/welcome.ts';
import assistantBridge from '../cases/assistant-bridge.ts';
import settingsModels from '../cases/settings-models.ts';
import tabsBulk from '../cases/tabs-bulk.ts';
import tabsCloseOthers from '../cases/tabs-close-others.ts';
import resourcesDiagnostics from '../cases/resources-diagnostics.ts';
import settingsBinding from '../cases/settings-binding.ts';
import assistantThinking from '../cases/assistant-thinking.ts';
import agentResources from '../cases/agent-resources.ts';
import settingsAppearance from '../cases/settings-appearance.ts';
import newPageTheme from '../cases/new-page-theme.ts';
import settingsAddress from '../cases/settings-address.ts';
import listSidebar from '../cases/list-sidebar.ts';
import agentWorkspace from '../cases/agent-workspace.ts';
import agentSessions from '../cases/agent-sessions.ts';

export const cases: readonly E2ECase[] = [
  windowDefaults,
  panelToggle,
  navigation,
  browserOpen,
  browserAutomation,
  browserLinks,
  siteOpen,
  dialogOverlay,
  dialogInput,
  dialogSelect,
  notices,
  settingsOpen,
  settingsSidebar,
  tabs,
  tabsActions,
  viewLifecycle,
  pathDisplay,
  pluginEntry,
  pluginLifecycle,
  pluginInstall,
  pluginContent,
  pluginSave,
  pluginSkills,
  welcome,
  assistantBridge,
  assistantSessions,
  settingsModels,
  tabsBulk,
  tabsCloseOthers,
  resourcesDiagnostics,
  settingsBinding,
  assistantThinking,
  agentResources,
  settingsAppearance,
  settingsPreferences,
  settingsStorage,
  settingsCards,
  workspaceRegistry,
  listSidebar,
  agentWorkspace,
  agentSessions,
  workspaceSwitch,
  layoutPersist,
  shellCapture,
  themeToggle,
  newPageTheme,
  settingsAddress,
  assistantFloating,
];

export interface CaseFilter {
  id?: string;
  tag?: CaseTag;
  grep?: string;
  all?: boolean;
}

export function selectCases(
  filter: CaseFilter,
  options: { allowMutating?: boolean } = {},
): E2ECase[] {
  const needle = filter.grep?.trim();
  return cases.filter((testCase) => {
    const tags = testCase.tags ?? [];
    if (filter.id && testCase.id !== filter.id) return false;
    if (filter.tag && !tags.includes(filter.tag)) return false;
    if (needle && !`${testCase.id} ${testCase.title}`.includes(needle)) {
      return false;
    }
    // dev 运行器永远不跑 Playwright 独占用例。
    if (tags.includes('playwright-only')) return false;
    if (!options.allowMutating && tags.includes('mutating')) return false;
    return true;
  });
}
