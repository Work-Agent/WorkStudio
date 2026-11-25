const app = document.querySelector<HTMLDivElement>('#app');
const params = new URLSearchParams(location.search);
const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
const provider = params.get('provider') ?? '';
const state = params.get('state') ?? '';
const accessToken =
  params.get('access_token') ?? hash.get('access_token') ?? '';

async function complete(): Promise<void> {
  if (!provider || !state) throw new Error('缺少 provider 或 state');
  const bridge = window.workStudio;
  if (!bridge) throw new Error('workStudio 未注入');
  const result = await bridge.command(
    'agent',
    `provider/${encodeURIComponent(provider)}`,
    'completeLogin',
    {
      state,
      ...(accessToken ? { accessToken } : {}),
    },
  );
  if (!result.ok) throw new Error(result.error.message);
  if (app) app.textContent = '授权完成，可以关闭此页面。';
}

void complete().catch((error: unknown) => {
  if (app)
    app.textContent = error instanceof Error ? error.message : String(error);
});
