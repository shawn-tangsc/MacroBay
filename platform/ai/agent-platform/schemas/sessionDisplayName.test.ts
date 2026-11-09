import { describe, expect, it } from 'vitest'

import { displaySessionName } from './sessionDisplayName'

const runId = 'mi-ar-96eb9b12-005d-4e07-a61c-a98604a962f6'

describe('displaySessionName', () => {
  it('keeps a real name as it is', () => {
    expect(displaySessionName({ id: 'session-1', name: 'Morning Notes' })).toBe('Morning Notes')
  })

  it('returns null when the stored name is the session identity, never the identifier itself', () => {
    // 老的自动会话就是这种行：`name` 落的是运行 id（`c874bd2` 起、`4495b0f` 之前）。
    // 判据是「名字等于自己的身份」，不是「长得像编号」。
    expect(displaySessionName({ id: 'session-1', name: runId, originRef: runId })).toBeNull()
    expect(displaySessionName({ id: runId, name: runId })).toBeNull()
    expect(displaySessionName({ id: 'session-1', name: 'trace-9', traceId: 'trace-9' })).toBeNull()
  })

  it('returns null when there is no name to show', () => {
    expect(displaySessionName({ id: 'session-1', name: '' })).toBeNull()
    expect(displaySessionName({ id: 'session-1', name: '   ' })).toBeNull()
    expect(displaySessionName({ id: 'session-1' })).toBeNull()
  })

  it('trims a reader-visible name instead of showing padding whitespace', () => {
    expect(displaySessionName({ id: 'session-1', name: '  调研  ' })).toBe('调研')
  })
})
