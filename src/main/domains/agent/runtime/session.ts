/**
 * 单工作区 agent 装配：一个 cwd、一套 pi services、一个 session。
 *
 * 与旧版的差异：不再装载 URA 工具/资源地图；工具面后续经新 ToolSurface 注入。
 */

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
import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import type { SkillsManager } from './harness/skills.ts';

type ExtensionsResult = Awaited<
  ReturnType<typeof createAgentSessionFromServices>
>['extensionsResult'];

export interface AgentSessionInput {
  cwd: string;
  workspaceId: string;
  agentDir: string;
  sessionManager: SessionManager;
  settingsManager: SettingsManager;
  skills: SkillsManager;
  extensionFactories?: InlineExtension[];
  additionalSkillPaths?: string[];
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
        agentsFilesOverride: () => ({ agentsFiles: [] }),
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
