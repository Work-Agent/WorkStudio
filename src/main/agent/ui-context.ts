/**
 * AgentUIContext —— pi ExtensionUIContext 的桌面实现（agent-design.md §五）。
 *
 * 对话框：DialogHost 请求/应答（pending 表 + timeout + abort，取消值诚实结算）；
 * 状态族：写入内存快照（ws:sync 重放），TUI 专属能力明确降级（no-op）；
 * 通知/编辑器镜像：注入回调 → AgentHost → ws:ui / 事件。
 */
import type {
  ExtensionUIContext,
  ExtensionUIDialogOptions,
} from '@earendil-works/pi-coding-agent';
import { Theme } from '@earendil-works/pi-coding-agent';
import type {
  UiDialogType,
  UiDialogRequest,
  UiDialogResponse,
} from '../../shared/types';

// ─── 对话框宿主 ───────────────────────────────────────────

/** 各 type 的契约取消值（永不伪造「第一项 / 空串」当用户输入）。 */
const CANCEL_VALUE: Record<UiDialogType, string | boolean | undefined> = {
  select: undefined,
  input: undefined,
  editor: undefined,
  confirm: false,
};

type ResolvedReason =
  | 'answered'
  | 'cancelled'
  | 'timeout'
  | 'aborted'
  | 'sessionClosed';

interface PendingEntry {
  request: UiDialogRequest;
  resolve: (value: string | boolean | undefined) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
  signal: AbortSignal | undefined;
  onAbort: (() => void) | undefined;
  settled: boolean;
}

export interface DialogHostListeners {
  /** 请求分发（→ 浮层视图）。 */
  onRequest: (req: UiDialogRequest) => void;
  /** 结算广播（应答 / 取消 / 超时 / 中止 / 会话关闭；渲染层撤卡）。 */
  onResolved: (id: string, reason: ResolvedReason) => void;
}

export class DialogHost {
  private pending = new Map<string, PendingEntry>();
  private seq = 0;

  constructor(
    private readonly sessionId: string,
    private readonly listeners: DialogHostListeners,
  ) {}

  ask(
    dialogType: UiDialogType,
    fields: {
      title: string;
      message?: string;
      options?: string[];
      placeholder?: string;
      prefill?: string;
      /** 密文输入（登录凭证等；值不回显）。 */
      secret?: boolean;
    },
    opts?: ExtensionUIDialogOptions,
  ): Promise<string | boolean | undefined> {
    const id = `dlg-${this.sessionId}-${this.seq++}`;
    const request: UiDialogRequest = {
      type: 'dialog',
      id,
      dialogType,
      title: fields.title,
      ...(fields.message !== undefined ? { message: fields.message } : {}),
      ...(fields.options !== undefined ? { options: fields.options } : {}),
      ...(fields.placeholder !== undefined
        ? { placeholder: fields.placeholder }
        : {}),
      ...(fields.prefill !== undefined ? { prefill: fields.prefill } : {}),
      ...(fields.secret ? { secret: true } : {}),
      ...(opts?.timeout !== undefined ? { timeoutMs: opts.timeout } : {}),
    };
    // 请求到达前已中止：不 dispatch，直接按取消结算（fail-closed）。
    if (opts?.signal?.aborted) {
      this.listeners.onResolved(id, 'aborted');
      return Promise.resolve(CANCEL_VALUE[dialogType]);
    }
    return new Promise((resolve) => {
      const entry: PendingEntry = {
        request,
        resolve,
        timer: undefined,
        signal: opts?.signal,
        onAbort: undefined,
        settled: false,
      };
      if (opts?.timeout !== undefined && opts.timeout > 0) {
        entry.timer = setTimeout(
          () => this.settle(id, 'timeout'),
          opts.timeout,
        );
      }
      if (opts?.signal) {
        entry.onAbort = () => this.settle(id, 'aborted');
        opts.signal.addEventListener('abort', entry.onAbort, { once: true });
      }
      this.pending.set(id, entry);
      this.listeners.onRequest(request);
    });
  }

