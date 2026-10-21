// ─── 资源管理型工具（门面的薄封装） ──────────────────────────────────
//
// 7 个工具不含 IO、不含格式解释：解参数 → 调门面 → 格式化结果。
// 统一标识是 ref（scheme://authority/path）；工具不接触路径与句柄。

import { Type } from 'typebox'
import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { Ura } from '../ura/facade'

const refParam = Type.String({
  description:
    'Resource id: scheme://authority/path (e.g. "file:///Users/me/notes.md").',
})

const MAX_LINES = 2000
const MAX_BYTES = 50 * 1024

export function createUraTools(ura: Ura): ToolDefinition[] {
  // ─── read ─────────────────────────────────────────────────
  const readParams = Type.Object({
    ref: refParam,
    offset: Type.Optional(
      Type.Number({ description: 'Line number to start from (1-indexed).' }),
    ),
    limit: Type.Optional(Type.Number({ description: 'Maximum lines to read.' })),
  })
  const readTool = defineTool<typeof readParams, unknown>({
    name: 'read',
    label: '读取资源',
    description:
      'Read a resource by id. Output is truncated to 2000 lines or 50KB; use offset/limit for large resources.',
    parameters: readParams,
    execute: async (_id, { ref, offset, limit }) => {
      const opened = await ura.read(ref, { as: 'agent' })
      if (opened.projection.type !== 'text') {
        return text(`(no text projection: ${ref})`, { ref, error: true })
      }
      const window = sliceLines(opened.projection.content, offset, limit)
      const trailer = window.truncated
        ? `\n\n(truncated: lines ${window.startLine}-${window.endLine} of ${window.totalLines}; continue with offset=${window.endLine + 1})`
        : ''
      return text(window.text + trailer, {
        ref,
        docType: opened.docType,
        version: opened.version,
        degraded: opened.degraded,
        totalLines: window.totalLines,
      })
    },
  })

  // ─── write ────────────────────────────────────────────────
  const writeParams = Type.Object({
    ref: refParam,
    content: Type.String({ description: 'Full content to write.' }),
    expectedVersion: Type.Optional(
      Type.String({ description: 'Fail if the resource version differs.' }),
    ),
  })
  const writeTool = defineTool<typeof writeParams, unknown>({
    name: 'write',
    label: '写入资源',
    description: 'Write the full content of a resource (create or overwrite).',
    parameters: writeParams,
    execute: async (_id, { ref, content, expectedVersion }) => {
      const result = await ura.write(ref, content, {
        ...(expectedVersion ? { expectedVersion } : {}),
      })
      return text(`wrote ${ref} (${result.version})`, {
        ref,
        version: result.version,
      })
    },
  })

  // ─── edit ─────────────────────────────────────────────────
  const editParams = Type.Object({
    ref: refParam,
    start: Type.Number({ description: 'Start offset (inclusive).' }),
    end: Type.Number({ description: 'End offset (exclusive).' }),
    expected: Type.Optional(
      Type.String({ description: 'Baseline slice that must match.' }),
    ),
    content: Type.String({ description: 'Replacement content.' }),
  })
  const editTool = defineTool<typeof editParams, unknown>({
    name: 'edit',
    label: '编辑资源',
    description: 'Replace an anchored range in a resource.',
    parameters: editParams,
    execute: async (_id, { ref, start, end, expected, content }) => {
      const result = await ura.edit(
        ref,
        { start, end, ...(expected !== undefined ? { expected } : {}) },
        content,
      )
      return text(`edited ${ref} (${result.version})`, {
        ref,
        version: result.version,
      })
    },
  })

  // ─── grep ─────────────────────────────────────────────────
  const grepParams = Type.Object({
    pattern: Type.String({ description: 'Regular expression.' }),
    scope: Type.Optional(
      Type.String({ description: 'Resource id to search under.' }),
    ),
    ignoreCase: Type.Optional(Type.Boolean()),
    limit: Type.Optional(Type.Number()),
  })
  const grepTool = defineTool<typeof grepParams, unknown>({
    name: 'grep',
    label: '内容检索',
    description: 'Search resource contents by regular expression.',
    parameters: grepParams,
    execute: async (_id, { pattern, scope, ignoreCase, limit }) => {
      const matches = await ura.grep(pattern, {
        ...(scope ? { scope } : {}),
        ...(ignoreCase ? { ignoreCase } : {}),
        ...(limit ? { limit } : {}),
      })
      const body = matches
        .map((match) => `${match.ref}:${match.line}: ${match.text}`)
        .join('\n')
      return text(body || '(no matches)', { count: matches.length })
    },
  })

  // ─── find ─────────────────────────────────────────────────
  const findParams = Type.Object({
    pattern: Type.String({ description: 'Glob pattern (e.g. "*.md").' }),
    scope: Type.Optional(
      Type.String({ description: 'Resource id to search under.' }),
    ),
    limit: Type.Optional(Type.Number()),
  })
  const findTool = defineTool<typeof findParams, unknown>({
    name: 'find',
    label: '查找资源',
    description: 'Find resources by glob pattern.',
    parameters: findParams,
    execute: async (_id, { pattern, scope, limit }) => {
      const entries = await ura.find(pattern, {
        ...(scope ? { scope } : {}),
        ...(limit ? { limit } : {}),
      })
      return text(
        entries.map((entry) => entry.ref).join('\n') || '(no matches)',
        { count: entries.length },
      )
    },
  })

  // ─── ls ───────────────────────────────────────────────────
  const lsParams = Type.Object({
    ref: refParam,
  })
  const lsTool = defineTool<typeof lsParams, unknown>({
    name: 'ls',
    label: '列出资源',
    description: 'List a directory or container resource.',
    parameters: lsParams,
    execute: async (_id, { ref }) => {
      const entries = await ura.ls(ref)
      const body = entries
        .map((entry) => `${entry.type === 'dir' ? 'd' : '-'} ${entry.name}`)
        .join('\n')
      return text(body || '(empty)', { count: entries.length })
    },
  })

  // ─── query ────────────────────────────────────────────────
  const queryParams = Type.Object({
    ref: refParam,
    select: Type.Optional(Type.Array(Type.String())),
    where: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    limit: Type.Optional(Type.Number()),
  })
  const queryTool = defineTool<typeof queryParams, unknown>({
    name: 'query',
    label: '结构化查询',
    description:
      'Query structured data for a resource. Only resources whose document type declares a data store are queryable.',
    parameters: queryParams,
    execute: async (_id, { ref, select, where, limit }) => {
      const result = await ura.query(ref, {
        ...(select ? { select } : {}),
        ...(where ? { where } : {}),
        ...(limit ? { limit } : {}),
      })
      return text(JSON.stringify(result, null, 2), { ref })
    },
  })

  return [readTool, writeTool, editTool, grepTool, findTool, lsTool, queryTool]
}

function text(payload: string, details: unknown) {
  return {
    content: [{ type: 'text' as const, text: payload }],
    details,
  }
}

function sliceLines(
  content: string,
  offset?: number,
  limit?: number,
): { text: string; totalLines: number; startLine: number; endLine: number; truncated: boolean } {
  const lines = content.split('\n')
  const start = Math.max(0, (offset ?? 1) - 1)
  const count = Math.max(1, limit ?? MAX_LINES)
  const slice = lines.slice(start, start + count)
  let body = slice.join('\n')
  if (body.length > MAX_BYTES) body = body.slice(0, MAX_BYTES)
  const endLine = Math.min(lines.length, start + slice.length)
  return {
    text: body,
    totalLines: lines.length,
    startLine: start + 1,
    endLine,
    truncated: endLine < lines.length || body.length < slice.join('\n').length,
  }
}
