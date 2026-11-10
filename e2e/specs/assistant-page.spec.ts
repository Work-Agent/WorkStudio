import { readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { test, expect, type Page } from '@playwright/test';

test.use({
  launchOptions: process.env['E2E_BROWSER_PATH']
    ? { executablePath: process.env['E2E_BROWSER_PATH'] }
    : {},
});

// 使用实际构建的 Agent 页面，桥接事实由隔离数据驱动，不连接真实模型。
async function openPage(page: Page) {
  await page.route('http://agent.test/**', (route) => {
    const path = resolve(
      'out/renderer',
      decodeURIComponent(new URL(route.request().url()).pathname).slice(1),
    );
    const types: Record<string, string> = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
    };
    return route.fulfill({
      body: readFileSync(path),
      contentType: types[extname(path)] ?? 'application/octet-stream',
    });
  });
  await page.addInitScript(() => {
    const base = '/workspaces/test/sessions';
    const first = '/workspace/first.jsonl';
    const second = '/workspace/second.jsonl';
    let seq = 0;
    const listeners = new Set<(frame: unknown) => void>();
    const state: Record<string, any> = {
      '/workspaces/current': {
        id: 'test',
        path: '/workspace',
        name: '示例工作区',
      },
      '/theme': 'light',
      '/scene/test': { aiFloating: false },
      '/piconf': {
        skills: [
          { name: '文档处理', description: '整理和生成文档' },
          { name: '研究分析', description: '检索资料' },
        ],
      },
      [base]: [
        { path: first, name: '第一轮' },
        { path: second, name: '第二轮' },
      ],
      [`${base}/opened`]: [first, second],
      [`${base}/current`]: {
        configured: true,
        provider: 'demo',
        modelId: 'demo',
        thinkingLevel: 'low',
        sessionFile: first,
        workspacePath: '/workspace',
        isStreaming: false,
      },
      [`${base}/models`]: [
        { provider: 'demo', modelId: 'demo', label: '示例模型' },
        { provider: 'demo', modelId: 'other', label: '另一模型' },
      ],
      [`${base}/task`]: null,
      [`${base}/${encodeURIComponent(first)}/messages`]: [],
      [`${base}/${encodeURIComponent(second)}/messages`]: [
        {
          role: 'assistant',
          blocks: [{ type: 'text', text: '第二轮的历史回答' }],
        },
      ],
    };
    const publish = (path: string, value: unknown) => {
      state[path] = value;
      for (const fn of listeners)
        fn({ type: 'state', path, value: structuredClone(value) });
    };
    const calls: Array<{ path: string; input: any }> = [];
    const api = {
      state,
      calls,
      fail: '',
      finish: () => {},
      publish,
    };
    Object.defineProperty(window, 'agentPageTest', { value: api });
    Object.defineProperty(window, 'appBridge', {
      value: {
        available: async () => true,
        on: (fn: (frame: unknown) => void) => {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
        watch: async (paths: string[]) => {
          queueMicrotask(() =>
            paths.forEach((path) => publish(path, state[path] ?? null)),
          );
        },
        peek: async (path: string) => structuredClone(state[path] ?? null),
        call: async (path: string, input: any) => {
          calls.push({ path, input });
          if (api.fail && path.endsWith(api.fail))
            return {
              ok: false,
              error: { code: 'failed', message: '请求未被接受' },
            };
          if (path.endsWith('/current/open'))
            publish(`${base}/current`, {
              ...state[`${base}/current`],
              sessionFile: decodeURIComponent(input.sessionId),
            });
          if (path.endsWith('/new')) {
            const file = `/workspace/new-${++seq}.jsonl`;
            publish(`${base}/opened`, [...state[`${base}/opened`], file]);
            publish(`${base}/current`, {
              ...state[`${base}/current`],
              sessionFile: file,
            });
            publish(`${base}/${encodeURIComponent(file)}/messages`, []);
          }
          if (path.endsWith('/prompt')) {
            const task = {
              id: ++seq,
              sessionFile: state[`${base}/current`].sessionFile,
              status: 'running',
              request: input.text,
              attempt: 1,
              stage: '正在连接模型',
              error: null,
              mayHaveSideEffects: false,
              artifacts: [],
              tools: [],
            };
            publish(`${base}/task`, task);
            publish(`${base}/current`, {
              ...state[`${base}/current`],
              isStreaming: true,
            });
            await new Promise<void>((done) => {
              api.finish = () => {
                publish(`${base}/task`, { ...task, status: 'done' });
                publish(`${base}/current`, {
                  ...state[`${base}/current`],
                  isStreaming: false,
                });
                done();
              };
            });
          }
          if (path.endsWith('/model/set'))
            publish(`${base}/current`, {
              ...state[`${base}/current`],
              ...input,
            });
          if (path.endsWith('/thinking/set'))
            publish(`${base}/current`, {
              ...state[`${base}/current`],
              thinkingLevel: input.level,
            });
          if (path.endsWith('/abort'))
            publish(`${base}/task`, {
              ...state[`${base}/task`],
              status: 'unconfirmed',
              stage: '尚未确认停止',
            });
          if (path.endsWith('/commands')) return { ok: true, data: [] };
          return { ok: true, data: {} };
        },
      },
    });
  });
  await page.goto('http://agent.test/assistant.html');
  await expect(page.getByRole('tab', { name: '第一轮' })).toBeVisible();
  await expect(page.getByLabel('任务或补充要求')).toBeEnabled();
}

declare global {
  interface Window {
    agentPageTest: {
      state: Record<string, any>;
      calls: Array<{ path: string; input: any }>;
      fail: string;
      finish: () => void;
      publish: (path: string, value: unknown) => void;
    };
  }
}

test('草稿按会话隔离，菜单保护文字，配置与技能选择清晰', async ({ page }) => {
  await openPage(page);
  const draft = page.getByLabel('任务或补充要求');
  await draft.fill('第一轮草稿');
  await page.getByRole('tab', { name: '第二轮' }).click();
  await expect(draft).toHaveValue('');
  await expect(page.getByText('第二轮的历史回答')).toBeVisible();
  await draft.fill('第二轮草稿');
  await page.getByRole('tab', { name: '第一轮' }).click();
  await expect(draft).toHaveValue('第一轮草稿');
  await expect(page.getByText('第二轮的历史回答')).toHaveCount(0);
  await page.getByRole('button', { name: '命令', exact: true }).click();
  await expect(draft).toHaveValue('第一轮草稿');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '命令' })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '命令', exact: true }),
  ).toBeFocused();
  await page.getByRole('button', { name: '模型与思考', exact: true }).click();
  await page.getByLabel('思考强度', { exact: true }).selectOption('high');
  await expect(
    page.getByRole('button', { name: '模型与思考', exact: true }),
  ).toContainText('高');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '本轮技能', exact: true }).click();
  await page.getByLabel('指定技能', { exact: true }).check();
  await expect(page.getByLabel('文档处理', { exact: false })).not.toBeChecked();
  await page.getByLabel('文档处理', { exact: false }).check();
  await page.getByLabel('文档处理', { exact: false }).uncheck();
  await expect(
    page.getByRole('button', { name: '发送', exact: true }),
  ).toBeDisabled();
  await page.getByLabel('自动使用工作区已启用技能').check();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: '发送', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: '更多对话操作' }).click();
  await page.getByRole('button', { name: '重命名对话', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '对话名称' })).toHaveValue(
    '第一轮',
  );
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await expect(draft).toHaveValue('');
  await page.getByRole('tab', { name: '第一轮' }).click();
  await expect(draft).toHaveValue('第一轮草稿');
});

