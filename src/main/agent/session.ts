// ─── AgentSession ────────────────────────────────────────────────────
//
// 域服务的基本单位：一个工作区、一次装配、一套会话上下文。
// 工具的地址、AGENTS.md 与资源地图全部经 URA 取得，不旁路读文件。
// 会话换代 = 重新 assemble：注册表是应用级的，装配只重建会话侧对象。

import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  type AgentSessionServices,
  type AgentSession as PiAgentSession,
  type AgentSessionRuntimeDiagnostic,
  type SessionManager,
  type SettingsManager,
} from '@earendil-works/pi-coding-agent'
import type { BrowserAutomationContract } from '../harness/browser-contract'
import { composeExtensionFactories } from '../harness/builtin-extensions'
import { createHarnessExtension } from '../harness/harness-extension'
import { SYSTEM_PROMPT } from '../harness/prompts'
import type { SkillsManager } from '../harness/skills'
import type { PluginHost } from '../plugins/host'
import type { Ura } from '../ura/facade'
import { uraRegistry } from '../ura/registry'

type ExtensionsResult = Awaited<
  ReturnType<typeof createAgentSessionFromServices>
>['extensionsResult']

export interface AgentSessionDeps {
  ura: Ura
  skills: SkillsManager
  registry: PluginHost
  getBrowserAutomation: () => BrowserAutomationContract | null
  openExternal?: (url: string) => void | Promise<void>
}

export interface AgentSessionInput {
  cwd: string
  workspaceId: string
  agentDir: string
  sessionManager: SessionManager
  settingsManager: SettingsManager
  deps: AgentSessionDeps
}

interface SessionContext {
  /** 工作区 AGENTS.md（经 URA 读取）。 */
  agentsText: string | null
  agentsPath: string
  /** 资源地图（经 URA 发现）。 */
  map: string
  mapPath: string
}

export class AgentSession {
  private constructor(
    readonly cwd: string,
    readonly workspaceId: string,
    readonly piSession: PiAgentSession,
    readonly services: AgentSessionServices,
    readonly extensionsResult: ExtensionsResult,
    readonly diagnostics: AgentSessionRuntimeDiagnostic[],
    readonly context: SessionContext,
  ) {}

  static async assemble(input: AgentSessionInput): Promise<AgentSession> {
    const context = await collectContext(input.cwd, input.deps.ura)
    const harness = createHarnessExtension({
      ura: input.deps.ura,
      plugins: input.deps.registry,
      workspace: () => input.cwd,
      getBrowserAutomation: input.deps.getBrowserAutomation,
    })

    const services = await createAgentSessionServices({
      cwd: input.cwd,
      agentDir: input.agentDir,
      settingsManager: input.settingsManager,
      resourceLoaderOptions: {
        extensionFactories: composeExtensionFactories([harness], {
          openUrl: input.deps.openExternal,
        }),
        systemPrompt: buildSystemPrompt(),
        additionalSkillPaths: input.deps.registry.getSkillPaths(),
        additionalExtensionPaths: input.deps.registry.getPiExtensionPaths(),
        skillsOverride: (base) => {
          input.deps.skills.registerLoaded(
            base.skills,
            base.diagnostics,
            (source) => input.deps.registry.pluginNameOf(source),
          )
          return input.deps.skills.filterSkills(base.skills, base.diagnostics)
        },
        appendSystemPromptOverride: (base) =>
          input.deps.skills.filterAppendSystemPrompt(base),
        agentsFilesOverride: () => ({
          agentsFiles: [
            ...(context.agentsText
              ? [{ path: context.agentsPath, content: context.agentsText }]
              : []),
            { path: context.mapPath, content: context.map },
          ],
        }),
      },
    })

    const created = await createAgentSessionFromServices({
      services,
      sessionManager: input.sessionManager,
      noTools: 'builtin',
    })

    const diagnostics: AgentSessionRuntimeDiagnostic[] = [
      ...services.diagnostics,
      ...services.resourceLoader.getExtensions().errors.map(({ path, error }) => ({
        type: 'error' as const,
        message: `Failed to load extension "${path}": ${error}`,
      })),
    ]

    return new AgentSession(
      input.cwd,
      input.workspaceId,
      created.session,
      services,
      created.extensionsResult,
      diagnostics,
      context,
    )
  }
}

// ─── 上下文（全部经 URA） ─────────────────────────────────────────────

async function collectContext(cwd: string, ura: Ura): Promise<SessionContext> {
  const root = `file://${cwd.replace(/\/$/, '')}`
  const agentsRef = `${root}/AGENTS.md`
  const agentsText = await ura
    .read(agentsRef, { as: 'agent' })
    .then((opened) =>
      opened.projection.kind === 'text' ? opened.projection.content : null,
    )
    .catch(() => null)

  const entries = await ura.find('*', { scope: root, limit: 200 }).catch(() => [])
  const lines = [
    '# WorkStudio Resource Map',
    '',
    '本文件由 WorkStudio 自动生成；地址是资源 id，可直接用于 read / edit / write / ls / find / grep。',
    '',
    '| 资源 | 类型 |',
    '|------|------|',
  ]
  for (const entry of entries) {
    lines.push(`| ${entry.ref} | ${entry.kind === 'dir' ? '目录' : '文件'} |`)
  }
  if (entries.length === 0) lines.push('| （空工作区） | — |')

  return {
    agentsText,
    agentsPath: `${cwd}/AGENTS.md`,
    map: lines.join('\n'),
    mapPath: `${cwd}/WORKSTUDIO_RESOURCE_MAP.md`,
  }
}

function buildSystemPrompt(): string {
  const stores = uraRegistry.schemas()
  if (stores.length === 0) return SYSTEM_PROMPT
  const list = stores.map((s) => `- ${s.docType}`).join('\n')
  return `${SYSTEM_PROMPT}

## Data objects（schema-only，query 查询结构）

${list}`
}
