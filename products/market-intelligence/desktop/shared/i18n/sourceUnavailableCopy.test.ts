import { describe, expect, it } from 'vitest'

import { looksLikeReasonCode, sourceUnavailableSentence } from './sourceUnavailableCopy'

describe('source unavailable copy', () => {
  it('turns a known reason code into the reader sentence', () => {
    expect(sourceUnavailableSentence('official-endpoint-returned-403', '取不到（原因见详情）'))
      .toBe('官方源暂时不可用（403）')
  })

  it('never leaks the code when the mapping has no entry', () => {
    // 码名一改就落到这一支：正文必须是兜底人话，**不许出现 `-` 连接的码串**。
    const sentence = sourceUnavailableSentence('endpoint-vanished-somewhere', '取不到（原因见详情）')
    expect(sentence).toBe('取不到（原因见详情）')
    expect(sentence).not.toContain('endpoint-vanished-somewhere')
    expect(sentence).not.toMatch(/[a-z0-9]+-[a-z0-9]+/u)
    expect(sentence.includes('-')).toBe(false)
  })

  it('recognises a code shape, so callers can refuse to print one', () => {
    expect(looksLikeReasonCode('official-endpoint-returned-403')).toBe(true)
    expect(looksLikeReasonCode('官方源暂时不可用（403）')).toBe(false)
  })
})
