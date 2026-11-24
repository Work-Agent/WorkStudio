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
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readWorkspacePolicy,
  writeWorkspacePolicy,
} from '../../platform/preferences.ts';
import { BrowserCapability } from './capability.ts';
import {
  createAutomationState,
  createCaptureState,
  createPolicyState,
  defineAutomationResource,
  defineTabsResource,
  defineCaptureResource,
  definePolicyResource,
  defineWebResource,
  registerWebAdapter,
  unregisterWebAdapter,
  type AutomationState,
  type CaptureState,
  type PolicyState,
} from './domains.ts';

export class BrowserModule implements DomainModule {
  readonly id = 'browser';
  readonly dependencies = ['shell', 'workspace'] as const;

  private readonly policy: PolicyState = createPolicyState();
  private readonly automation: AutomationState = createAutomationState();
  private readonly capture: CaptureState = createCaptureState();
  private registry: DomainRegistry | null = null;
  private offWorkspace: (() => void) | null = null;

  constructor(
    readonly capability: BrowserCapability,
    private readonly transport: TransportRouter,
    private readonly cache: WebCache,
    private readonly layout?: StorageLayout,
  ) {}

  attach(registry: DomainRegistry): void {
    this.registry = registry;
    defineTabsResource(registry, this.capability);
    definePolicyResource(registry, this.policy);
    defineAutomationResource(registry, this.automation, this.capability);
    defineCaptureResource(registry, this.capture);
    defineWebResource(registry, this.cache, this.capability, (url, ref) =>
      this.saveSnapshot(url, ref),
    );
  }

  start(): void {
    registerWebAdapter(this.transport, this.cache);
    const registry = this.registry;
    if (registry) {
      this.loadPolicy();
      this.offWorkspace = registry.onUpdate((update) => {
        if (
          update.domain === 'workspace' &&
          update.resource === 'registry' &&
          update.type === 'snapshot'
        ) {
          this.loadPolicy();
        }
      });
    }
  }

  stop(): void {
    this.offWorkspace?.();
    this.offWorkspace = null;
    unregisterWebAdapter(this.transport);
    this.policy.allowlist = [];
    this.automation.attached.clear();
    this.capture.session = null;
    this.registry = null;
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
