/**
 * ref 身份归一：同一个资源只有一种写法。
 *
 * 标签身份、打开的资源地址、订阅的 key 都取归一后的 ref——否则
 * `file:///a/前.txt` 与 `file:///a/%E5%89%8D.txt` 会被当成两个资源，
 * 同一份文件开出两个标签。非文件协议由插件自己解释，原样保留。
 */

import { fileURLToPath, pathToFileURL } from 'node:url';

export function canonicalRef(ref: string): string {
  if (!ref.startsWith('file:')) return ref;
  try {
    return pathToFileURL(fileURLToPath(ref)).toString();
  } catch {
    return ref;
  }
}
