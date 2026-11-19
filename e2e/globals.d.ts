/** 仅测试环境注入的 legacy 路径垫片。 */
interface Window {
  __e2eBridge?: {
    available(): Promise<boolean>;
    call<T = unknown>(
      path: string,
      input?: unknown,
    ): Promise<
      | { ok: true; data: T }
      | { ok: false; error: { code?: string; message: string } }
    >;
    peek<T = unknown>(path: string): Promise<T | null>;
  };
}
