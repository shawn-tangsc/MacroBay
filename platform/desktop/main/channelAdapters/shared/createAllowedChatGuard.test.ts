import { describe, expect, it } from 'vitest'

import { createAllowedChatGuard } from './createAllowedChatGuard'

describe('createAllowedChatGuard', () => {
  it('allows every chat when no allow-list is configured', () => {
    const guard = createAllowedChatGuard()

    expect(guard.isAllowed('123')).toBe(true)
    expect(guard.isAllowed('456')).toBe(true)
  })

  it('normalizes whitespace and rejects chats outside the allow-list', () => {
    const guard = createAllowedChatGuard([' 123 ', '', '456'])

    expect(guard.isAllowed('123')).toBe(true)
    expect(guard.isAllowed('456')).toBe(true)
    expect(guard.isAllowed('789')).toBe(false)
  })
})
