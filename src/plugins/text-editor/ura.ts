// ─── 文本编辑器插件：注册入口 ────────────────────────────────────────
//
// 一个插件只声明自己提供的能力：一个格式（纯文本）+ 两个出口（agent / editor）。
// 模块求值时注册；页面入口由清单的 workstudio.page 解析。

import { registerCodec, registerPresenter, registerSidecar } from '../../main/ura/sdk'
import { MIME } from '../../shared/ura'
import type { Change, Codec, DecodedDoc, Patch, Presenter, SidecarProvider } from '../../shared/ura'

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
  mime: [MIME.text],
  hints: ['text'],
  docType: DOC_TYPE,
  patchType: 'text',

  decode(raw) {
    const text = decoder.decode(raw.bytes)
    return {
      docType: DOC_TYPE,
      doc: { text } satisfies TextDoc,
      anchorMap: text,
    }
  },

  locate(_decoded, anchor) {
    return { start: anchor.start, end: anchor.end }
  },

  encode(decoded, change: Change): Patch {
    if (change.type === 'replace-all') {
      const bytes =
        typeof change.content === 'string'
          ? encoder.encode(change.content)
          : change.content
      return { type: 'replace-all', bytes }
    }
    const text = textOf(decoded)
    const start = byteOffset(text, change.anchor.start)
    const end = byteOffset(text, change.anchor.end)
    const bytes =
      typeof change.content === 'string'
        ? encoder.encode(change.content)
        : change.content
    return {
      type: 'replace-range',
      start,
      end,
      bytes,
      expected: text.slice(change.anchor.start, change.anchor.end),
    }
  },
}

const agentSidecar: SidecarProvider = {
  docType: DOC_TYPE,
  mime: [MIME.text],
  sidecar(decoded) {
    return { type: 'text', content: textOf(decoded) }
  },
}

const editorPresenter: Presenter = {
  docType: DOC_TYPE,
  mime: [MIME.text],
  type: 'page',
  surface: 'text-editor',
  present(decoded) {
    return {
      type: 'page',
      surface: 'text-editor',
      page: '',
      data: { text: textOf(decoded), language: 'plaintext' },
    }
  },
}

registerCodec(codec)
registerSidecar(agentSidecar)
registerPresenter(editorPresenter)
