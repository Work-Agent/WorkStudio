#!/usr/bin/env node
/**
 * 腾讯云 COS 更新镜像发布。
 *
 * upload   上传某平台安装包到 data/<tag>/，并写 data/<tag>/assets-<platform>.json
 * manifest 汇总各平台片段，生成 data/latest.json（客户端检查更新的入口）
 *
 * 需要环境变量 COS_SECRET_ID / COS_SECRET_KEY。对象以公有读写入，
 * 客户端无需签名即可下载。
 */

import COS from 'cos-nodejs-sdk-v5';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';

const BUCKET = 'ai-1301618848';
const REGION = 'ap-nanjing';
const PREFIX = 'data';

/** 构建平台目录名 → 清单键前缀（与客户端 process.platform 对齐）。 */
const PLATFORM_KEYS = { mac: 'darwin', win: 'win32', linux: 'linux' };
const PLATFORMS = Object.keys(PLATFORM_KEYS);
/** 每个平台供应用内更新的安装包格式。 */
const INSTALLER_EXT = { mac: '.dmg', win: '.exe', linux: '.AppImage' };
const ARCHES = { arm64: 'arm64', x64: 'x64', x86_64: 'x64', ia32: 'ia32' };

const secretId = process.env.COS_SECRET_ID;
const secretKey = process.env.COS_SECRET_KEY;

function usage() {
  console.error(`用法：
  node scripts/cos-release.mjs upload --tag v0.3.5 --platform mac --files dist/WorkStudio-mac-arm64.dmg ...
  node scripts/cos-release.mjs manifest --tag v0.3.5`);
  process.exit(1);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { files: [] };
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (flag === '--files') {
      while (rest[index + 1] && !rest[index + 1].startsWith('--')) {
        options.files.push(rest[(index += 1)]);
      }
      continue;
    }
    if (flag.startsWith('--')) options[flag.slice(2)] = rest[(index += 1)];
  }
  return { command, options };
}

function client() {
  if (!secretId || !secretKey) {
    console.error('缺少 COS_SECRET_ID / COS_SECRET_KEY');
    process.exit(1);
  }
  return new COS({ SecretId: secretId, SecretKey: secretKey });
}

function put(cos, key, body, contentType, cacheControl) {
  return new Promise((resolve, reject) => {
    cos.putObject(
      {
        Bucket: BUCKET,
        Region: REGION,
        Key: key,
        Body: body,
        ACL: 'public-read',
        ContentType: contentType,
        ...(cacheControl ? { CacheControl: cacheControl } : {}),
      },
      (error, data) => (error ? reject(error) : resolve(data)),
    );
  });
}

function get(cos, key) {
  return new Promise((resolve, reject) => {
    cos.getObject(
      { Bucket: BUCKET, Region: REGION, Key: key },
      (error, data) => {
        if (error) {
          if (error.statusCode === 404) return resolve(null);
          return reject(error);
        }
        resolve(data.Body);
      },
    );
  });
}

/** 从安装包文件名解析架构：WorkStudio-mac-arm64.dmg → arm64。 */
function archOf(name) {
  const match = /^WorkStudio-[a-z]+-(.+)\.(?:dmg|exe|AppImage)$/.exec(name);
  return match ? (ARCHES[match[1]] ?? null) : null;
}

async function upload(cos, options) {
  const { tag, platform } = options;
  if (!tag || !PLATFORMS.includes(platform)) usage();
  if (options.files.length === 0) {
    console.error('没有可上传的安装包');
    process.exit(1);
  }
  const ext = INSTALLER_EXT[platform];
  const assets = {};
  for (const file of options.files) {
    const name = basename(file);
    const arch = archOf(name);
    if (!name.endsWith(ext) || !arch) {
      console.log(`跳过 ${name}`);
      continue;
    }
    const body = await readFile(file);
    const key = `${PREFIX}/${tag}/${name}`;
    await put(cos, key, body, 'application/octet-stream');
    const info = await stat(file);
    assets[`${PLATFORM_KEYS[platform]}-${arch}`] = {
      name,
      size: info.size,
      sha256: createHash('sha256').update(body).digest('hex'),
    };
    console.log(`上传 ${key}（${info.size} 字节）`);
  }
  if (Object.keys(assets).length === 0) {
    console.error(`没有匹配 ${platform} ${ext} 的安装包`);
    process.exit(1);
  }
  const fragment = { tag, version: tag.replace(/^v/, ''), assets };
  await put(
    cos,
    `${PREFIX}/${tag}/assets-${platform}.json`,
    Buffer.from(`${JSON.stringify(fragment, null, 2)}\n`),
    'application/json',
  );
  console.log(`写入 ${PREFIX}/${tag}/assets-${platform}.json`);
  for (const [key, value] of Object.entries(assets)) {
    console.log(`  ${key} → ${value.name}`);
  }
}

async function manifest(cos, options) {
  const { tag } = options;
  if (!tag) usage();
  const assets = {};
  for (const platform of PLATFORMS) {
    const body = await get(cos, `${PREFIX}/${tag}/assets-${platform}.json`);
    if (!body) {
      console.error(`缺少平台清单：${PREFIX}/${tag}/assets-${platform}.json`);
      process.exit(1);
    }
    const fragment = JSON.parse(body.toString());
    Object.assign(assets, fragment.assets ?? {});
  }
  const value = {
    version: tag.replace(/^v/, ''),
    tag,
    publishedAt: new Date().toISOString(),
    assets,
  };
  await put(
    cos,
    `${PREFIX}/latest.json`,
    Buffer.from(`${JSON.stringify(value, null, 2)}\n`),
    'application/json',
    'no-store',
  );
  console.log(`写入 ${PREFIX}/latest.json`);
  console.log(JSON.stringify(value, null, 2));
}

const { command, options } = parseArgs(process.argv.slice(2));
const cos = client();
try {
  if (command === 'upload') await upload(cos, options);
  else if (command === 'manifest') await manifest(cos, options);
  else usage();
} catch (error) {
  console.error(error?.error?.Message ?? error?.message ?? String(error));
  process.exit(1);
}
