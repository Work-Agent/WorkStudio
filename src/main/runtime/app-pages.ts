import { statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { net, type Session } from 'electron';
import { pathCodec } from '../infrastructure/path-codec.ts';

export function serveAppPages(
  target: Session,
  pageSessions: WeakSet<Session>,
): void {
  if (pageSessions.has(target)) return;
  pageSessions.add(target);
  target.protocol.handle('app', async (request) => {
    const file = appPageFile(request.url);
    if (!file || !isFile(file)) return notFound();
    try {
      return await net.fetch(pathToFileURL(file).toString());
    } catch {
      return notFound();
    }
  });
}

/**
 * `app://page/<fs 绝对路径>` → fs 绝对路径。
 *
 * URL 路径与磁盘路径的互换（盘符 / UNC / 段内编码）一律交给 pathCodec：
 * 手写 `decodeURIComponent(pathname)` 在 Windows 上会留下盘符前的斜杠
 * （`/D:/…`），那不是可达的磁盘路径。非法地址（宿主不对 / 空路径 /
 * 编码错误）返回 null。
 */
function appPageFile(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'page') return null;
    return pathCodec.urlPathToFs(parsed.pathname);
  } catch {
    return null;
  }
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function notFound(): Response {
  return new Response('Not found', { status: 404 });
}
