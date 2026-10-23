import { describe, expect, it } from 'vitest'

import {
  extractPublishedDateFromTitle,
  isBackfillItem,
  parseProcessingLabels,
  resolveEffectivePublishedAt,
  resolveIsBackfillLabel,
  resolveTimelineTimestamp,
  serializeProcessingLabels
} from './intelligenceItemLabels'

describe('intelligenceItemLabels', () => {
  it('does not mark macro metric events as backfill when period release predates detection', () => {
    expect(
      resolveIsBackfillLabel({
        publishedAt: '2026-06-30T00:00:00.000Z',
        detectedAt: '2026-07-09T08:00:00.000Z',
        intelligenceLayer: 'macro',
        eventFamily: 'metric-event'
      })
    ).toBe(false)
  })

  it('marks items as backfill when publication is much older than detection', () => {
    expect(
      isBackfillItem('2024-01-01T00:00:00.000Z', '2026-07-06T00:00:00.000Z')
    ).toBe(true)
    expect(
      isBackfillItem('2026-07-05T10:00:00.000Z', '2026-07-06T00:00:00.000Z')
    ).toBe(false)
  })

  it('prefers publishedAt for timeline ordering', () => {
    expect(
      resolveTimelineTimestamp({
        publishedAt: '2024-01-01T00:00:00.000Z',
        detectedAt: '2026-07-06T00:00:00.000Z'
      })
    ).toBe('2024-01-01T00:00:00.000Z')
  })

  it('extracts publication dates embedded in titles', () => {
    expect(extractPublishedDateFromTitle('Binance Will List ... (2024-02-27)')).toBe('2024-02-27T00:00:00.000Z')
  })

  it('prefers publishedAt, then title, then detectedAt', () => {
    expect(
      resolveEffectivePublishedAt({
        publishedAt: undefined,
        detectedAt: '2026-07-06T00:00:00.000Z',
        title: 'Announcement (2024-02-27)'
      })
    ).toBe('2024-02-27T00:00:00.000Z')
  })
})
