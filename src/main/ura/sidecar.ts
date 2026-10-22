// ─── LLM sidecar：与渲染投影并列的文本出口 ──────────────────────────
//
// 不参与 render / edit 的绑定竞争；保证任何 MIME 都有可读文本：
// 已解码投影优先，其次按 MIME 解码文本，最后给出二进制摘要。

import { MIME } from '../../shared/ura'
import type { Sidecar } from '../../shared/ura'
import type { Opened } from './pipeline'

const decoder = new TextDecoder()
const TEXTUAL = new Set<string>([
  MIME.json,
  MIME.xml,
  MIME.yaml,
  MIME.csv,
  MIME.tsv,
])

export function sidecarPresentation(opened: Opened): Sidecar {
  const mapping = opened.decoded?.anchorMap
  if (typeof mapping === 'string') {
    return { type: 'text', content: mapping }
  }
  if (mapping !== undefined) {
    try {
      return { type: 'text', content: JSON.stringify(mapping, null, 2) }
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
