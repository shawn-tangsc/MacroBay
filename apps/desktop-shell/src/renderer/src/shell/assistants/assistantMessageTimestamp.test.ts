import { describe, expect, it } from 'vitest'

import { formatAssistantMessageTimestamp } from './assistantMessageTimestamp'

describe('formatAssistantMessageTimestamp', () => {
  const now = new Date(2026, 6, 19, 12, 0, 0)

  it('formats same-day timestamps to local minute precision in both supported languages', () => {
    const createdAt = new Date(2026, 6, 19, 9, 5, 0).toISOString()

    expect(formatAssistantMessageTimestamp(createdAt, 'zh-CN', now)).toBe('09:05')
    expect(formatAssistantMessageTimestamp(createdAt, 'en-US', now)).toBe('09:05')
  })

  it('includes a localized short date for a timestamp outside today', () => {
    const createdAt = new Date(2026, 6, 18, 9, 5, 0).toISOString()

    expect(formatAssistantMessageTimestamp(createdAt, 'zh-CN', now)).toContain('7')
    expect(formatAssistantMessageTimestamp(createdAt, 'zh-CN', now)).toContain('09:05')
    expect(formatAssistantMessageTimestamp(createdAt, 'en-US', now)).toContain('09:05')
  })

  it('returns null for invalid persisted timestamps', () => {
    expect(formatAssistantMessageTimestamp('not-an-iso-date', 'en-US', now)).toBeNull()
  })
})
