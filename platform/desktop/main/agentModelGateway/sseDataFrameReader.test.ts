import { describe, expect, it } from 'vitest'

import { createSseDataFrameReader, type SseDataFrame } from './sseDataFrameReader'

const stream = [
  'data: {"id":"a"}\n\n',
  ': keep-alive\n',
  'data: {"id":"b"}\n\n',
  'event: ping\n',
  'data:  \n',
  'data: [DONE]\n\n',
  'data: {"id":"after-done"}\n\n'
].join('')

function readAll(chunks: readonly string[]): SseDataFrame[] {
  const reader = createSseDataFrameReader()
  return chunks.flatMap((chunk) => reader.push(chunk))
}

describe('sseDataFrameReader', () => {
  it('yields the same frames whether the stream arrives whole or in pieces', () => {
    const whole = readAll([stream])
    const bytewise = readAll([...stream])

    expect(bytewise).toEqual(whole)
  })

  it('keeps data payloads in order and reports the done marker once', () => {
    expect(readAll([stream])).toEqual([
      { kind: 'data', payload: '{"id":"a"}' },
      { kind: 'data', payload: '{"id":"b"}' },
      { kind: 'done' },
      { kind: 'data', payload: '{"id":"after-done"}' }
    ])
  })

  it('ignores comments, event lines and empty payloads', () => {
    const frames = readAll([': comment\n', 'event: ping\n', 'data:\n', 'data:   \n'])

    expect(frames).toEqual([])
  })

  it('holds a partial line until the rest arrives', () => {
    const reader = createSseDataFrameReader()

    expect(reader.push('data: {"id"')).toEqual([])
    expect(reader.push(':"a"}\n')).toEqual([{ kind: 'data', payload: '{"id":"a"}' }])
  })
})
