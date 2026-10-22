// ─── URA 错误面 ──────────────────────────────────────────────────────

export class UraError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'UraError'
  }
}

export class PageNotFoundError extends UraError {
  constructor(surface: string) {
    super('page.not-found', `页面未找到：${surface}`)
    this.name = 'PageNotFoundError'
  }
}
