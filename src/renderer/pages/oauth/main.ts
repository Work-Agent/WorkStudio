/**
 * OAuth 回调落地页：授权完成后浏览器跳到这里，把凭证一步交回主进程。
 *
 * 支持两种形态：查询串 / hash 里的 access_token（+ refresh_token、expires_in）；
 * 没有 token 时只做提示。凭证不留在页面。
 */
const app = document.querySelector<HTMLDivElement>('#app');
const params = new URLSearchParams(location.search);
const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
const provider = params.get('provider') ?? '';
const accessToken =
  params.get('access_token') ?? hash.get('access_token') ?? '';
const refreshToken =
  params.get('refresh_token') ?? hash.get('refresh_token') ?? '';
const expiresIn = Number(
  params.get('expires_in') ?? hash.get('expires_in') ?? '',
);

async function complete(): Promise<void> {
  if (!provider) throw new Error('缺少 provider');
  if (!accessToken) throw new Error('缺少 access_token');
  const bridge = window.workStudio;
  if (!bridge) throw new Error('workStudio 未注入');
  const result = await bridge.command(
    'agent',
    `provider/${encodeURIComponent(provider)}`,
    'completeLogin',
    {
      accessToken,
      ...(refreshToken ? { refreshToken } : {}),
      ...(Number.isFinite(expiresIn) ? { expiresIn } : {}),
    },
  );
  if (!result.ok) throw new Error(result.error.message);
  if (app) app.textContent = '授权完成，可以关闭此页面。';
}

void complete().catch((error: unknown) => {
  if (app)
    app.textContent = error instanceof Error ? error.message : String(error);
});

export {};
