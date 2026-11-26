/**
 * Browser 模块：系统能力 + web 域（生命周期 + 依赖）。
 *
 * 导航策略、自动化、指针采集与网页快照缓存同属一个生命周期；
 * 工具面只在有网页视图时使用这里的自动化能力。
 */

import type { TransportRouter } from '../../transport/router.ts';
import type { WebCache } from '../../transport/web-cache.ts';
import type { DomainModule } from '../../registry/module.ts';
import type { DomainRegistry } from '../../registry/registry.ts';
import type { StorageLayout } from '../../platform/paths.ts';
import { session } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readUserPreferences,
  readWorkspacePolicy,
  writeWorkspacePolicy,
} from '../../platform/preferences.ts';
import { BrowserCapability } from './capability.ts';
import {
  createAutomationStates,
  createCaptureStates,
  createPolicyState,
  defineAutomationResources,
  defineTabsResources,
  defineCaptureResources,
  definePolicyResource,
  defineWebResource,
  registerWebAdapter,
  unregisterWebAdapter,
  type AutomationStates,
  type CaptureStates,
  type PolicyState,
} from './domains.ts';

export class BrowserModule implements DomainModule {
  readonly id = 'browser';
  readonly dependencies = ['shell', 'workspace'] as const;

  private readonly policy: PolicyState = createPolicyState();
  private readonly automation: AutomationStates = createAutomationStates();
  private readonly capture: CaptureStates = createCaptureStates();
  private readonly windowResources = new Set<string>();
  private tabResources: {
    ensure: (id: string) => void;
    remove: (id: string) => void;
  } | null = null;
  private automationResources: {
    ensure: (id: string) => void;
    remove: (id: string) => void;
  } | null = null;
  private captureResources: {
    ensure: (id: string) => void;
    remove: (id: string) => void;
  } | null = null;
  private registry: DomainRegistry | null = null;
  private offWorkspace: (() => void) | null = null;
  private offWindows: (() => void) | null = null;
  private offPreferences: (() => void) | null = null;
  private appliedProxy: string | null = null;

  constructor(
    readonly capability: BrowserCapability,
    private readonly transport: TransportRouter,
    private readonly cache: WebCache,
    private readonly layout?: StorageLayout,
  ) {}

  attach(registry: DomainRegistry): void {
    this.registry = registry;
    this.tabResources = defineTabsResources(registry, this.capability);
    definePolicyResource(registry, this.policy);
    this.automationResources = defineAutomationResources(
      registry,
      this.automation,
      this.capability,
    );
    this.captureResources = defineCaptureResources(registry, this.capture);
    defineWebResource(registry, this.cache, this.capability, (url, ref) =>
      this.saveSnapshot(url, ref),
    );
  }

  start(): void {
    registerWebAdapter(this.transport, this.cache);
    const registry = this.registry;
    if (registry) {
      this.loadPolicy();
      if (this.layout) {
        this.applyProxy(readUserPreferences(this.layout).proxy);
      }
      this.offWorkspace = registry.onUpdate((update) => {
        if (
          update.domain === 'workspace' &&
          update.resource === 'registry' &&
          update.type === 'snapshot'
        ) {
          this.loadPolicy();
        }
      });
      // 标签 / 自动化 / 采集按窗口资源化，跟随窗口生命周期。
      this.offWindows = registry.onUpdate((update) => {
        if (
          update.domain !== 'shell' ||
          update.resource !== 'windows' ||
          update.type !== 'snapshot'
        ) {
          return;
        }
        this.syncWindows(
          (update.data as { windows?: Array<{ id: string }> }).windows ?? [],
        );
      });
      const windows = registry.snapshot({
        domain: 'shell',
        resource: 'windows',
      }) as { windows?: Array<{ id: string }> } | null;
      this.syncWindows(windows?.windows ?? []);
      // 代理改动立即对内置浏览器生效（登录授权页、网页标签同会话）。
      this.offPreferences = registry.onUpdate((update) => {
        if (update.domain !== 'settings' || update.resource !== 'preferences') {
          return;
        }
        const proxy = (update.data as { proxy?: string | null } | null)?.proxy;
        this.applyProxy(typeof proxy === 'string' ? proxy : null);
      });
    }
  }

