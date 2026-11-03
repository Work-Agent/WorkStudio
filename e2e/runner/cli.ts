/**
 * 本地 CDP 跑法（不经过 pi extension）：
 *   node e2e/runner/cli.ts --grep 设置
 *   node e2e/runner/cli.ts --case settings.open
 *   node e2e/runner/cli.ts --tag dev
 */
import { runCdpFilter } from './run.ts';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const filter = {
  id: argument('case'),
  tag: argument('tag') as 'dev' | 'ci' | undefined,
  grep: argument('grep'),
  all: process.argv.includes('--all'),
};

const results = await runCdpFilter(filter, {
  allowMutating: process.argv.includes('--allow-mutating'),
  endpoint: process.env['E2E_CDP_URL'],
  screenshotPath: '/tmp/work-studio-dev-test-failure.png',
});

for (const result of results) {
  if (result.ok) {
    console.log(`✓ ${result.id}  ${result.title}`);
  } else {
    console.error(`✗ ${result.id}  ${result.title}`);
    console.error(`  ${result.error}`);
    if (result.screenshot) console.error(`  截图：${result.screenshot}`);
  }
}

const failed = results.filter((result) => !result.ok);
console.log(
  `\n${results.length - failed.length} passed, ${failed.length} failed`,
);
process.exitCode = failed.length > 0 ? 1 : 0;
