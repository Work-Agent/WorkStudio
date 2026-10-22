// ─── LLM sidecar：与渲染投影并列的文本出口 ──────────────────────────
//
// 不参与 render / edit 的绑定竞争；保证任何 MIME 都有可读文本：
// 已解码投影优先，其次按 MIME 解码文本，最后给出二进制摘要。

import { MIME } from '../../shared/ura'
import type { AgentProjection } from '../../shared/ura'
import type { Opened } from './pipeline'

const decoder = new TextDecoder()
const TEXTUAL = new Set<string>([
  MIME.json,
  MIME.xml,
  MIME.yaml,
  MIME.csv,
  MIME.tsv,
])

export function sidecarProjection(opened: Opened): AgentProjection {
  const projection = opened.decoded?.projection
  if (typeof projection === 'string') {
    return { type: 'text', content: projection }
  }
  if (projection !== undefined) {
    try {
      return { type: 'text', content: JSON.stringify(projection, null, 2) }
    } catch {
      /* fall through */
    }
  }
  const mime = opened.mime ?? opened.raw.mime ?? ''
  if (mime.startsWith('text/') || TEXTUAL.has(mime)) {
    return { type: 'text', content: decoder.decode(opened.raw.bytes) }
  }
  return {
    type: 'text',
    content: `[${mime || 'application/octet-stream'}] ${opened.raw.bytes.length} bytes`,
  }
}
