import { pathCodec } from '../infrastructure/path-codec.ts';

/** 文件系统绝对路径 → app://page URL。 */
export function appPageUrl(file: string): string {
  return `app://page${pathCodec.fsToUrlPath(file)}`;
}
