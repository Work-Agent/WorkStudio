import { expect, test } from '@playwright/test';
import { ViewRegistry } from '../src/main/framework/views';

test('视图注册表支持 pin、move 与系统视图过滤', () => {
  const registry = new ViewRegistry();
  const a = registry.create({ type: 'page', title: 'A' });
  const b = registry.create({ type: 'page', title: 'B' });
  const c = registry.create({ type: 'web', title: 'C' });
  registry.create({ type: 'assistant', title: 'assistant' });

  expect(registry.list().map((view) => view.title)).toEqual(['A', 'B', 'C']);

  registry.togglePin(a.id);
  expect(registry.list().find((view) => view.id === a.id)?.pinned).toBe(true);

  registry.move(c.id, a.id);
  expect(registry.list().map((view) => view.title)).toEqual(['C', 'A', 'B']);

  registry.move(a.id, b.id);
  expect(registry.list().map((view) => view.title)).toEqual(['C', 'A', 'B']);

  registry.remove(b.id);
  expect(registry.list().map((view) => view.title)).toEqual(['C', 'A']);
});
