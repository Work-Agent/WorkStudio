// ─── 内置来源：http(s) ──────────────────────────────────────────────
//
// 共享浏览器 partition 的 session（cookie / 代理 / 认证）；
// 格式提示来自响应 Content-Type，URL 扩展名兜底；不做内容嗅探。
// 只读：API 变更属于操作型能力，不走资源写入。

import { createHash } from 'node:crypto';
import { session } from 'electron';
import type {
  Mime,
  RawContent,
  ResourceStat,
  Transport,
  TransportCapability,
  TransportId,
  TransportWriteOptions,
  TransportWriteResult,
} from '../../../../../shared/ura.ts';
import {
  MIME,
  mimeFromExtension,
  parseContentType,
} from '../../../../../shared/ura.ts';
import { UraError } from '../errors.ts';

const PARTITION = 'persist:workstudio:browser';

export class HttpTransport implements Transport {
  readonly id: TransportId;
  readonly capabilities: readonly TransportCapability[] = ['read', 'live'];

  constructor(readonly scheme: 'http' | 'https') {
    this.id = scheme;
  }

  async stat(ref: string): Promise<ResourceStat> {
    const response = await this.net().fetch(ref, { method: 'HEAD' });
    if (!response.ok) {
      throw new UraError('http.status', `HTTP ${response.status}: ${ref}`);
    }
    const length = Number(response.headers.get('content-length') ?? 0);
    return {
      version: versionOf(response, null),
      type: 'file',
      size: Number.isFinite(length) ? length : 0,
    };
  }

  async read(ref: string): Promise<RawContent> {
    const response = await this.net().fetch(ref);
    if (!response.ok) {
      throw new UraError('http.status', `HTTP ${response.status}: ${ref}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const contentType = response.headers.get('content-type');
    return {
      bytes,
      version: versionOf(response, bytes),
      type: 'file',
      size: bytes.length,
      mime: mimeOf(contentType, ref),
    };
  }

  async write(
    _ref: string,
    _patch: never,
    _opts: TransportWriteOptions,
  ): Promise<TransportWriteResult> {
    throw new UraError('transport.read-only', 'http 来源只读');
  }

  async list(): Promise<never> {
    throw new UraError('transport.no-list', 'http 来源不支持列目录');
  }

  private net(): Electron.Session {
    return session.fromPartition(PARTITION);
  }
}

/**
 * 响应 MIME：以 Content-Type 为准；缺失或只给出 `application/octet-stream` 时，
 * 按 URL 扩展名兜底（远端静态资源的常见情况），仍不命中就是 octet-stream。
 */
function mimeOf(contentType: string | null, url: string): Mime {
  const declared = parseContentType(contentType).mime;
  if (declared !== MIME.octetStream) return declared;
  let pathname = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url;
  }
  const index = pathname.lastIndexOf('.');
  const ext = index < 0 ? '' : pathname.slice(index + 1).toLowerCase();
  return (ext && mimeFromExtension(ext)) || declared;
}

function versionOf(response: Response, bytes: Uint8Array | null): string {
  const etag = response.headers.get('etag');
  if (etag) return `etag:${etag.replace(/^W\//, '').replace(/"/g, '')}`;
  const modified = response.headers.get('last-modified');
  if (modified) return `lm:${modified}`;
  return `hash:${createHash('sha1')
    .update(bytes ?? new Uint8Array())
    .digest('hex')
    .slice(0, 16)}`;
}