  /** 内置浏览器跟随全局代理偏好；未配置时用系统代理。 */
  private applyProxy(value: string | null): void {
    if (!this.layout) return;
    const proxy = value?.trim() ? value.trim() : null;
    if (proxy === this.appliedProxy) return;
    this.appliedProxy = proxy;
    void session.defaultSession
      .setProxy(proxy ? { proxyRules: proxy } : { mode: 'system' })
      .catch((error: unknown) => {
        console.warn('[browser] 代理设置失败', proxy, error);
      });
  }

  stop(): void {
    this.offWorkspace?.();
    this.offWorkspace = null;
    this.offWindows?.();
    this.offWindows = null;
    this.offPreferences?.();
    this.offPreferences = null;
    this.appliedProxy = null;
    unregisterWebAdapter(this.transport);
    for (const windowId of Array.from(this.windowResources)) {
      this.tabResources?.remove(windowId);
      this.automationResources?.remove(windowId);
      this.captureResources?.remove(windowId);
    }
    this.windowResources.clear();
    this.tabResources = null;
    this.automationResources = null;
    this.captureResources = null;
    this.policy.allowlist = [];
    this.automation.byWindow.clear();
    this.capture.byWindow.clear();
    this.registry = null;
  }

  private syncWindows(windows: Array<{ id: string }>): void {
    const known = new Set(windows.map((window) => window.id));
    for (const windowId of Array.from(this.windowResources)) {
      if (known.has(windowId)) continue;
      this.windowResources.delete(windowId);
      this.tabResources?.remove(windowId);
      this.automationResources?.remove(windowId);
      this.captureResources?.remove(windowId);
    }
    for (const window of windows) {
      this.windowResources.add(window.id);
      this.tabResources?.ensure(window.id);
      this.automationResources?.ensure(window.id);
      this.captureResources?.ensure(window.id);
    }
  }

  private async saveSnapshot(
    url: string,
    ref?: string,
  ): Promise<{ ref: string }> {
    const doc = await this.cache.get(url);
    if (!doc) throw new Error(`没有网页快照：${url}`);
    const snapshot = this.registry?.snapshot({
      domain: 'workspace',
      resource: 'registry',
    }) as { current?: { id?: string } | null } | null;
    const workspaceId = snapshot?.current?.id;
    if (!workspaceId || !this.layout) {
      throw new Error('没有当前工作区');
    }
    const target =
      ref ??
      `file://${join(
        this.layout.sitesDir(workspaceId),
        'web',
        `${encodeURIComponent(new URL(url).hostname)}-${Date.now()}.md`,
      )}`;
    const path = target.startsWith('file://') ? fileURLToPath(target) : target;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, doc.markdown);
    return { ref: target };
  }

  private loadPolicy(): void {
    const registry = this.registry;
    const layout = this.layout;
    if (!registry || !layout) return;
    const snapshot = registry.snapshot({
      domain: 'workspace',
      resource: 'registry',
    }) as { current?: { id?: string } | null } | null;
    const workspaceId = snapshot?.current?.id;
    this.policy.allowlist = workspaceId
      ? readWorkspacePolicy(layout, workspaceId).browser.allowlist
      : [];
    registry.define('browser').resource('policy').publish();
  }

  private persist(allowlist: string[]): void {
    const registry = this.registry;
    const layout = this.layout;
    if (!registry || !layout) return;
    const snapshot = registry.snapshot({
      domain: 'workspace',
      resource: 'registry',
    }) as { current?: { id?: string } | null } | null;
    const workspaceId = snapshot?.current?.id;
    if (workspaceId) {
      writeWorkspacePolicy(layout, workspaceId, {
        browser: { allowlist },
      });
    }
  }
}
