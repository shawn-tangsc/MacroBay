import { describe, expect, it } from 'vitest'

import { stripQuietRuntimeControlParts } from './messageDataHelpers'

describe('stripQuietRuntimeControlParts', () => {
  it('drops per-token thinking counters from persisted message data', () => {
    const data = {
      parts: [
        { type: 'text', text: 'answer' },
        { type: 'claude-sdk-runtime-control', subtype: 'thinking_tokens' },
        { type: 'claude-sdk-runtime-control', subtype: 'thinking_tokens' },
        { type: 'claude-sdk-runtime-control', subtype: 'api_retry', message: 'retrying' }
      ]
    }

    expect(stripQuietRuntimeControlParts(data)).toEqual({
      parts: [
        { type: 'text', text: 'answer' },
        { type: 'claude-sdk-runtime-control', subtype: 'api_retry', message: 'retrying' }
      ]
    })
  })

  it('returns the original object when there is nothing to strip', () => {
    const data = { parts: [{ type: 'text', text: 'answer' }] }
    expect(stripQuietRuntimeControlParts(data)).toBe(data)
  })
})
