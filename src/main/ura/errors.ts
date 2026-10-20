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

/** 来源侧版本校验失败（严格模式）。 */
export class VersionConflictError extends Error {
  constructor(readonly currentVersion: string) {
    super('version conflict')
    this.name = 'VersionConflictError'
  }
}

export class PageNotFoundError extends UraError {
  constructor(surface: string) {
    super('page.not-found', `页面未找到：${surface}`)
    this.name = 'PageNotFoundError'
  }
}
