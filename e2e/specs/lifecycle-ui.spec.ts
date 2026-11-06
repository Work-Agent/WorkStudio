import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { test, expect } from '../support/app';
import { openSettings, switchWorkspace } from '../support/commands';
import { windowByUrl } from '../support/fixtures';

test('远程安装显示真实字节进度，切页保留任务，可取消和校验失败', async ({
  shell,
  electron,
}, testInfo) => {
  const zip = zipSync({
    'package.json': strToU8(
      JSON.stringify({
        name: 'zip-demo',
        version: '1.0.0',
        workstudio: { id: 'zip-demo', label: 'Zip Demo', page: 'index.html' },
        exports: { './ura': './ura.js' },
      }),
    ),
    'ura.js': strToU8('export {};'),
    'index.html': strToU8('<h1>Demo</h1>'),
  });
  const hash = createHash('sha256').update(zip).digest('hex');
  let finish: () => void = () => {};
  const server = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Length': zip.length,
    });
    if (req.url === '/slow.zip') {
      res.write(zip.subarray(0, 40));
      finish = () => res.end(zip.subarray(40));
    } else res.end(zip);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  try {
    await openSettings(shell, 'plugins');
    let page = await windowByUrl(
      electron.app,
      /settings\/plugins\/index\.html/,
    );
    await page.locator('#source').fill(`${base}/slow.zip#sha256=${hash}`);
    await page.locator('#install').click();
    await expect
      .poll(() => shell.evaluate(() => window.appBridge!.peek('/plugins/task')))
      .toMatchObject({
        status: 'running',
        phase: 'download',
        received: 40,
        total: zip.length,
      });
    await expect(page.getByRole('progressbar')).toHaveAttribute(
      'value',
      String(Math.floor((40 / zip.length) * 100)),
    );
    await page.screenshot({ path: testInfo.outputPath('plugin-download.png') });
    await page
      .getByRole('navigation')
      .getByRole('button', { name: '技能', exact: true })
      .click();
    await expect(shell.getByTitle('查看插件安装任务')).toContainText('安装');
    await openSettings(shell, 'plugins');
    page = await windowByUrl(electron.app, /settings\/plugins\/index\.html/);
    await page.getByRole('button', { name: '取消安装', exact: true }).click();
    const overlay = await windowByUrl(electron.app, /overlay\.html/);
    await overlay
      .getByRole('button', { name: '确认取消', exact: true })
      .click();
    await expect
      .poll(() => shell.evaluate(() => window.appBridge!.peek('/plugins/task')))
      .toMatchObject({ status: 'cancelled', installed: false, loaded: false });
    finish();
    await page
      .locator('#source')
      .fill(`${base}/bad.zip#sha256=${'0'.repeat(64)}`);
    await page.locator('#install').click();
    await expect(page.getByRole('alert')).toContainText('校验失败');
    await expect(
      page.getByRole('button', { name: '更换来源', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: '重试安装', exact: true }),
    ).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('plugin-failure.png') });
    await page.locator('#source').fill(`${base}/valid.zip#sha256=${hash}`);
    await page.locator('#install').click();
    await expect
      .poll(() => shell.evaluate(() => window.appBridge!.peek('/plugins/task')))
      .toMatchObject({ status: 'done', installed: true, loaded: true });
  } finally {
    finish();
    server.closeAllConnections();
    server.close();
  }
});

test('助手通过真实模型协议显示失败、重试、执行中和停止，保留下一条草稿', async ({
  shell,
  electron,
  dataDir,
}, testInfo) => {
  let mode: 'fail' | 'success' | 'hold' = 'fail';
  const requests: string[] = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push(body);
    if (mode === 'fail') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message: 'E2E controlled failure',
            type: 'invalid_request_error',
          },
        }),
      );
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    });
    res.write(
      'data: ' +
        JSON.stringify({
          id: 'chat-e2e',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'e2e-model',
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: '受控模型响应' },
              finish_reason: null,
            },
          ],
        }) +
        '\n\n',
    );
    if (mode === 'hold') return;
    res.end(
      'data: ' +
        JSON.stringify({
          id: 'chat-e2e',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'e2e-model',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        }) +
        '\n\ndata: [DONE]\n\n',
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const root = join(dataDir, 'fixtures', 'assistant-lifecycle');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'note.txt'), '资料');
  try {
    await switchWorkspace(shell, root);
    const setup = await shell.evaluate(async (baseUrl) => {
      const calls: Array<[string, unknown]> = [
        [
          '/piconf/settings/set-project',
          { path: 'retry.enabled', value: false },
        ],
        [
          '/piconf/models/save-provider',
          {
            providerId: 'e2e-local',
            config: {
              name: '本地测试模型',
              baseUrl,
              api: 'openai-completions',
            },
          },
        ],
        [
          '/piconf/models/save-model',
          {
            providerId: 'e2e-local',
            model: {
              id: 'e2e-model',
              name: 'E2E Model',
              contextWindow: 32000,
              maxTokens: 2000,
              input: ['text'],
              reasoning: false,
            },
          },
        ],
        [
          '/piconf/agent/configure',
          {
            provider: 'e2e-local',
            modelId: 'e2e-model',
            apiKey: 'local-e2e-key',
          },
        ],
      ];
      const results = [];
      for (const [path, input] of calls)
        results.push(await window.appBridge!.call(path, input));
      return results;
    }, `http://127.0.0.1:${address.port}/v1`);
    expect(
      setup.every((r) => r.ok),
      JSON.stringify(setup),
    ).toBe(true);
    const page = await windowByUrl(electron.app, /assistant\.html/);
    const input = page.locator('textarea');
    await input.fill('检查这份资料');
    await page.getByTitle('发送（Enter）', { exact: true }).click();

    const task = page.locator('[aria-label="本轮任务状态"]');
    await expect(task).toContainText('本轮未完成');
    await expect(task).toContainText('E2E controlled failure');
    await page.screenshot({
      path: testInfo.outputPath('assistant-failure.png'),
    });
    mode = 'success';
    await task.getByRole('button', { name: '重试原请求', exact: true }).click();
    await expect(task).toContainText('本轮结束');
    expect(requests.length).toBeGreaterThanOrEqual(2);
    expect(requests.at(-1)).toContain('检查这份资料');
    mode = 'hold';
    await input.fill('等待任务');
    await page.getByTitle('发送（Enter）', { exact: true }).click();
    await expect(task).toContainText('正在处理任务');
    await input.fill('下一条草稿');
    await page.screenshot({
      path: testInfo.outputPath('assistant-running.png'),
    });
    await task.getByRole('button', { name: '停止本轮', exact: true }).click();
    await expect(task).toContainText('本轮已停止');
    await expect(input).toHaveValue('下一条草稿');
    await page.screenshot({
      path: testInfo.outputPath('assistant-stopped.png'),
    });
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