  /**
   * 信息卡（纯展示，不参与登录/扩展决策）：返回请求 id，调用方在流程结束后
   * 用 dismiss(id) 撤卡。用户点击确认也走同一结算路径（幂等）。
   */
  info(fields: { title: string; message?: string }): string {
    const id = `dlg-${this.sessionId}-${this.seq++}`;
    const request: UiDialogRequest = {
      type: 'dialog',
      id,
      dialogType: 'confirm',
      title: fields.title,
      ...(fields.message !== undefined ? { message: fields.message } : {}),
    };
    this.pending.set(id, {
      request,
      resolve: () => {},
      timer: undefined,
      signal: undefined,
      onAbort: undefined,
      settled: false,
    });
    this.listeners.onRequest(request);
    return id;
  }

  /** 撤下信息卡 / 以取消结算挂起请求（渲染层收到 onResolved 后移除卡片）。 */
  dismiss(id: string): void {
    this.settle(id, 'cancelled');
  }

  /** 用户应答（渲染层；confirm 非 true 一律 false，fail-closed）。 */
  respond(response: UiDialogResponse): void {
    const entry = this.pending.get(response.id);
    if (!entry || entry.settled) return;
    if (response.cancelled) {
      this.settle(response.id, 'cancelled');
      return;
    }
    if (entry.request.dialogType === 'confirm') {
      this.settle(response.id, 'answered', response.confirmed === true);
    } else {
      this.settle(
        response.id,
        'answered',
        typeof response.value === 'string'
          ? response.value
          : CANCEL_VALUE[entry.request.dialogType],
      );
    }
  }

  /** 会话关闭兜底（扩展 Promise 落取消值，agent 不悬挂）。 */
  dispose(): void {
    for (const id of this.pending.keys()) this.settle(id, 'sessionClosed');
  }

  private settle(
    requestId: string,
    reason: ResolvedReason,
    value?: string | boolean,
  ): void {
    const entry = this.pending.get(requestId);
    if (!entry || entry.settled) return;
    entry.settled = true;
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    if (entry.signal && entry.onAbort)
      entry.signal.removeEventListener('abort', entry.onAbort);
    this.pending.delete(requestId);
    entry.resolve(
      value !== undefined ? value : CANCEL_VALUE[entry.request.dialogType],
    );
    this.listeners.onResolved(requestId, reason);
  }
}

// ─── ExtensionUIContext ───────────────────────────────────

/** 中性暗色盘（桌面端不消费 ANSI；对象必须真实，扩展会直接调用 fg()/bold() 等方法）。 */
const EXTENSION_THEME = new Theme(
  {
    accent: '#7aa2f7',
    border: '#3b4261',
    borderAccent: '#7aa2f7',
    borderMuted: '#292e42',
    success: '#9ece6a',
    error: '#f7768e',
    warning: '#e0af68',
    muted: '#78849b',
    dim: '#565f89',
    text: '#c0caf5',
    thinkingText: '#9d7cd8',
    userMessageText: '#c0caf5',
    customMessageText: '#c0caf5',
    customMessageLabel: '#7aa2f7',
    toolTitle: '#7dcfff',
    toolOutput: '#a9b1d6',
    mdHeading: '#7aa2f7',
    mdLink: '#7dcfff',
    mdLinkUrl: '#565f89',
    mdCode: '#9ece6a',
    mdCodeBlock: '#a9b1d6',
    mdCodeBlockBorder: '#3b4261',
    mdQuote: '#a9b1d6',
    mdQuoteBorder: '#3b4261',
    mdHr: '#3b4261',
    mdListBullet: '#7dcfff',
    toolDiffAdded: '#9ece6a',
    toolDiffRemoved: '#f7768e',
    toolDiffContext: '#565f89',
    syntaxComment: '#565f89',
    syntaxKeyword: '#bb9af7',
    syntaxFunction: '#7aa2f7',
    syntaxVariable: '#e0af68',
    syntaxString: '#9ece6a',
    syntaxNumber: '#ff9e64',
    syntaxType: '#2ac3de',
    syntaxOperator: '#89ddff',
    syntaxPunctuation: '#c0caf5',
    thinkingOff: '#565f89',
    thinkingMinimal: '#6183bb',
    thinkingLow: '#7aa2f7',
    thinkingMedium: '#89ddff',
    thinkingHigh: '#b4f9f8',
    thinkingXhigh: '#d2e5ff',
    bashMode: '#e0af68',
  },
  {
    selectedBg: '#33467c',
    userMessageBg: '#24283b',
    customMessageBg: '#1f2335',
    toolPendingBg: '#2f334d',
    toolSuccessBg: '#20303b',
    toolErrorBg: '#2d202a',
  },
  'truecolor',
  { name: 'work-studio' },
);

