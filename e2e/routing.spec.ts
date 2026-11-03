import { expect, test } from '@playwright/test';
import { Host } from '../src/main/framework/host';
import type { RegisteredMiddleware } from '../src/main/framework/middleware';
import { Router } from '../src/main/router/router';

const origin = { type: 'service', id: 'test', base: '' } as const;

test('call 路由返回处理器结果', async () => {
  const host = new Host();
  const plugins = new Router(host).service('plugins', '/plugins');
  plugins.handle('/ping', () => 'pong');

  const result = await host.call(origin, '/plugins/ping');
  expect(result).toEqual({ ok: true, data: 'pong' });
});

test('state 订阅立即回放当前值', async () => {
  const host = new Host();
  const plugins = new Router(host).service('plugins', '/plugins');
  const count = plugins.state<number>('/count');
  count.publish(3);

  const view = host.views.create({
    type: 'page',
    grants: { watch: ['/plugins/**'] },
  });
  const frames: unknown[] = [];
  host.views.attach(view.id, (frame) => frames.push(frame));

  const result = await host.watch(view.id, ['/plugins/count']);
  expect(result).toEqual({ granted: ['/plugins/count'], denied: [] });
  expect(frames).toEqual([{ type: 'state', path: '/plugins/count', value: 3 }]);
});

test('view:true 事件可订阅，内部事件不可订阅', async () => {
  const host = new Host();
  const plugins = new Router(host).service('plugins', '/plugins');
  const delta = plugins.event<{ type: 'append'; delta: string }>('/delta', {
    view: true,
    validate: (value) =>
      typeof value === 'object' &&
      value !== null &&
      (value as { type?: string }).type === 'append',
  });
  plugins.event('/internal');

  const view = host.views.create({
    type: 'page',
    grants: { watch: ['/plugins/**'] },
  });
  const frames: unknown[] = [];
  host.views.attach(view.id, (frame) => frames.push(frame));

  const visible = await host.watch(view.id, ['/plugins/delta']);
  expect(visible.granted).toEqual(['/plugins/delta']);
  delta.emit({ type: 'append', delta: 'a' });
  host.bus.flush();
  expect(frames.at(-1)).toMatchObject({
    type: 'event',
    path: '/plugins/delta',
    value: { type: 'append', delta: 'a' },
  });

  const internal = await host.watch(view.id, ['/plugins/internal']);
  expect(internal).toEqual({
    granted: [],
    denied: ['/plugins/internal'],
  });
});

test('请求中间件只包裹 call，且可短路、按注册顺序执行', async () => {
  const host = new Host();
  const plugins = new Router(host).service('plugins', '/plugins');
  plugins.handle('/ping', () => 'pong');

  const order: string[] = [];
  const middleware = (id: string): RegisteredMiddleware => ({
    path: '/plugins',
    middleware: {
      id,
      async handle(_call, next) {
        order.push(`${id}:before`);
        const result = await next();
        order.push(`${id}:after`);
        return result;
      },
    },
  });

  host.useCall([middleware('one'), middleware('two')]);
  await host.call(origin, '/plugins/ping');
  expect(order).toEqual(['one:before', 'two:before', 'two:after', 'one:after']);

  host.useCall([
    {
      path: '/plugins',
      middleware: {
        id: 'block',
        handle: () => ({
          ok: false,
          error: { code: 'denied', message: 'blocked' },
        }),
      },
    },
  ]);
  expect(await host.call(origin, '/plugins/ping')).toEqual({
    ok: false,
    error: { code: 'denied', message: 'blocked' },
  });
});
