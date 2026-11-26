#!/usr/bin/env node
/**
 * SDK 发布判定。
 *
 * 规则：
 * - 预发布 tag 不发 SDK；
 * - SDK 版本没变（等于 npm latest）且代码没变 → 跳过；
 * - SDK 代码变了但版本没 bump → 失败；
 * - SDK 版本高于 npm latest → 发布。SDK 版本独立于 app 版本，
 *   tag 只负责触发，发布与否由 packages/sdk/package.json 决定。
 *
 * 用法：
 *   node scripts/release-sdk.mjs --tag v0.3.3
 *   GITHUB_REF_NAME=v0.3.3 node scripts/release-sdk.mjs
 *
 * 写 GITHUB_OUTPUT：publish=true|false、version、reason。
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SDK_PACKAGE = join(ROOT, 'packages/sdk/package.json');
const NPM_NAME = '@work-studio/sdk';
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0) return process.argv[index + 1];
  const inline = process.argv.find((item) => item.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : undefined;
}

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

function run(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    const stderr = error.stderr?.toString?.() ?? '';
    error.detail = stderr.trim();
    throw error;
  }
}

function npmLatest() {
  try {
    const raw = run('npm', ['view', NPM_NAME, 'version', '--json']);
    const value = JSON.parse(raw);
    return typeof value === 'string' ? value : null;
  } catch (error) {
    const detail = error.detail ?? '';
    if (/E404|404 Not Found|is not in this registry/i.test(detail)) {
      return null;
    }
    fail(`读取 npm ${NPM_NAME} 版本失败：${detail || error.message}`);
  }
}

/** 已发布包对应的提交：以 npm 的 gitHead 作为变化比较基线。 */
function npmGitHead(version) {
  try {
    const raw = run('npm', [
      'view',
      `${NPM_NAME}@${version}`,
      'gitHead',
      '--json',
    ]);
    const value = JSON.parse(raw);
    return typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

function hasCommit(ref) {
  const result = spawnSync('git', ['cat-file', '-e', `${ref}^{commit}`], {
    stdio: 'ignore',
  });
  return result.status === 0;
}

/** 上一个稳定 tag（不含 -beta / -rc），SDK 只在稳定版发布。 */
function previousStableTag(tag) {
  let output;
  try {
    output = run('git', ['tag', '--merged', `${tag}^`, '--sort=-v:refname']);
  } catch (error) {
    fail(
      `读取历史 tag 失败（需要 fetch-depth: 0）：${error.detail ?? error.message}`,
    );
  }
  return (
    output
      .split('\n')
      .map((item) => item.trim())
      .find((item) => /^v\d+\.\d+\.\d+$/.test(item)) ?? null
  );
}

function compareStable(a, b) {
  const left = a.split('.').map((item) => Number(item) || 0);
  const right = b.split('.').map((item) => Number(item) || 0);
  for (let index = 0; index < 3; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function changedSince(tag, previous) {
  if (!previous) return true;
  const result = spawnSync(
    'git',
    ['diff', '--quiet', previous, tag, '--', 'packages/sdk'],
    { encoding: 'utf8' },
  );
  if (result.status === 0) return false;
  if (result.status === 1) return true;
  fail(`git diff 失败：${result.stderr?.trim() || result.status}`);
}

function output(values) {
  for (const [key, value] of Object.entries(values)) {
    console.log(`${key}=${value}`);
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
    }
  }
}

const tag =
  process.env.GITHUB_REF_NAME?.trim() || argument('tag')?.trim() || '';
if (!tag) fail('缺少 tag：设置 GITHUB_REF_NAME 或传 --tag vX.Y.Z');
if (!tag.startsWith('v')) fail(`tag 必须以 v 开头：${tag}`);
const tagVersion = tag.slice(1);
if (!SEMVER.test(tagVersion)) fail(`tag 不是 semver：${tag}`);

const sdk = JSON.parse(readFileSync(SDK_PACKAGE, 'utf8'));
const sdkVersion = sdk.version;
if (typeof sdkVersion !== 'string' || !SEMVER.test(sdkVersion)) {
  fail(`packages/sdk 版本非法：${String(sdkVersion)}`);
}

if (tagVersion.includes('-')) {
  output({
    publish: 'false',
    version: sdkVersion,
    reason: `预发布 tag ${tag}，不发布 SDK`,
  });
  process.exit(0);
}

const latest = npmLatest();

if (latest === null) {
  output({
    publish: 'true',
    version: sdkVersion,
    reason: '首次发布 SDK',
  });
  process.exit(0);
}

const publishedFrom = latest ? npmGitHead(latest) : null;
const baseline =
  publishedFrom && hasCommit(publishedFrom)
    ? publishedFrom
    : previousStableTag(tag);
if (publishedFrom && !hasCommit(publishedFrom)) {
  console.warn(
    `::warning::npm ${NPM_NAME}@${latest} 的 gitHead ${publishedFrom} 不在当前历史中，回退到上一个稳定 tag。`,
  );
}
const changed = changedSince(tag, baseline);

if (sdkVersion === latest) {
  if (changed) {
    fail(
      `SDK 自 ${baseline ? baseline.slice(0, 7) : '首个版本'} 以来有变化，但版本仍是 ${sdkVersion}；请 bump packages/sdk 版本`,
    );
  }
  output({
    publish: 'false',
    version: sdkVersion,
    reason: `SDK 无变化（npm ${latest}）`,
  });
  process.exit(0);
}

if (compareStable(sdkVersion, latest) <= 0) {
  fail(`SDK 版本必须大于 npm latest ${latest}，当前 ${sdkVersion}`);
}

output({
  publish: 'true',
  version: sdkVersion,
  reason: changed
    ? `SDK 已更新 ${latest} → ${sdkVersion}`
    : `SDK 显式 bump 到 ${sdkVersion}`,
});
