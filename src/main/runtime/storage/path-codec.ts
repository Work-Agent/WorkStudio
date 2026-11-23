/**
 * 路径编解码（纯模块：只依赖 node:path / node:fs，不引 electron）。
 *
 * 磁盘路径与页面 URL 路径只经「fs 绝对路径」这一中间态互转：
 * 平台规则来自 PlatformPath 实现与一张三平台规则表，调用方不写平台分支、
 * 不手写分隔符。
 *
 * 归属顶层模块的原因：URL 构造与路径编解码在 Node 环境也会被使用，
 * 不能把 electron 拖进依赖链。
 */
import { realpathSync } from 'node:fs';
import path from 'node:path';

/** 平台路径实现：path.win32 与 path.posix 同型。 */
export type PlatformPath = typeof path.win32;

/**
 * 平台规则表。
 *
 * impl 决定语法（分隔符 / 绝对性 / 根形态）；caseInsensitive 决定比较语义：
 * Windows 与 macOS 默认卷大小写不敏感，Linux 敏感（macOS 可挂不敏感卷，故允许覆盖）。
 * realpath 只作「折叠后仍不等」时的真相兜底：符号链接、macOS /tmp → /private/tmp、
 * Windows junction。
 */
export interface PathRules {
  impl: PlatformPath;
  caseInsensitive: boolean;
  realpath?: (file: string) => string;
}

/** URL 侧分隔符：RFC 3986，与平台无关。 */
const URL_SEP = '/';

/** 段内编码：保留冒号（pchar 成员），盘符才能写成可读的 /D:/…。 */
const encodeSegment = (part: string) =>
  encodeURIComponent(part).replace(/%3A/g, ':');

/** 跟随系统的规则表。 */
export const pathRules: PathRules = {
  impl: path,
  caseInsensitive: process.platform !== 'linux',
  realpath: (file) => realpathSync.native(file),
};

export interface PathCodec {
  normalize(file: string): string;
  fsToUrlPath(file: string): string;
  urlPathToFs(pathname: string): string;
  fsToFileUrl(file: string): string;
  refToFs(ref: { authority: string; path: string }): string;
  isWithin(dir: string, file: string): boolean;
}

/**
 * 路径编解码器。
 *
 * 不变量：唯一中间态是本机绝对路径；URL 侧分隔符恒为 '/'、段内编码；
 * 平台细节一律问 rules.impl（parse().root 统一盘符 / UNC / POSIX 根）。
 */
export function createPathCodec(rules: PathRules = pathRules): PathCodec {
  const { impl } = rules;
  const fold = (file: string) =>
    rules.caseInsensitive ? file.toLowerCase() : file;
  const escapes = (rel: string) =>
    rel === '..' || rel.startsWith(`..${impl.sep}`) || impl.isAbsolute(rel);

  const normalize = (file: string): string => impl.normalize(file);

  /**
   * fs 绝对路径 → URL 路径（恒以 '/' 开头、段内百分号编码）。
   *
   * UNC（impl 的根以双分隔符开头）在 URL 里表达为双斜杠，由调用方决定拒绝或扩展。
   */
  const fsToUrlPath = (file: string): string => {
    if (!impl.isAbsolute(file)) throw new Error(`not absolute: ${file}`);
    const absolute = impl.normalize(file);
    const root = impl.parse(absolute).root;
    const parts = [
      ...root.split(impl.sep).filter(Boolean),
      ...absolute.slice(root.length).split(impl.sep).filter(Boolean),
    ];
    const prefix = root.startsWith(impl.sep.repeat(2))
      ? URL_SEP.repeat(2)
      : URL_SEP;
    return prefix + parts.map((part) => encodeSegment(part)).join(URL_SEP);
  };

  /**
   * URL 路径 → fs 绝对路径。
   *
   * URL 侧恒以 '/' 分段，拼回时用 impl.sep；首段是否构成根由 impl.parse().root
   * 判定（盘符与 POSIX 根都不再补分隔符）。空路径与非法编码抛错。
   */
  const urlPathToFs = (pathname: string): string => {
    const decoded = decodeURIComponent(pathname);
    const parts = decoded.split(URL_SEP).filter(Boolean);
    if (parts.length === 0) throw new Error(`empty path: ${pathname}`);
    const joined = parts.join(impl.sep);
    if (decoded.startsWith(URL_SEP.repeat(2)))
      return impl.normalize(impl.sep.repeat(2) + joined);
    return impl.normalize(impl.parse(joined).root ? joined : impl.sep + joined);
  };

  /**
   * fs 绝对路径 → file URL（渲染层页面用）。
   *
   * UNC 没有可用的 file URL 形态（host 位被协议占用），直接拒绝而不是静默产出错地址。
   */
  const fsToFileUrl = (file: string): string => {
    const urlPath = fsToUrlPath(file);
    if (urlPath.startsWith(URL_SEP.repeat(2)))
      throw new Error(`UNC is not addressable as file URL: ${file}`);
    return `file://${urlPath}`;
  };

  /**
   * 资源标识的两个段（authority / path）→ fs 绝对路径。
   *
   * 标识本身的解析（scheme 判定、非法格式）由 ura 层负责；这里只把
   * authority 非空（UNC）还原为双分隔符前缀。
   */
  const refToFs = (ref: { authority: string; path: string }): string => {
    const pathname = ref.authority
      ? URL_SEP.repeat(2) + ref.authority + ref.path
      : ref.path;
    return urlPathToFs(pathname);
  };

  /**
   * 归属判断：file 是否位于 dir 之内（含 dir 自身）。
   *
   * 折叠大小写后求相对路径，跨根即越界；折叠后仍判越界且规则不敏感时，
   * 才用 realpath 复核「是否其实是同一实体」。
   */
  const isWithin = (dir: string, file: string): boolean => {
    const from = normalize(dir);
    const to = normalize(file);
    const rel = impl.relative(fold(from), fold(to));
    if (rel === '' || !escapes(rel)) return true;
    if (!rules.caseInsensitive || !rules.realpath) return false;
    try {
      const real = impl.relative(
        fold(rules.realpath(from)),
        fold(rules.realpath(to)),
      );
      return real === '' || !escapes(real);
    } catch {
      return false;
    }
  };

  return {
    normalize,
    fsToUrlPath,
    urlPathToFs,
    fsToFileUrl,
    refToFs,
    isWithin,
  };
}

/** 生产实例：跟随系统。 */
export const pathCodec = createPathCodec();

/** 生产实例的常用入口（归属判断）。 */
export const { isWithin } = pathCodec;
