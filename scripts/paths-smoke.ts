/**
 * 路径模型冒烟（node --experimental-strip-types scripts/paths-smoke.ts）。
 *
 * 三平台矩阵在本机即可跑完：Windows 用 path.win32，macOS / Linux 共用
 * path.posix，差异体现在 caseInsensitive（mac 默认卷不敏感）。
 */
import path from 'node:path';
import {
  createPathCodec,
  type PathRules,
} from '../src/main/core/path-codec.ts';

/** URL → 资源标识的两段（解析本身由 shared/ura 负责，这里只喂给 codec）。 */
function toRef(url: string): { authority: string; path: string } {
  const parsed = new URL(url);
  return { authority: parsed.host, path: parsed.pathname };
}

let failed = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  if (Object.is(actual, expected)) {
    console.log(`✓ ${name}`);
    return;
  }
  failed += 1;
  console.log(
    `✗ ${name}\n    actual  : ${String(actual)}\n    expected: ${String(expected)}`,
  );
}

function checkThrows(name: string, run: () => unknown): void {
  try {
    run();
  } catch {
    console.log(`✓ ${name}`);
    return;
  }
  failed += 1;
  console.log(`✗ ${name}（未抛错）`);
}

interface Platform {
  name: string;
  rules: PathRules;
  samples: string[];
}

const platforms: Platform[] = [
  {
    name: 'windows',
    rules: { impl: path.win32, caseInsensitive: true },
    samples: [
      'D:\\TS\\Work Agent\\页面 #1 100%.md',
      'D:/TS/mixed/sep.md',
      '\\\\srv\\share\\a b.md',
    ],
  },
  {
    name: 'macos',
    rules: { impl: path.posix, caseInsensitive: true },
    samples: ['/Users/me/Documents/Work Agent/页面 #1 100%.md'],
  },
  {
    name: 'linux',
    rules: { impl: path.posix, caseInsensitive: false },
    samples: ['/home/me/work agent/页面 #1 100%.md'],
  },
];

// ─── 语法层：往返恒等 ───────────────────────────────────────────────
for (const { name, rules, samples } of platforms) {
  const codec = createPathCodec(rules);
  const { impl } = rules;

  for (const sample of samples) {
    const urlPath = codec.fsToUrlPath(sample);
    check(
      `${name} 往返 ${sample}`,
      codec.urlPathToFs(urlPath),
      impl.normalize(sample),
    );
    check(`${name} URL 侧只有 '/' ${sample}`, urlPath.includes('\\'), false);
    check(`${name} URL 侧无未编码空格 ${sample}`, urlPath.includes(' '), false);
    check(`${name} URL 侧以 '/' 开头 ${sample}`, urlPath.startsWith('/'), true);
  }

  // 相对路径不是页面地址
  checkThrows(`${name} 拒绝相对路径`, () =>
    codec.fsToUrlPath(path.join('relative', 'a.md')),
  );
  checkThrows(`${name} 拒绝空 URL 路径`, () => codec.urlPathToFs(''));
  checkThrows(`${name} 拒绝非法百分号编码`, () => codec.urlPathToFs('/a%ZZ'));

  // file URL：页面装载地址
  for (const sample of samples.filter((item) => !item.startsWith('\\\\'))) {
    const fileUrl = codec.fsToFileUrl(sample);
    check(
      `${name} file URL 往返 ${sample}`,
      codec.refToFs(toRef(fileUrl)),
      impl.normalize(sample),
    );
  }
}

// ─── 归属判断：三平台各自的语义 ─────────────────────────────────────
{
  const win = createPathCodec({ impl: path.win32, caseInsensitive: true });
  check(
    'windows 页内资源',
    win.isWithin('D:\\Plugins\\a', 'D:\\Plugins\\a\\x\\index.html'),
    true,
  );
  check(
    'windows 兄弟目录',
    win.isWithin('D:\\Plugins\\a', 'D:\\Plugins\\ab\\index.html'),
    false,
  );
  check(
    'windows .. 逃逸',
    win.isWithin('D:\\Plugins\\a', 'D:\\Plugins\\a\\..\\b\\x'),
    false,
  );
  check('windows 跨盘符', win.isWithin('D:\\Plugins', 'E:\\Plugins\\a'), false);
  check(
    'windows 大小写不敏感',
    win.isWithin('D:\\Plugins\\A', 'd:\\plugins\\a\\x.html'),
    true,
  );
  check(
    'windows UNC 往返',
    win.fsToUrlPath('\\\\srv\\share\\a b.md'),
    '//srv/share/a%20b.md',
  );
  check(
    'windows UNC 回解',
    win.urlPathToFs('//srv/share/a%20b.md'),
    path.win32.normalize('\\\\srv\\share\\a b.md'),
  );
  check(
    'windows 盘符 URL 形态',
    win.fsToUrlPath('D:\\TS\\a.md'),
    '/D:/TS/a.md',
  );
  check(
    'windows file URL',
    win.fsToFileUrl('D:\\TS\\a.md'),
    'file:///D:/TS/a.md',
  );
  check(
    'windows ref 回解',
    win.refToFs(toRef('file:///D:/TS/a.md')),
    path.win32.normalize('D:\\TS\\a.md'),
  );
  checkThrows('windows UNC 不做 file URL', () =>
    win.fsToFileUrl('\\\\srv\\share\\a.md'),
  );
}
{
  const mac = createPathCodec({ impl: path.posix, caseInsensitive: true });
  check(
    'macos 大小写不敏感',
    mac.isWithin('/Users/A/Plugins', '/users/a/plugins/x.html'),
    true,
  );
  check(
    'macos 兄弟目录',
    mac.isWithin('/Users/A/ws', '/Users/A/ws2/x.html'),
    false,
  );
  check(
    'macos .. 逃逸',
    mac.isWithin('/Users/A/ws', '/Users/A/ws/../b'),
    false,
  );
  check(
    'linux 同输入为敏感',
    createPathCodec({ impl: path.posix, caseInsensitive: false }).isWithin(
      '/Users/A/Plugins',
      '/users/a/plugins/x.html',
    ),
    false,
  );
  // realpath 兜底：/tmp → /private/tmp（macOS 常见）
  const resolved = createPathCodec({
    impl: path.posix,
    caseInsensitive: true,
    realpath: (file) => (file.startsWith('/tmp/') ? `/private${file}` : file),
  });
  check(
    'macos realpath 兜底',
    resolved.isWithin('/private/tmp/ws', '/tmp/ws/x.html'),
    true,
  );
}
{
  const linux = createPathCodec({ impl: path.posix, caseInsensitive: false });
  check(
    'linux 页内资源',
    linux.isWithin('/opt/app/pages', '/opt/app/pages/a/x.html'),
    true,
  );
  check(
    'linux 大小写敏感',
    linux.isWithin('/opt/app/Pages', '/opt/app/pages/x.html'),
    false,
  );
  check(
    'linux 根下路径',
    linux.fsToUrlPath('/opt/app/pages/x.html'),
    '/opt/app/pages/x.html',
  );
}

console.log(failed === 0 ? '\nall passed' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
