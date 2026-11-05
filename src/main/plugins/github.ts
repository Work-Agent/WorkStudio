// ─── GitHub 下载认证 ──────────────────────────────────────────────────
//
// 插件目录与 zip 目前托管在私有仓库：安装包内附带一个细粒度只读 token
// 供内部使用，过期时间 2026-12-05，到期自动失效（仓库转 public 前已失效，
// 届时应连同本常量一并删除）。
// GITHUB_TOKEN 环境变量优先；认证头只发给 GitHub 域名，不跟随任意下载地址。

export const BUNDLED_GITHUB_TOKEN =
  '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';

const GITHUB_HOST = /(^|\.)(?:github|githubusercontent)\.com$/i;

/** GitHub 域名请求头（含认证）；其他域名返回空，不泄漏凭据。 */
export function githubHeaders(url: string): Record<string, string> {
  const token = process.env.GITHUB_TOKEN || BUNDLED_GITHUB_TOKEN;
  if (!token) return {};
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return {};
  }
  if (!GITHUB_HOST.test(host)) return {};
  return { Authorization: `Bearer ${token}` };
}
