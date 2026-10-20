/**
 * 命令路由（architecture.md §四）—— ws:cmd 唯一分发器 + 握手 / 扩展页 / 交互通道。
 *
 * 命令目录（域 × 动作）：
 *   session.*       会话生命周期（AgentHost）
 *   agent.*         Agent 配置（模型 / 档位 / 工作区）
 *   config.models.* models.json 目录 CRUD（写盘 → 校验 → runtime 换代）
 *   config.settings.* 偏好设置三层
 *   ura.*           资源管道（读 / 写 / 检索 / 页面会话 / 资源树）
 *   plugins.list / skills.list / skills.setActive
 *   views.*         视图集合命令（ViewHost）
 *   ui.get / ui.set / ui.respond
 *
 * 来源策略：工作台窗口 = 全量；助手视图 = session/agent/ui/skills 子集；
 * 插件页经 ws:ext 走 app:* 前缀（同一命令目录，语义不复制）。
 */
import {
  dialog,
  ipcMain,
  shell,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from 'electron';
import { existsSync } from 'fs';
import type {
  CommandResponse,
  ShellSnapshot,
  StorageView,
  WorkSyncResult,
  WorkspaceInfo,
} from '../../shared/types';
import { CH_CMD, CH_EXT, CH_INTERACTION, CH_SYNC } from '../../shared/channels';
import type { AgentHost } from '../agent/agent-host';
import type {
  ModelConfigStore,
  SettingsService,
} from '../agent/config-service';
import type { PiPackageService } from '../agent/package-service';
import type { Ura } from '../ura/facade';
import type { Collections } from '../ura/collections';
import { uraRegistry } from '../ura/registry';
import { WriteSessionRegistry } from '../ura/sessions';
import type { PageSessions } from '../ura/page-sessions';
import type { SkillsManager } from '../harness/skills';
import type { PluginHost } from '../plugins/host';
import type { UiStateService } from '../state/ui-state';
import type { InteractionController } from '../views/interaction';
import type { ViewHost } from '../views/view-host';
import {
  listWorkspaces,
  getCurrentWorkspace,
  getWorkspaceId,
  workspaceLabel,
} from '../agent/workspace';
import { createLogger } from '../log';

const log = createLogger('command');

export interface RouterDeps {
  agent: AgentHost;
  viewHost: ViewHost;
  uiState: UiStateService;
  ura: Ura;
  collections: Collections;
  writeSessions: WriteSessionRegistry;
  pageSessions: PageSessions;
  skills: SkillsManager;
  registry: PluginHost;
  modelConfig: ModelConfigStore;
  packages: PiPackageService;
  getSettingsService: () => SettingsService;
  interaction: InteractionController;
  getWindow: () => BrowserWindow | null;
  /** Shell 快照（UiState + 布局 + 浮动几何 + 交互预览）。 */
  shellSnapshot: () => ShellSnapshot;
  /** 应用布局（ui.set 的后续动作；由 L3 注入避免循环依赖）。 */
  applyLayout: () => void;
  /** 页面视口上报（docked DevTools 会让页面小于窗口）。 */
  setViewport: (size: { width: number; height: number }) => void;
  /** 存储与数据设置页视图（路径真相由 L3 装配持有）。 */
  storageInfo: () => StorageView;
  /** 插件设置变化（侧栏集合需要重算）。 */
  onSettingsChanged?: (pluginId: string) => void;
  /** 当前网页快照（提取 + 白名单归档）。 */
  browserCapture?: () => Promise<{
    url: string;
    title: string;
    markdown: string;
    ref: string | null;
  } | null>;
}

type SenderKind = 'workbench' | 'assistant' | 'overlay' | 'view' | 'unknown';

export function registerRouter(deps: RouterDeps): void {
  ipcMain.handle(
    CH_CMD,
    async (event: IpcMainInvokeEvent, command: string, params?: unknown) => {
      const kind = classifySender(event, deps);
      if (kind === 'unknown' || kind === 'view') {
        return err(
          'forbidden',
          `Command "${command}" is not allowed from this sender`,
        );
      }
      if (kind === 'assistant' && !isAssistantCommand(command)) {
        return err(
          'forbidden',
          `Command "${command}" is not allowed for the assistant view`,
        );
      }
      if (kind === 'overlay' && command !== 'ui.respond') {
        return err(
          'forbidden',
          `Command "${command}" is not allowed for the overlay view`,
        );
      }
      return invoke(deps, command, (params ?? {}) as Record<string, unknown>);
    },
  );

  ipcMain.handle(CH_SYNC, (): WorkSyncResult => {
    return {
      agent: deps.agent.getSnapshot(),
      seq: deps.agent.currentSeq,
      shell: deps.shellSnapshot(),
      views: deps.viewHost.list(),
      plugins: deps.registry.pluginInfoList(),
    };
  });

  // 插件页数据面：app:* 前缀（复用同一实现，映射见 invokeExt）。
  ipcMain.handle(
    CH_EXT,
    async (event: IpcMainInvokeEvent, command: string, params?: unknown) => {
      const kind = classifySender(event, deps);
      if (kind !== 'view')
        return err('forbidden', 'ws:ext is only available inside plugin views');
      return invokeExt(
        deps,
        command,
        (params ?? {}) as Record<string, unknown>,
      );
    },
  );

  // 指针交互会话。
  ipcMain.handle(
    CH_INTERACTION,
    (event: IpcMainInvokeEvent, action: string, payload?: unknown) => {
      const kind = classifySender(event, deps);
      if (kind !== 'workbench' && kind !== 'assistant') return { ok: false };
      if (action === 'begin') {
        deps.interaction.begin(payload as never);
        return { ok: true };
      }
      if (action === 'move') {
        deps.interaction.move();
        return { ok: true };
      }
      if (action === 'end') {
        deps.interaction.finish(false, 'initiator-end');
        return { ok: true };
      }
      if (action === 'cancel') {
        deps.interaction.finish(true, 'initiator-cancel');
        return { ok: true };
      }
      return { ok: false };
    },
  );
}

function classifySender(
  event: IpcMainInvokeEvent,
  deps: RouterDeps,
): SenderKind {
  const win = deps.getWindow();
  if (win && !win.isDestroyed() && event.sender === win.webContents)
    return 'workbench';
  const assistant = deps.viewHost.getWebContents('sys:assistant');
  if (assistant && event.sender === assistant) return 'assistant';
  const overlay = deps.viewHost.getWebContents('sys:overlay');
  if (overlay && event.sender === overlay) return 'overlay';
  return event.sender.isDestroyed() ? 'unknown' : 'view';
}

/** 助手视图命令白名单（最小能力面）。 */
function isAssistantCommand(command: string): boolean {
  return (
    command.startsWith('session.') ||
    command.startsWith('agent.') ||
    command.startsWith('ui.') ||
    command === 'skills.list' ||
    command === 'skills.setActive' ||
    command === 'plugins.list'
  );
}

// ─── ws:cmd 实现 ──────────────────────────────────────────

async function invoke(
  d: RouterDeps,
  command: string,
  p: Record<string, unknown>,
): Promise<CommandResponse> {
  try {
    switch (command) {
      // ═══ 会话域 ═══
      case 'session.prompt':
        await d.agent.prompt({
          text: String(p.text ?? ''),
          newSession: p.newSession === true,
          activeSkills: Array.isArray(p.activeSkills)
            ? (p.activeSkills as string[])
            : undefined,
        });
        return ok(null);
      case 'session.steer':
        await d.agent.steer(String(p.text ?? ''));
        return ok(null);
      case 'session.followUp':
        await d.agent.followUp(String(p.text ?? ''));
        return ok(null);
      case 'session.abort':
        await d.agent.abort();
        return ok(null);
      case 'session.clearQueue':
        d.agent.clearQueue();
        return ok(null);
      case 'session.new': {
        // 新任务态：集合不动，当前置空；pi 侧换一个空会话（首条消息才落盘）。
        d.uiState.set({ activePath: null });
        await d.agent.newSession();
        return ok(null);
      }
      case 'session.openTab': {
        const path = String(p.path ?? '');
        const ui = d.uiState.get();
        const openPaths = ui.openPaths.includes(path)
          ? ui.openPaths
          : [...ui.openPaths, path];
        d.uiState.set({ openPaths, activePath: path });
        return ok(await d.agent.switchSession(path));
      }
      case 'session.closeTab':
        return ok(await closeSessionTabs(d, [String(p.path ?? '')]));
      case 'session.closeTabs': {
        const paths = Array.isArray(p.paths)
          ? (p.paths as unknown[]).map(String)
          : [];
        return ok(await closeSessionTabs(d, paths));
      }
      case 'session.switch':
        return ok(await d.agent.switchSession(String(p.path ?? '')));
      case 'session.fork':
        return ok(
          await d.agent.fork(
            String(p.entryId ?? ''),
            p.position === 'before' || p.position === 'at'
              ? p.position
              : undefined,
          ),
        );
      case 'session.list':
        return ok(await d.agent.listSessions());
      case 'session.delete': {
        const path = String(p.path ?? '');
        await d.agent.deleteSession(path);
        // 删除后同步收缩打开集合（否则留下指向已删文件的幽灵标签）
        await closeSessionTabs(d, [path]);
        return ok(null);
      }
      case 'session.rename':
        d.agent.renameSession(String(p.path ?? ''), String(p.name ?? ''));
        return ok(null);
      case 'session.getMessages':
        return ok(
          await d.agent.getMessages(p.path ? String(p.path) : undefined),
        );
      case 'session.compact':
        await d.agent.compact(
          p.instructions ? String(p.instructions) : undefined,
        );
        return ok(null);
      case 'session.setSteeringMode':
        d.agent.setSteeringMode(
          p.mode === 'one-at-a-time' ? 'one-at-a-time' : 'all',
        );
        return ok(null);
      case 'session.setFollowUpMode':
        d.agent.setFollowUpMode(
          p.mode === 'one-at-a-time' ? 'one-at-a-time' : 'all',
        );
        return ok(null);
      case 'session.setAutoCompaction':
        d.agent.setAutoCompaction(p.enabled === true);
        return ok(null);
      case 'session.getCommands':
        return ok(d.agent.getCommands());

      // ═══ Agent 配置域 ═══
      case 'agent.status':
        return ok(d.agent.getSnapshot());
      case 'agent.models':
        return ok(d.agent.getModels());
      case 'agent.setModel':
        await d.agent.setModel(
          String(p.provider ?? ''),
          String(p.modelId ?? ''),
        );
        return ok(d.agent.getSnapshot());
      case 'agent.setThinking':
        d.agent.setThinkingLevel(String(p.level ?? ''));
        return ok(d.agent.getSnapshot());
      case 'agent.cycleThinking':
        return ok({ level: d.agent.cycleThinkingLevel() ?? null });
      case 'agent.thinkingLevels':
        return ok(d.agent.session.getAvailableThinkingLevels());
      case 'agent.configure':
        return ok(await d.agent.configure(p as never));
      case 'agent.clearRuntimeKey':
        await d.agent.clearRuntimeKey(String(p.provider ?? ''));
        return ok(null);
      case 'agent.setWorkspace':
        return ok(await d.agent.setWorkspace(String(p.path ?? '')));
      case 'agent.pickWorkspace': {
        const win = d.getWindow();
        const result = await dialog.showOpenDialog(
          (win ?? undefined) as never,
          {
            properties: ['openDirectory'],
          },
        );
        return ok(result.canceled ? null : (result.filePaths[0] ?? null));
      }
      case 'agent.workspaces': {
        const current = d.agent.getWorkspacePath();
        const list: WorkspaceInfo[] = listWorkspaces().map((m) => ({
          path: m.path,
          name: workspaceLabel(m.path),
          wsId: getWorkspaceId(m.path),
          createdAt: m.createdAt,
          lastOpenedAt: m.lastOpenedAt,
          current: m.path === current,
          exists: existsSync(m.path),
        }));
        return ok(list);
      }

      // ═══ 模型目录域 ═══
      case 'config.models.read':
        return ok(d.modelConfig.readView());
      case 'config.models.providers':
        return ok(
          d.agent.getProviderCatalog(
            Object.keys(d.modelConfig.readView().providers),
          ),
        );
      case 'config.models.catalog':
        return ok(d.agent.getModelCatalog());
      case 'config.models.login':
        await d.agent.loginProvider({
          providerId: String(p.providerId ?? ''),
          type: p.type === 'oauth' ? 'oauth' : 'api_key',
          ...(typeof p.apiKey === 'string' && p.apiKey
            ? { apiKey: p.apiKey }
            : {}),
        });
        return ok(d.agent.getSnapshot());
      case 'config.models.logout':
        await d.agent.logoutProvider(String(p.providerId ?? ''));
        return ok(d.agent.getSnapshot());
      case 'config.models.saveProvider':
        await d.modelConfig.saveProvider(
          String(p.providerId ?? ''),
          p.config as never,
        );
        await d.agent.rebuildForModelChange();
        return ok(d.agent.getSnapshot());
      case 'config.models.deleteProvider':
        await d.modelConfig.deleteProvider(String(p.providerId ?? ''));
        await d.agent.rebuildForModelChange();
        return ok(d.agent.getSnapshot());
      case 'config.models.saveModel':
        await d.modelConfig.saveModel(
          String(p.providerId ?? ''),
          p.model as never,
        );
        await d.agent.rebuildForModelChange();
        return ok(d.agent.getSnapshot());
      case 'config.models.deleteModel':
        await d.modelConfig.deleteModel(
          String(p.providerId ?? ''),
          String(p.modelId ?? ''),
        );
        await d.agent.rebuildForModelChange();
        return ok(d.agent.getSnapshot());

      // ═══ Pi 包域（社区目录 / 安装 / 卸载） ═══
      case 'config.packages.catalog':
        return ok(
          await d.packages.searchCatalog({
            ...(typeof p.query === 'string' ? { query: p.query } : {}),
            ...(typeof p.type === 'string' ? { type: p.type } : {}),
            page: Number(p.page ?? 1) || 1,
          }),
        );
      case 'config.packages.list':
        return ok(d.packages.listConfigured());
      case 'config.packages.loaded':
        return ok(d.agent.getLoadedResources());
      case 'config.packages.install':
        await d.packages.install(String(p.name ?? ''));
        return ok(d.packages.listConfigured());
      case 'config.packages.remove':
        return ok(
          await d.packages.remove(
            String(p.source ?? ''),
            p.scope === 'project' ? 'project' : 'user',
          ),
        );

      // ═══ 设置域 ═══
      case 'config.settings.view':
        return ok(d.getSettingsService().view());
      case 'config.settings.setGlobal': {
        const result = d
          .getSettingsService()
          .setGlobal(String(p.path ?? ''), p.value);
        // sessionDir 变更 → 立刻以新目录重建会话域（重启前即生效）。
        if (p.path === 'sessionDir') await d.agent.rebuildForWorkspace();
        return ok(result);
      }
      case 'config.settings.setProject':
        return ok(
          d.getSettingsService().setProject(String(p.path ?? ''), p.value),
        );
      case 'config.settings.reload':
        return ok(d.getSettingsService().reload());

      // ═══ 存储与数据 ═══
      case 'config.storage.view':
        return ok(d.storageInfo());
      case 'config.storage.open': {
        const target = String(p.path ?? '');
        const message = await shell.openPath(target);
        return ok(message || null);
      }

      // ═══ URA（资源管道） ═══
      case 'ura.read': {
        const as =
          p.as === 'editor' || p.as === 'system' ? p.as : 'agent';
        return ok(
          await d.ura.read(String(p.ref ?? ''), {
            as,
            ...(typeof p.docTypeHint === 'string'
              ? { docTypeHint: p.docTypeHint as never }
              : {}),
          }),
        );
      }
      case 'ura.write':
        return ok(
          await d.ura.write(String(p.ref ?? ''), String(p.content ?? ''), {
            ...(typeof p.expectedVersion === 'string'
              ? { expectedVersion: p.expectedVersion }
              : {}),
          }),
        );
      case 'ura.edit':
        return ok(
          await d.ura.edit(
            String(p.ref ?? ''),
            (p.anchor ?? { start: 0, end: 0 }) as never,
            String(p.content ?? ''),
          ),
        );
      case 'ura.ls':
        return ok(await d.ura.ls(String(p.ref ?? '')));
      case 'ura.find':
        return ok(
          await d.ura.find(String(p.pattern ?? '*'), {
            scope:
              typeof p.scope === 'string' && p.scope
                ? p.scope
                : `file://${getCurrentWorkspace()}`,
            ...(typeof p.limit === 'number' ? { limit: p.limit } : {}),
          }),
        );
      case 'ura.grep':
        return ok(
          await d.ura.grep(String(p.pattern ?? ''), {
            scope:
              typeof p.scope === 'string' && p.scope
                ? p.scope
                : `file://${getCurrentWorkspace()}`,
            ...(typeof p.ignoreCase === 'boolean'
              ? { ignoreCase: p.ignoreCase }
              : {}),
            ...(typeof p.limit === 'number' ? { limit: p.limit } : {}),
          }),
        );
      case 'ura.query':
        return ok(
          await d.ura.query(
            String(p.ref ?? ''),
            (p.query ?? {}) as never,
          ),
        );

      case 'plugin.settings.get':
        return ok(
          await d.registry.getSetting(
            String(p.pluginId ?? ''),
            String(p.key ?? ''),
            p.fallback,
          ),
        );
      case 'plugin.settings.set': {
        const pluginId = String(p.pluginId ?? '');
        const result = await d.registry.setSetting(
          pluginId,
          String(p.key ?? ''),
          p.value,
        );
        d.onSettingsChanged?.(pluginId);
        return ok(result);
      }

      case 'ura.registry':
        return ok({
          ...uraRegistry.snapshot(),
          diagnostics: uraRegistry.diagnostics(),
        });

      case 'ura.workspace':
        return ok({ root: `file://${getCurrentWorkspace()}` });

      case 'ura.collections':
        return ok(await d.collections.list());

      case 'ura.tree': {
        const root =
          typeof p.ref === 'string' && p.ref
            ? p.ref
            : `file://${getCurrentWorkspace()}`;
        return ok(await d.ura.tree(root));
      }

      case 'ura.page.get':
        return ok(d.pageSessions.get(String(p.id ?? '')));
      case 'ura.page.open':
        return ok(await d.pageSessions.open(String(p.ref ?? '')));
      case 'ura.page.save':
        return ok(
          await d.pageSessions.save(
            String(p.id ?? ''),
            String(p.content ?? ''),
          ),
        );
      case 'ura.page.reload':
        return ok(await d.pageSessions.reload(String(p.id ?? '')));
      case 'ura.page.close':
        d.pageSessions.close(String(p.id ?? ''));
        return ok(null);

      case 'ura.session.open':
        return ok(await d.writeSessions.open(String(p.ref ?? '')));
      case 'ura.session.stage':
        return ok(
          d.writeSessions.stage(String(p.id ?? ''), p.change as never),
        );
      case 'ura.session.commit':
        return ok(await d.writeSessions.commit(String(p.id ?? '')));
      case 'ura.session.abort':
        d.writeSessions.abort(String(p.id ?? ''));
        return ok(null);

      // ═══ 插件 / 技能 ═══
      case 'plugins.list':
        return ok(d.registry.pluginInfoList());
      case 'skills.list':
        return ok(d.skills.getSkillInfos());
      case 'skills.view':
        return ok({
          skills: d.skills.getSkillInfos(),
          diagnostics: d.skills.getDiagnostics(),
          active: [...d.uiState.get().selectedSkills],
        });
      case 'skills.reload':
        await d.agent.reloadResources();
        return ok({
          skills: d.skills.getSkillInfos(),
          diagnostics: d.skills.getDiagnostics(),
          active: [...d.uiState.get().selectedSkills],
        });
      case 'skills.setActive':
        d.skills.setActive(Array.isArray(p.names) ? (p.names as string[]) : []);
        return ok(null);

      // ═══ 视图集合 ═══
      case 'views.list':
        return ok(d.viewHost.list());
      case 'views.open':
        return ok(d.viewHost.open(p.input as never));
      case 'views.openResource':
        return ok(
          await d.viewHost.openResource(
            String(p.ref ?? ''),
            p.document as never,
          ),
        );
      case 'views.runAction':
        return ok(
          d.viewHost.runAction(
            String(p.id ?? ''),
            String(p.action ?? ''),
          ),
        );
      case 'views.openBrowser': {
        const url = String(p.url ?? '');
        const allowlist = await d.registry.getSetting<string[]>(
          'browser',
          'allowlist',
          [],
        );
        return ok(
          d.viewHost.open({
            kind: 'browser',
            url,
            temporary: !onAllowlist(url, allowlist),
          }),
        );
      }
      case 'browser.snapshot': {
        const result = (await d.browserCapture?.()) ?? null;
        if (result?.ref) d.onSettingsChanged?.('browser');
        return ok(result);
      }
      case 'views.activate':
        d.viewHost.activate(String(p.id ?? ''));
        return ok(null);
      case 'views.close':
        d.viewHost.close(String(p.id ?? ''));
        return ok(null);
      case 'views.closeOthers':
        d.viewHost.closeOthers(String(p.id ?? ''));
        return ok(null);
      case 'views.closeToLeft':
        d.viewHost.closeToLeft(String(p.id ?? ''));
        return ok(null);
      case 'views.closeToRight':
        d.viewHost.closeToRight(String(p.id ?? ''));
        return ok(null);
      case 'views.closeAll':
        d.viewHost.closeAll();
        return ok(null);
      case 'views.togglePin':
        d.viewHost.togglePin(String(p.id ?? ''));
        return ok(null);
      case 'views.move':
        d.viewHost.move(String(p.fromId ?? ''), String(p.toId ?? ''));
        return ok(null);
      case 'views.reload':
        d.viewHost.reload(String(p.id ?? ''));
        return ok(null);
      case 'views.navigate':
        d.viewHost.navigate(String(p.id ?? ''), String(p.url ?? ''));
        return ok(null);
      case 'views.goBack':
        d.viewHost.goBack(String(p.id ?? ''));
        return ok(null);
      case 'views.goForward':
        d.viewHost.goForward(String(p.id ?? ''));
        return ok(null);
      case 'views.setInteractiveElements':
        return ok(
          d.viewHost.setInteractiveElements(String(p.id ?? ''), p.on === true),
        );
      case 'views.action':
        d.viewHost.sendAction(
          String(p.id ?? ''),
          String(p.action ?? ''),
          p.payload,
        );
        return ok(null);

      // ═══ 调试（DevTools 一律 detach：dock 会被原生视图盖住） ═══
      case 'debug.devtools': {
        // 浏览器语义：右侧停靠 DevTools（页面随之收缩，原生视图按上报视口让位）。
        const win = d.getWindow();
        const wc = win?.webContents;
        if (!wc || wc.isDestroyed()) return ok(null);
        if (wc.isDevToolsOpened()) wc.closeDevTools();
        else wc.openDevTools({ mode: 'right' });
        return ok(null);
      }
      case 'debug.viewport': {
        // 渲染层上报页面视口（docked DevTools 会把页面变小）：布局按视口收缩。
        d.setViewport({
          width: Number(p.width ?? 0),
          height: Number(p.height ?? 0),
        });
        return ok(null);
      }

      // ═══ UI 状态 / 扩展 UI ═══
      case 'ui.get':
        return ok(d.uiState.get());
      case 'ui.set': {
        const patch = { ...((p.patch ?? {}) as Record<string, unknown>) };
        // 不变量：openPaths 必须指向真实存在的会话文件（任何调用方都不得写入幽灵标签）。
        if (Array.isArray(patch['openPaths'])) {
          const openPaths = (patch['openPaths'] as unknown[])
            .map(String)
            .filter((x) => existsSync(x));
          patch['openPaths'] = openPaths;
          const active = patch['activePath']
            ? String(patch['activePath'])
            : undefined;
          if (active !== undefined && !openPaths.includes(active)) {
            patch['activePath'] = openPaths[0] ?? null;
          }
        }
        d.uiState.set(patch as never);
        return ok(d.uiState.get());
      }
      case 'ui.respond':
        d.agent.handleDialogResponse(p.response as never);
        return ok(null);

      default:
        return err('unknown_command', `Unknown command: ${command}`);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log.warn('command failed', command, message);
    return err('command_failed', message);
  }
}

/** 关闭会话标签：集合语义留在主进程（激活项选右邻、无则左邻、都没有 → 新任务态）。 */
async function closeSessionTabs(d: RouterDeps, paths: string[]): Promise<null> {
  const closed = new Set(paths);
  const ui = d.uiState.get();
  const order = ui.openPaths;
  const openPaths = order.filter((x) => !closed.has(x));
  let activePath = ui.activePath;
  if (activePath && closed.has(activePath)) {
    activePath = pickNeighbor(order, activePath, closed);
  }
  d.uiState.set({ openPaths, activePath });
  if (activePath === null) {
    await d.agent.newSession();
  } else if (activePath !== ui.activePath) {
    await d.agent.switchSession(activePath);
  }
  return null;
}

function pickNeighbor(
  order: string[],
  active: string,
  closed: Set<string>,
): string | null {
  const idx = order.indexOf(active);
  for (let i = idx + 1; i < order.length; i++)
    if (!closed.has(order[i])) return order[i];
  for (let i = idx - 1; i >= 0; i--) if (!closed.has(order[i])) return order[i];
  return null;
}

// ─── ws:ext（插件页数据面） ────────────────────────────────

async function invokeExt(
  d: RouterDeps,
  command: string,
  params: Record<string, unknown>,
): Promise<CommandResponse> {
  // app:<domain>.<action> → 同一实现（映射保持显式，避免命名漂移）。
  const map: Record<string, string> = {
    'app:agent.status': 'agent.status',
    'app:agent.models': 'agent.models',
    'app:agent.configure': 'agent.configure',
    'app:agent.setModel': 'agent.setModel',
    'app:agent.setThinking': 'agent.setThinking',
    'app:agent.thinkingLevels': 'agent.thinkingLevels',
    'app:agent.clearRuntimeKey': 'agent.clearRuntimeKey',
    // 会话管理插件页
    'app:session.list': 'session.list',
    'app:session.new': 'session.new',
    'app:ui.get': 'ui.get',
    'app:session.openTab': 'session.openTab',
    'app:session.delete': 'session.delete',
    'app:session.rename': 'session.rename',
    'app:session.abort': 'session.abort',
    'app:session.getMessages': 'session.getMessages',
    // 工作区插件页
    'app:workspaces.list': 'agent.workspaces',
    'app:workspaces.switch': 'agent.setWorkspace',
    'app:workspaces.pick': 'agent.pickWorkspace',
    // 存储与数据插件页
    'app:storage.view': 'config.storage.view',
    'app:storage.open': 'config.storage.open',
    // 资源索引插件页（在资源面板打开文档）
    'app:packages.catalog': 'config.packages.catalog',
    'app:packages.list': 'config.packages.list',
    'app:packages.loaded': 'config.packages.loaded',
    'app:packages.install': 'config.packages.install',
    'app:packages.remove': 'config.packages.remove',
    'app:models.read': 'config.models.read',
    'app:models.providers': 'config.models.providers',
    'app:models.catalog': 'config.models.catalog',
    'app:models.login': 'config.models.login',
    'app:models.logout': 'config.models.logout',
    'app:models.saveProvider': 'config.models.saveProvider',
    'app:models.deleteProvider': 'config.models.deleteProvider',
    'app:models.saveModel': 'config.models.saveModel',
    'app:models.deleteModel': 'config.models.deleteModel',
    'app:settings.view': 'config.settings.view',
    'app:settings.setGlobal': 'config.settings.setGlobal',
    'app:settings.setProject': 'config.settings.setProject',
    'app:settings.reload': 'config.settings.reload',
    'app:ura.registry': 'ura.registry',
    'app:ura.workspace': 'ura.workspace',
    'app:ura.collections': 'ura.collections',
    'app:ura.tree': 'ura.tree',
    'app:plugin.settings.get': 'plugin.settings.get',
    'app:plugin.settings.set': 'plugin.settings.set',
    'app:views.openResource': 'views.openResource',
    'app:views.openBrowser': 'views.openBrowser',
    'app:browser.snapshot': 'browser.snapshot',
    'app:ura.page.get': 'ura.page.get',
    'app:ura.page.open': 'ura.page.open',
    'app:ura.page.save': 'ura.page.save',
    'app:ura.page.reload': 'ura.page.reload',
    'app:ura.page.close': 'ura.page.close',
    'app:plugins.list': 'plugins.list',
    'app:skills.list': 'skills.list',
    'app:skills.view': 'skills.view',
    'app:skills.reload': 'skills.reload',
  };
  const mapped = map[command];
  if (!mapped)
    return err('unknown_command', `Unknown extension command: ${command}`);
  return invoke(d, mapped, params);
}

// ─── 信封 ─────────────────────────────────────────────────

function onAllowlist(url: string, allowlist: string[]): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return allowlist.some((entry) => {
      const normalized = entry.trim().toLowerCase().replace(/^\./, '');
      return (
        !!normalized &&
        (host === normalized || host.endsWith(`.${normalized}`))
      );
    });
  } catch {
    return false;
  }
}

function ok<T>(data: T): CommandResponse<T> {
  return { ok: true, data };
}

function err(code: string, message: string): CommandResponse<never> {
  return { ok: false, error: { code, message } };
}
