/** 本地文件 mtime（列表分组“最近更新”）；短 TTL 缓存避免每次快照都 stat。 */
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const TTL_MS = 5_000;
const cache = new Map<string, { at: number; value: number | undefined }>();

export async function mtimeOf(ref: string): Promise<number | undefined> {
  if (!ref.startsWith('file://')) return undefined;
  const now = Date.now();
  const hit = cache.get(ref);
  if (hit && now - hit.at < TTL_MS) return hit.value;
  try {
    const info = await stat(fileURLToPath(ref));
    const value = Math.floor(info.mtimeMs);
    cache.set(ref, { at: now, value });
    return value;
  } catch {
    cache.set(ref, { at: now, value: undefined });
    return undefined;
  }
}
