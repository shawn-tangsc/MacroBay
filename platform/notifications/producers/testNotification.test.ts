import { describe, expect, it } from 'vitest'

import { buildTestNotificationRequest } from './testNotification'

describe('test notification request', () => {
  it('uses a different dedupe key every time, so a second click is a second record', () => {
    const first = buildTestNotificationRequest(1)
    const second = buildTestNotificationRequest(2)
    expect(first.dedupeKey).not.toBe(second.dedupeKey)
  })

  it('keeps its own source so it never eats the real breaker quota', () => {
    expect(buildTestNotificationRequest().sourceId).toBe('platform.test')
  })

  it('always includes the centre, so a blocked desktop banner still leaves a record', () => {
    expect(buildTestNotificationRequest().requestedChannels).toContain('center')
  })
})