/** 从 Error stack 推断调用方扩展名（notify / 编辑器镜像的展示归因）。 */
export function extensionNameFromStack(stack: string): string {
  for (const line of stack.split('\n')) {
    if (
      line.includes('@earendil-works') ||
      line.includes('node_modules/jiti/') ||
      line.includes('ui-context')
    ) {
      continue;
    }
    const ext = line.match(
      /\/extensions\/([^/()\s]+?)\.(?:tsx?|mjs|cjs|js)(?:[?#:]|$)/,
    );
    if (ext?.[1] && ext[1] !== 'index') return ext[1];
    const pkg = line.match(/node_modules\/((?:@[\w.-]+\/)?[\w.-]+)\//);
    if (pkg?.[1]) return pkg[1];
  }
  return '';
}

export interface UiContextDeps {
  /** 对话框宿主（每会话一个）；缺省 = 契约取消值。 */
  dialogs?: DialogHost;
  /** notify → 壳层提示。 */
  onNotify?: (
    message: string,
    level: 'info' | 'warning' | 'error',
    source: string,
  ) => void;
  /** 编辑器镜像（setEditorText / pasteToEditor）。 */
  onEditorText?: (text: string, source: string) => void;
}

/** 构造 ExtensionUIContext（状态族进快照由 AgentHost 收集，本层只实现契约）。 */
export function makeUiContext(deps: UiContextDeps = {}): ExtensionUIContext {
  const source = (): string => extensionNameFromStack(new Error().stack ?? '');
  return {
    select: (title, options, opts) =>
      deps.dialogs
        ? deps.dialogs
            .ask('select', { title, options }, opts)
            .then((v) => (typeof v === 'string' ? v : undefined))
        : Promise.resolve(undefined),
    confirm: (title, message, opts) =>
      deps.dialogs
        ? deps.dialogs
            .ask('confirm', { title, message }, opts)
            .then((v) => v === true)
        : Promise.resolve(false),
    input: (title, placeholder, opts) =>
      deps.dialogs
        ? deps.dialogs
            .ask(
              'input',
              placeholder ? { title, placeholder } : { title },
              opts,
            )
            .then((v) => (typeof v === 'string' ? v : undefined))
        : Promise.resolve(undefined),
    editor: (title, prefill) =>
      deps.dialogs
        ? deps.dialogs
            .ask('editor', prefill ? { title, prefill } : { title }, undefined)
            .then((v) => (typeof v === 'string' ? v : undefined))
        : Promise.resolve(undefined),
    notify: (message, type) =>
      deps.onNotify?.(message, type ?? 'info', source()),
    onTerminalInput: () => () => {},
    setStatus: () => {},
    setWorkingMessage: () => {},
    setWorkingVisible: () => {},
    setWorkingIndicator: () => {},
    setHiddenThinkingLabel: () => {},
    setWidget: () => {},
    setFooter: () => {},
    setHeader: () => {},
    setTitle: () => {},
    custom: (async () => undefined) as ExtensionUIContext['custom'],
    pasteToEditor: (text) => deps.onEditorText?.(text, source()),
    setEditorText: (text) => deps.onEditorText?.(text, source()),
    getEditorText: () => '',
    addAutocompleteProvider: () => {},
    setEditorComponent: () => {},
    getEditorComponent: () => undefined,
    theme: EXTENSION_THEME,
    getAllThemes: () => [],
    getTheme: () => undefined,
    // 主题主权归宿主（诚实降级，不假成功）。
    setTheme: () => ({
      success: false,
      error: 'Theme switching is managed by WorkStudio',
    }),
    getToolsExpanded: () => false,
    setToolsExpanded: () => {},
  };
}
