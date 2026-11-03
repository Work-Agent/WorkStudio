/** 业务层失败信封：宿主据此保留错误码。 */
export class RouteFailure extends Error {
  readonly code: 'unknown' | 'denied' | 'invalid' | 'failed';

  constructor(code: RouteFailure['code'], message: string) {
    super(message);
    this.name = 'RouteFailure';
    this.code = code;
  }
}
