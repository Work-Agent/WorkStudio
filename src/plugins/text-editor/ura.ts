// ─── 文本编辑器插件：注册入口 ────────────────────────────────────────
//
// 一个插件只声明自己提供的能力：一个格式（纯文本）+ 两个出口（agent / editor）。
// 模块求值时注册；页面入口由清单的 workstudio.page 解析。

import { registerCodec, registerConsumer } from '../../main/ura/sdk'
import type { Change, Codec, Consumer, DecodedDoc, Patch } from '../../shared/ura'

const DOC_TYPE = 'text-doc@1' as const
const decoder = new TextDecoder()
const encoder = new TextEncoder()

interface TextDoc {
  text: string
}

function textOf(decoded: DecodedDoc): string {
  return (decoded.doc as TextDoc).text
}

/** 文本偏移 → UTF-8 字节偏移。 */
function byteOffset(text: string, index: number): number {
  return encoder.encode(text.slice(0, index)).length
}

const codec: Codec = {
  hints: ['text'],
  docType: DOC_TYPE,
  patchKind: 'text',

  decode(raw) {
    const text = decoder.decode(raw.bytes)
    return {
      docType: DOC_TYPE,
      doc: { text } satisfies TextDoc,
      projection: text,
    }
  },

  locate(_decoded, anchor) {
    return { start: anchor.start, end: anchor.end }
  },

  encode(decoded, change: Change): Patch {
    if (change.kind === 'replace-all') {
      const bytes =
        typeof change.content === 'string'
          ? encoder.encode(change.content)
          : change.content
      return { kind: 'replace-all', bytes }
    }
    const text = textOf(decoded)
    const start = byteOffset(text, change.anchor.start)
    const end = byteOffset(text, change.anchor.end)
    const bytes =
      typeof change.content === 'string'
        ? encoder.encode(change.content)
        : change.content
    return {
      kind: 'replace-range',
      start,
      end,
      bytes,
      expected: text.slice(change.anchor.start, change.anchor.end),
    }
  },
}

const agentConsumer: Consumer = {
  docType: DOC_TYPE,
  kind: 'agent',
  project(decoded) {
    return { kind: 'text', content: textOf(decoded) }
  },
}

const editorConsumer: Consumer = {
  docType: DOC_TYPE,
  kind: 'editor',
  surface: 'text-editor',
  project(decoded) {
    return {
      kind: 'page',
      surface: 'text-editor',
      page: '',
      data: { text: textOf(decoded), language: 'plaintext' },
    }
  },
}

registerCodec(codec)
registerConsumer(agentConsumer)
registerConsumer(editorConsumer)
