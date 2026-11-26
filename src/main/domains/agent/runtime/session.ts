/**
 * 单工作区 agent 装配：一个 cwd、一套 pi services、一个 session。
 *
 * 与旧版的差异：不再装载 URA 工具/资源地图；工具面后续经新 ToolSurface 注入。
 */

import { pathToFileURL } from 'node:url';
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  type AgentSessionServices,
  type AgentSession as PiAgentSession,
  type AgentSessionRuntimeDiagnostic,
  type SessionManager,
  type SettingsManager,
} from '@earendil-works/pi-coding-agent';
import { composeExtensionFactories } from './harness/builtin-extensions.ts';
import { SYSTEM_PROMPT } from './harness/prompts.ts';
import type {
  InlineExtension,
  ModelRuntime,
} from '@earendil-works/pi-coding-agent';
import type { ResourceRoot } from '../../../transport/resource.ts';
import type { SkillsManager } from './harness/skills.ts';

/** 会话上下文里的资源地图文件名；虚拟文件，不落盘。 */
const RESOURCE_MAP_FILE = 'AGENTS.md';

/**
 * 生成资源地图：固定列出当前工作区文件根，再逐个列出已登记适配器的
 * 自述。只含 scheme、结构与示例；不含账号、正文或本地路径。
 */
export function renderResourceMap(
  cwd: string,
  roots: readonly ResourceRoot[],
): string {
  const lines = [
    '# Workspace map',
    '',
    'Resource addresses are ids of the form scheme://authority/path.',
    'Use `ls` to discover entries, `read` to fetch content, `grep` to search within a scope.',
    '',
    '## Roots',
    '',
    `- ${pathToFileURL(cwd).toString()} — Workspace files (ls / read / grep)`,
  ];
  for (const root of roots) {
    // 工作区文件根已由首行给出，跳过适配器对 file:// 的兜底声明。
    if (root.root === 'file://') continue;
    lines.push(`- ${root.root} — ${root.label}；${root.summary}`);
    for (const example of root.examples ?? []) {
      lines.push(`  - e.g. ${example}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

type ExtensionsResult = Awaited<
  ReturnType<typeof createAgentSessionFromServices>
>['extensionsResult'];

export interface AgentSessionInput {
  cwd: string;
  workspaceId: string;
  agentDir: string;
  modelRuntime?: ModelRuntime;
  sessionManager: SessionManager;
  settingsManager: SettingsManager;
  skills: SkillsManager;
  extensionFactories?: InlineExtension[];
  additionalSkillPaths?: string[];
  /** 已登记适配器的资源根；会话创建时生成资源地图。 */
  resourceRoots?: readonly ResourceRoot[];
  skillOwner?: (source: string) => { id: string; label: string } | null;
  openExternal?: (url: string) => void | Promise<void>;
}

export class AgentSession {
  private constructor(
    readonly cwd: string,
    readonly workspaceId: string,
    readonly piSession: PiAgentSession,
    readonly services: AgentSessionServices,
    readonly extensionsResult: ExtensionsResult,
    readonly diagnostics: AgentSessionRuntimeDiagnostic[],
  ) {}

  static async assemble(input: AgentSessionInput): Promise<AgentSession> {
    const services = await createAgentSessionServices({
      cwd: input.cwd,
      agentDir: input.agentDir,
      ...(input.modelRuntime ? { modelRuntime: input.modelRuntime } : {}),
      settingsManager: input.settingsManager,
      resourceLoaderOptions: {
        extensionFactories: composeExtensionFactories(
          input.extensionFactories ?? [],
          { openUrl: input.openExternal },
        ),
        systemPrompt: SYSTEM_PROMPT,
        additionalSkillPaths: input.additionalSkillPaths ?? [],
        skillsOverride: (base) => {
          input.skills.registerLoaded(
            base.skills,
            base.diagnostics,
            input.skillOwner ?? (() => null),
          );
          return input.skills.filterSkills(base.skills, base.diagnostics);
        },
        appendSystemPromptOverride: (base) =>
          input.skills.filterAppendSystemPrompt(base),
        agentsFilesOverride: () => ({
          agentsFiles: [
            {
              path: RESOURCE_MAP_FILE,
              content: renderResourceMap(input.cwd, input.resourceRoots ?? []),
            },
          ],
        }),
      },
    });

    const created = await createAgentSessionFromServices({
      services,
      sessionManager: input.sessionManager,
      noTools: 'builtin',
    });

    const diagnostics: AgentSessionRuntimeDiagnostic[] = [
      ...services.diagnostics,
      ...services.resourceLoader
        .getExtensions()
        .errors.map(({ path, error }) => ({
          type: 'error' as const,
          message: `Failed to load extension "${path}": ${error}`,
        })),
    ];

    return new AgentSession(
      input.cwd,
      input.workspaceId,
      created.session,
      services,
      created.extensionsResult,
      diagnostics,
    );
  }
}