test('发送失败保留草稿，执行中可补充和排队，停止未确认不能重发', async ({
  page,
}) => {
  await openPage(page);
  const draft = page.getByLabel('任务或补充要求');
  await page.evaluate(() => {
    window.agentPageTest.fail = '/prompt';
  });
  await draft.fill('请生成报告');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('未发送的内容已保留');
  await expect(draft).toHaveValue('请生成报告');
  await page.evaluate(() => {
    window.agentPageTest.fail = '';
  });
  await page.getByRole('button', { name: '本轮技能', exact: true }).click();
  await page.getByLabel('指定技能', { exact: true }).check();
  await page.getByLabel('文档处理', { exact: false }).check();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '本轮技能', exact: true }),
  ).toContainText('自动');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.agentPageTest.calls
            .filter((c) => c.path.endsWith('/prompt'))
            .at(-1)?.input.activeSkills,
      ),
    )
    .toEqual(['文档处理']);
  await expect(
    page.getByRole('button', { name: '补充要求', exact: true }),
  ).toBeVisible();
  await expect(draft).toHaveValue('');
  await page.setViewportSize({ width: 560, height: 760 });
  await page.screenshot({ path: 'test-results/agent-page-running.png' });
  await draft.fill('补充：只写重点');
  await page.getByRole('button', { name: '补充要求', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.agentPageTest.calls.some(
          (c) => c.path.endsWith('/steer') && c.input.text.includes('只写重点'),
        ),
      ),
    )
    .toBe(true);
  await draft.fill('下一轮继续');
  await page.getByRole('button', { name: '其他发送方式' }).click();
  await page
    .getByRole('button', { name: '本轮结束后发送', exact: false })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.agentPageTest.calls.some((c) => c.path.endsWith('/follow-up')),
      ),
    )
    .toBe(true);
  await page.getByRole('button', { name: '停止本轮', exact: true }).click();
  await draft.fill('保留到停止确认后');
  await expect(
    page.getByRole('button', { name: '发送', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText('尚未确认执行结束', { exact: true }),
  ).toBeVisible();
  await expect(draft).toHaveValue('保留到停止确认后');
});

