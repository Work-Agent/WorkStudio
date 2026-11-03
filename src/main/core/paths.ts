/**
 * 路径工具：拼接、参数填充、模板匹配、授权模式匹配。
 *
 * 全是纯函数：路由表、状态键、授权表、页面提供者共用同一套匹配语义。
 */

import type { Params } from './types';

/** 拆段：'/a/b/' → ['a','b']；'/' → []。 */
export function split(path: string): string[] {
  return path.split('/').filter((segment) => segment.length > 0);
}

/** 拼接任意段，结果总以 '/' 开头且无尾斜杠。 */
export function join(...parts: string[]): string {
  const segments: string[] = [];
  for (const part of parts) {
    for (const segment of split(part)) segments.push(segment);
  }
  return `/${segments.join('/')}`;
}

/** 规范化：'/a//b/' → '/a/b'。 */
export function normalize(path: string): string {
  return join(path);
}

/** 模板参数填充：'/pages/:pageId' + { pageId } → '/pages/p1'。 */
export function fill(template: string, params: Params = {}): string {
  const segments = split(template).map((segment) => {
    if (!segment.startsWith(':')) return segment;
    const name = segment.slice(1);
    const value = params[name];
    if (value === undefined || value === null || value === '') {
      throw new Error(`missing path param "${name}" for ${template}`);
    }
    return String(value);
  });
  return `/${segments.join('/')}`;
}

/** 模板匹配：段数必须一致，':name' 匹配任意单段。 */
export function match(template: string, path: string): Params | null {
  const expected = split(template);
  const actual = split(path);
  if (expected.length !== actual.length) return null;
  const params: Params = {};
  for (let index = 0; index < expected.length; index += 1) {
    const segment = expected[index];
    if (segment.startsWith(':')) {
      params[segment.slice(1)] = actual[index];
      continue;
    }
    if (segment !== actual[index]) return null;
  }
  return params;
}

/**
 * 授权模式匹配：支持末尾 `**` 前缀通配。
 * '/workspaces/:wsId/**' 命中 '/workspaces/w1/lists/sidebar'。
 */
export function matchPattern(pattern: string, path: string): boolean {
  const expected = split(pattern);
  const actual = split(path);
  for (let index = 0; index < expected.length; index += 1) {
    const segment = expected[index];
    if (segment === '**') return actual.length >= index;
    if (index >= actual.length) return false;
    if (segment.startsWith(':')) continue;
    if (segment !== actual[index]) return false;
  }
  return expected.length === actual.length;
}

/** 具体路径是否等于前缀或位于其下（用于键清理与归属校验）。 */
export function within(prefix: string, path: string): boolean {
  if (prefix === '/' || prefix === '') return true;
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** 模板的静态段数量：越大越具体，用于匹配优先级。 */
export function specificity(template: string): number {
  return split(template).filter((segment) => !segment.startsWith(':')).length;
}

/** 视图自述路径中的 `self` 代换为具体视图 id。 */
export function substituteSelf(path: string, viewId: string): string {
  const segments = split(path).map((segment) =>
    segment === 'self' ? viewId : segment,
  );
  return `/${segments.join('/')}`;
}

/** 插件 / 设置页的 app:// 地址：只编码路径段，保留斜杠。 */
export function appPageUrl(file: string): string {
  const normalized = file.replace(/\\/g, '/');
  return `app://page${normalized
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`;
}
