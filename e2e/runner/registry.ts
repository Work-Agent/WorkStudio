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
import viewLifecycle from '../cases/view-lifecycle.ts';
import welcome from '../cases/welcome.ts';
import assistantBridge from '../cases/assistant-bridge.ts';
import settingsModels from '../cases/settings-models.ts';
import tabsBulk from '../cases/tabs-bulk.ts';
import tabsCloseOthers from '../cases/tabs-close-others.ts';
import resourcesDiagnostics from '../cases/resources-diagnostics.ts';
import settingsBinding from '../cases/settings-binding.ts';
import assistantThinking from '../cases/assistant-thinking.ts';
import settingsAppearance from '../cases/settings-appearance.ts';

export const cases: readonly E2ECase[] = [
  navigation,
  browserOpen,
  browserLinks,
  siteOpen,
  dialogOverlay,
  settingsOpen,
  settingsSidebar,
  tabs,
  viewLifecycle,
  pathDisplay,
  pluginEntry,
  welcome,
  assistantBridge,
  settingsModels,
  tabsBulk,
  tabsCloseOthers,
  resourcesDiagnostics,
  settingsBinding,
  assistantThinking,
  settingsAppearance,
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
