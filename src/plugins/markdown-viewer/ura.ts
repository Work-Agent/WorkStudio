// ─── Markdown 阅读器插件：注册入口 ───────────────────────────────────
//
// 格式提示 markdown（比 text 具体，先命中）；结构化文档保留源码，
// 渲染是页面出口的事，不在管道里做。

import { registerCodec, registerPresenter, registerSidecar } from '../../main/ura/sdk'
import { MIME } from '../../shared/ura'
import type { Codec, DecodedDoc, Patch, Presenter, SidecarProvider } from '../../shared/ura'

const DOC_TYPE = 'markdown-doc@1'
const decoder = new TextDecoder()
const encoder = new TextEncoder()

interface MarkdownDoc {
  source: string
}

function sourceOf(decoded: DecodedDoc): string {
  return (decoded.doc as MarkdownDoc).source
}

function byteOffset(text: string, index: number): number {
  return encoder.encode(text.slice(0, index)).length
}

const codec: Codec = {
  mime: [MIME.markdown],
  extensions: ['md', 'markdown'],
  hints: ['markdown'],
  docType: DOC_TYPE,
  patchType: 'text',

  decode(raw) {
    const source = decoder.decode(raw.bytes)
    return {
      docType: DOC_TYPE,
      doc: { source } satisfies MarkdownDoc,
      anchorMap: source,
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

const agentSidecar: SidecarProvider = {
  docType: DOC_TYPE,
  mime: [MIME.markdown],
  sidecar(decoded) {
    return { type: 'text', content: sourceOf(decoded) }
  },
}

const editorPresenter: Presenter = {
  docType: DOC_TYPE,
  mime: [MIME.markdown],
  type: 'page',
  surface: 'markdown-viewer',
  present(decoded) {
    return {
      type: 'page',
      surface: 'markdown-viewer',
      page: '',
      data: { text: sourceOf(decoded) },
    }
  },
}

registerCodec(codec)
registerSidecar(agentSidecar)
registerPresenter(editorPresenter)
