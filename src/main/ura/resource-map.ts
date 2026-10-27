// ─── AGENTS.md（URA 托管的资源地图） ─────────────────────────────────
//
// 每个工作区一份，由 URA 生成并维护：写经管道、监听变更、去抖重建。
// 内容 = 集合分组 + 每个资源的格式（codec）+ 数据对象 schema 清单。
// 智能体侧 pi 按标准机制加载 AGENTS.md；会话内的实时刷新由 harness 的
// context 钩子按版本补丁完成。

import { createHash } from 'node:crypto';
import { fileRef } from '../../shared/ura';
import type { Ura } from './facade';
import type { UraRegistry } from './registry';

const MAP_FILE = 'AGENTS.md';
const DEBOUNCE_MS = 400;

export interface ResourceMapGroup {
  label: string;
  items: Array<{ ref: string; title: string }>;
}

export type ResourceMapSource = () => Promise<ResourceMapGroup[]>;

export class ResourceMap {
  private timer: NodeJS.Timeout | undefined;
  private watcher: { close(): void } | null = null;
  private version = '';

  private listSource: ResourceMapSource | null = null;

  constructor(
    private readonly ura: Ura,
    private readonly registry: UraRegistry,
    private readonly workspace: () => string,
  ) {}

  setSource(source: ResourceMapSource): void {
    this.listSource = source;
  }

  get ref(): string {
    return `${this.root()}/${MAP_FILE}`;
  }

  get currentVersion(): string {
    return this.version;
  }

  async start(): Promise<void> {
    await this.refresh();
    this.watch();
  }

  restart(): void {
    this.watcher?.close();
    this.watcher = null;
    void this.start();
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.watcher?.close();
    this.watcher = null;
  }

  private root(): string {
    return fileRef(this.workspace());
  }

  private watch(): void {
    this.watcher = this.ura.watch(this.root(), (event) => {
      if (event.ref === this.ref) return;
      this.schedule();
    });
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.refresh();
    }, DEBOUNCE_MS);
  }

  async refresh(): Promise<void> {
    const content = await this.render();
    const version = digest(content);
    if (version === this.version) return;
    const current = await this.readMap();
    if (current !== content) {
      await this.ura.write(this.ref, content);
    }
    this.version = version;
  }

  private async readMap(): Promise<string | null> {
    try {
      const opened = await this.ura.read(this.ref, { as: 'agent' });
      return opened.presentation.type === 'text'
        ? opened.presentation.content
        : null;
    } catch {
      return null;
    }
  }

  private async render(): Promise<string> {
    const groups = this.listSource ? await this.listSource() : [];
    const lines = [
      '# WorkStudio 资源地图',
      '',
      '> 由 URA 自动生成与维护，请勿手动编辑；资源写入后会自动更新。',
      '',
    ];

    let count = 0;
    for (const group of groups) {
      if (group.items.length === 0) continue;
      lines.push(`## ${group.label}`, '');
      lines.push('| 资源 | 格式 |');
      lines.push('| --- | --- |');
      for (const item of group.items) {
        const codec = this.registry.codecForExtension(extensionOf(item.title));
        lines.push(`| \`${item.ref}\` | ${codec?.id ?? 'raw'} |`);
        count++;
      }
      lines.push('');
    }
    if (count === 0) lines.push('（空工作区）', '');

    const schemas = this.registry.schemas();
    if (schemas.length > 0) {
      lines.push('## 数据对象（仅 schema，query 查询）', '');
      for (const schema of schemas) lines.push(`- ${schema.codec}`);
      lines.push('');
    }

    return lines.join('\n');
  }
}

function extensionOf(name: string): string {
  const index = name.lastIndexOf('.');
  return index <= 0 ? '' : name.slice(index + 1).toLowerCase();
}

function digest(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 16);
}
