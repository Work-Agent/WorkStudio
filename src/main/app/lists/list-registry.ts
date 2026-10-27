/**
 * 列表定义注册表（Phase 4）。
 *
 * 定义归 App；内置列表与插件列表使用同一注册面。Phase 4 先注册内置定义，
 * 插件 registerList 在后续接入。
 */

import type { ListDefinition } from '../../../shared/lists';

export class ListRegistry {
  private readonly definitions = new Map<string, ListDefinition>();

  register(definition: ListDefinition): void {
    if (this.definitions.has(definition.id)) {
      // 后注册者胜出，诊断由调用方记录。
    }
    this.definitions.set(definition.id, definition);
  }

  get(id: string): ListDefinition | undefined {
    return this.definitions.get(id);
  }

  all(): ListDefinition[] {
    return [...this.definitions.values()].sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0),
    );
  }
}
