/** 供应商登录：API Key / OAuth 交互经 DialogHost，凭证不经过渲染层。 */
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { DialogHost } from './ui-context.ts';

export interface ModelAuthDeps {
  runtime(): ModelRuntime;
  askDialog(
    dialogType: 'select' | 'input',
    fields: {
      title: string;
      message?: string;
      options?: string[];
      placeholder?: string;
      secret?: boolean;
    },
  ): Promise<string | boolean | undefined>;
  dialogHost(): DialogHost | null;
  notify(
    message: string,
    level: 'info' | 'warning' | 'error',
    source: string,
  ): void;
  openExternal?(url: string): void | Promise<void>;
  emitStatus(): void;
}

export async function loginProvider(
  deps: ModelAuthDeps,
  input: {
    providerId: string;
    type: 'api_key' | 'oauth';
    apiKey?: string;
  },
): Promise<void> {
  const runtime = deps.runtime();
  const provider = runtime.getProvider(input.providerId);
  if (!provider) throw new Error(`未知供应商：${input.providerId}`);
  let keyConsumed = false;
  const infoCards: string[] = [];

  const interaction = {
    prompt: async (prompt: {
      type: string;
      message: string;
      placeholder?: string;
      options?: readonly {
        id: string;
        label: string;
        description?: string;
      }[];
    }): Promise<string> => {
      if (prompt.type === 'secret' && input.apiKey && !keyConsumed) {
        keyConsumed = true;
        return input.apiKey;
      }
      if (prompt.type === 'select' && prompt.options) {
        const labels = prompt.options.map((o) =>
          o.description ? `${o.label} — ${o.description}` : o.label,
        );
        const value = await deps.askDialog('select', {
          title: `登录 ${provider.name}`,
          message: prompt.message,
          options: labels,
        });
        const idx = labels.indexOf(String(value ?? ''));
        if (idx < 0) throw new Error('登录已取消');
        return prompt.options[idx]!.id;
      }
      const value = await deps.askDialog('input', {
        title: `登录 ${provider.name}`,
        message: prompt.message,
        ...(prompt.placeholder ? { placeholder: prompt.placeholder } : {}),
        ...(prompt.type === 'secret' ? { secret: true } : {}),
      });
      if (typeof value !== 'string' || value.length === 0)
        throw new Error('登录已取消');
      return value;
    },
    notify: (event: {
      type: string;
      message?: string;
      url?: string;
      instructions?: string;
      userCode?: string;
      verificationUri?: string;
    }): void => {
      if (event.type === 'auth_url' && event.url) {
        deps.notify(`请在浏览器完成 ${provider.name} 授权`, 'info', '模型登录');
        void deps.openExternal?.(event.url);
        return;
      }
      if (
        event.type === 'device_code' &&
        event.userCode &&
        event.verificationUri
      ) {
        const id = deps.dialogHost()?.info({
          title: `登录 ${provider.name}`,
          message: `请在浏览器中输入授权码：\n\n    ${event.userCode}\n\n页面：${event.verificationUri}\n（授权完成后本卡片自动关闭）`,
        });
        if (id) infoCards.push(id);
        void deps.openExternal?.(event.verificationUri);
        return;
      }
      if (event.message) deps.notify(event.message, 'info', '模型登录');
    },
  };

  try {
    await runtime.login(input.providerId, input.type, interaction as never, {
      agentName: 'WorkStudio',
    });
    await runtime.refresh({
      providers: [input.providerId],
      allowNetwork: true,
    });
    deps.emitStatus();
  } finally {
    for (const id of infoCards) deps.dialogHost()?.dismiss(id);
  }
}