test('成果前置，错误恢复保留草稿，窄面板配置不越界', async ({ page }) => {
  await openPage(page);
  await page.evaluate(() => {
    window.agentPageTest.publish('/workspaces/test/sessions/task', {
      id: 3,
      sessionFile: '/workspace/first.jsonl',
      status: 'failed',
      request: '整理报告',
      attempt: 1,
      stage: '文件写入失败',
      error: '目标目录不可写',
      mayHaveSideEffects: true,
      artifacts: [{ ref: 'file:///workspace/report.md', label: 'report.md' }],
      tools: [{ id: '1', name: 'write', done: true, error: false }],
    });
  });
  await expect(page.getByRole('button', { name: /report.md/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '检查模型连接' })).toHaveCount(
    0,
  );
  await expect(page.locator('.wb-task-details')).not.toHaveAttribute('open');
  await expect(
    page.getByRole('heading', { name: '需要我帮你完成什么？' }),
  ).toHaveCount(0);
  await page.getByLabel('任务或补充要求').fill('保留我的修改');
  await page.getByRole('button', { name: '修改请求', exact: true }).click();
  await expect(page.getByLabel('任务或补充要求')).toHaveValue(
    '保留我的修改\n整理报告',
  );
  await expect(page.getByLabel('任务或补充要求')).toBeFocused();
  await page.getByRole('button', { name: '重试原请求', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '已检查，重新执行' }),
  ).toBeVisible();
  await page.setViewportSize({ width: 360, height: 720 });
  for (const name of ['模型与思考', '本轮技能', '命令']) {
    await page.getByRole('button', { name, exact: true }).click();
    const dialog = page.getByRole('dialog', { name, exact: true });
    await expect(dialog).toBeVisible();
    const rect = await dialog.boundingBox();
    expect(rect!.x).toBeGreaterThanOrEqual(0);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(360);
    expect(rect!.y).toBeGreaterThanOrEqual(0);
    if (name === '模型与思考')
      await page.screenshot({ path: 'test-results/agent-page-config.png' });
    await page.keyboard.press('Escape');
  }
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await page.screenshot({ path: 'test-results/agent-page-narrow.png' });
});

test('模型切换失败反馈且保留原配置，回答内本地成果在工作台打开', async ({
  page,
}) => {
  await openPage(page);
  await page.getByRole('button', { name: '模型与思考', exact: true }).click();
  await page.evaluate(() => {
    window.agentPageTest.fail = '/model/set';
  });
  await page.getByLabel('当前模型', { exact: true }).selectOption('demo/other');
  await expect(page.getByRole('alert')).toContainText('请求未被接受');
  await expect(page.getByLabel('当前模型', { exact: true })).toHaveValue(
    'demo/demo',
  );
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    window.agentPageTest.publish(
      `/workspaces/test/sessions/${encodeURIComponent('/workspace/first.jsonl')}/messages`,
      [
        {
          role: 'assistant',
          blocks: [
            {
              type: 'tool',
              toolName: 'write',
              args: { path: 'report.md' },
              result: 'ok',
            },
            { type: 'text', text: '已生成[项目简报](report.md)' },
          ],
        },
      ],
    );
  });
  await expect(page.locator('.agent-execution')).not.toHaveAttribute('open');
  await page.getByRole('link', { name: '项目简报', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.agentPageTest.calls.find((c) =>
            c.path.endsWith('/resources/pages/open'),
          )?.input.ref,
      ),
    )
    .toBe('file:///workspace/report.md');
  await expect(
    page.getByRole('button', { name: '复制回答', exact: true }),
  ).toBeVisible();
});
