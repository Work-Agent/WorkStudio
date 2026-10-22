// ─── HTML 阅读器插件：注册入口 ───────────────────────────────────────
//
// 源码既是结构化文档也是投影；预览在页面里做，脚本默认关闭。

import { registerCodec, registerConsumer } from '../../main/ura/sdk'
import { MIME } from '../../shared/ura'
import type { Codec, Consumer, DecodedDoc, Patch } from '../../shared/ura'

const DOC_TYPE = 'html-doc@1'
const decoder = new TextDecoder()
const encoder = new TextEncoder()

interface HtmlDoc {
  source: string
}

function sourceOf(decoded: DecodedDoc): string {
  return (decoded.doc as HtmlDoc).source
}

function byteOffset(text: string, index: number): number {
  return encoder.encode(text.slice(0, index)).length
}

const codec: Codec = {
  mime: [MIME.html],
  extensions: ['html', 'htm'],
  hints: ['html'],
  docType: DOC_TYPE,
  patchType: 'text',

  decode(raw) {
    const source = decoder.decode(raw.bytes)
    return {
      docType: DOC_TYPE,
      doc: { source } satisfies HtmlDoc,
      projection: source,
    }
  },

  locate(_decoded, anchor) {
    return { start: anchor.start, end: anchor.end }
  },

  encode(decoded, change): Patch {
    if (change.type === 'replace-all') {
      return {
        type: 'replace-all',
        bytes:
          typeof change.content === 'string'
            ? encoder.encode(change.content)
            : change.content,
      }
    }
    const source = sourceOf(decoded)
    return {
      type: 'replace-range',
      start: byteOffset(source, change.anchor.start),
      end: byteOffset(source, change.anchor.end),
      bytes:
        typeof change.content === 'string'
          ? encoder.encode(change.content)
          : change.content,
      expected: source.slice(change.anchor.start, change.anchor.end),
    }
  },
}

const agentConsumer: Consumer = {
  docType: DOC_TYPE,
  mime: [MIME.html],
  type: 'agent',
  project(decoded) {
    return { type: 'text', content: sourceOf(decoded) }
  },
}

const editorConsumer: Consumer = {
  docType: DOC_TYPE,
  mime: [MIME.html],
  type: 'editor',
  surface: 'html-viewer',
  project(decoded) {
    return {
      type: 'page',
      surface: 'html-viewer',
      page: '',
      data: { text: sourceOf(decoded) },
    }
  },
}

registerCodec(codec)
registerConsumer(agentConsumer)
registerConsumer(editorConsumer)
