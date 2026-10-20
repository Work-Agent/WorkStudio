/**
 * HarnessExtension —— 业务能力的 pi 扩展形态（InlineExtension）。
 *
 * 工具经 pi.registerTool 官方语义注册；资源管理型工具是 URA 门面的薄封装，
 * 操作型工具（浏览器族）走各自契约。插件不注册工具。
 */
import type { InlineExtension } from '@earendil-works/pi-coding-agent'
import type { Ura } from '../ura/facade'
import type { PluginHost } from '../plugins/host'
import type { BrowserAutomationContract } from './browser-contract'
import { SiteSnapshots } from './browser-snapshots'
import { createBrowserTools } from './browser-tools'
import { createUraTools } from './ura-tools'

export interface HarnessBusinessDeps {
  ura: Ura
  plugins: PluginHost
  workspace: () => string
  /** 浏览器自动化（懒取：raw 视图在 ViewHost 就绪后才可用）。 */
  getBrowserAutomation(): BrowserAutomationContract | null
}

export function createHarnessExtension(
  deps: HarnessBusinessDeps,
): InlineExtension {
  return (pi) => {
    const browserAutomation = deps.getBrowserAutomation()
    const tools = [
      ...createUraTools(deps.ura),
      ...(browserAutomation ? createBrowserTools(browserAutomation) : []),
    ]
    for (const tool of tools) {
      pi.registerTool(tool as never)
    }
  }
}
