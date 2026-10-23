import { describe, expect, it } from 'vitest'

import { normalizeEventType } from './eventTypeNormalizer'

describe('normalizeEventType', () => {
  it('maps adapter aliases to stable event types', () => {
    expect(normalizeEventType({ eventType: 'news-event' })).toBe('news')
    expect(normalizeEventType({ eventType: 'system-status' })).toBe('exchange-status')
    expect(normalizeEventType({ eventType: 'exchange-announcement' })).toBe('exchange-announcement')
  })

  it('falls back to source category when adapter event type is unknown', () => {
    expect(normalizeEventType({ sourceCategory: 'regulation' })).toBe('regulation')
    expect(normalizeEventType({ sourceCategory: 'exchange-status' })).toBe('exchange-status')
  })
})
