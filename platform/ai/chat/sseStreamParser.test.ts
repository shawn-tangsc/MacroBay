import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { extractSseEvents, tryParseJsonChunk } from './sseStreamParser'

const CHUNKS = [
  'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
  'data: {"choices":[{"delta":{"content":"世界"}}]}\n\n',
  'data: [DONE]\n\n',
  'data: {"choices":[{"delta":{"content":"跨'
]

describe('shared SSE parser', () => {
  it('splits a stream the same way however it is chunked', () => {
    // 一次性喂 vs 逐片喂：完整事件相同，剩下的尾巴也相同。两侧现在都走这一个函数，
    // 所以「只改一处」不再可能——改了这里，两边一起变。
    const atOnce = extractSseEvents(CHUNKS.join(''))
    let buffer = ''
    const incremental: string[] = []
    let remainder = ''
    for (const chunk of CHUNKS) {
      const result = extractSseEvents(buffer + chunk)
      incremental.push(...result.items)
      buffer = result.remainder
      remainder = result.remainder
    }

    expect(atOnce.items).toEqual(incremental)
    expect(atOnce.remainder).toBe('data: {"choices":[{"delta":{"content":"跨')
    expect(remainder).toBe(atOnce.remainder)
  })

  it('keeps multi-line data fields joined and ignores non-data lines', () => {
    const { items } = extractSseEvents('event: ping\ndata: a\ndata: b\n\n')

    expect(items).toEqual(['a\nb'])
  })

  it('returns null for a malformed line instead of throwing', () => {
    expect(tryParseJsonChunk('{"ok":true}')).toEqual({ ok: true })
    expect(tryParseJsonChunk('not json')).toBeNull()
  })
})

describe('one implementation, three readers', () => {
  it('no reader keeps a private copy of the frame splitter', () => {
    const readers = [
      'platform/ai/assistant-platform/runtime/assistantOpenAiStreamClient.ts',
      'platform/ai/agent-platform/runtime/agentChatRuntime.ts',
      'platform/ai/chat/responsesStreamReader.ts'
    ]
    for (const reader of readers) {
      const source = readFileSync(resolve(process.cwd(), reader), 'utf8')
      expect({ reader, privateCopy: /function extractSseEvents\(/.test(source) }).toEqual({
        reader,
        privateCopy: false
      })
      expect(source).toContain('sseStreamParser')
    }
  })
})
