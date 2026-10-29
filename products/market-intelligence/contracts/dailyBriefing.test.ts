import { describe, expect, it } from 'vitest'

import {
  dailyBriefingPolicy,
  isDailyBriefingDocumentWithinBudget,
  isDailyBriefingEditionDate,
  isDailyBriefingLocale,
  isDailyBriefingReadingState,
  isFactImportanceTier,
  type DailyBriefingDocument
} from './dailyBriefing'

const minimalDocument: DailyBriefingDocument = {
  schemaVersion: 1,
  policyVersion: 'daily-briefing.v1',
  edition: {
    date: '2026-10-30',
    locale: 'zh-CN',
    generatedAt: '2026-10-30T00:30:00.000Z',
    windowStart: '2026-10-29T00:30:00.000Z',
    windowEnd: '2026-10-30T00:30:00.000Z',
    timeZone: 'Asia/Shanghai'
  },
  status: {
    readings: [
      { id: 'fear-greed', state: 'available' },
      { id: 'funding', state: 'available' },
      { id: 'capital', state: 'available' },
      { id: 'calendar', state: 'available' }
    ],
    readingsAvailable: 4,
    readingsTotal: 4
  },
  lede: { source: 'template', text: '今日要点。', generatedAt: '2026-10-30T00:30:00.000Z' },
  news: { items: [], macro: [], notes: {} },
  data: {
    market: [],
    funds: [],
    sentiment: { fearGreed: null, news: { state: 'empty' } }
  },
  conclusion: null,
  next: { items: [] },
  citations: [],
  provenance: { summaryId: null, readAt: '2026-10-30T00:30:00.000Z' }
}

describe('daily briefing contract', () => {
  it('pins the document caps the product promises', () => {
    expect(dailyBriefingPolicy.maximumNewsItems).toBe(3)
    expect(dailyBriefingPolicy.maximumMacroItems).toBe(3)
    expect(dailyBriefingPolicy.maximumNextItems).toBe(3)
    expect(dailyBriefingPolicy.maximumCounterEvidence).toBe(3)
    expect(dailyBriefingPolicy.maximumConditions).toBe(5)
    expect(dailyBriefingPolicy.retentionDays).toBe(14)
    expect(dailyBriefingPolicy.maximumBytes).toBe(256 * 1024)
  })

  it('accepts only the two reader locales', () => {
    expect(isDailyBriefingLocale('zh-CN')).toBe(true)
    expect(isDailyBriefingLocale('en-US')).toBe(true)
    expect(isDailyBriefingLocale('en-GB')).toBe(false)
    expect(isDailyBriefingLocale(undefined)).toBe(false)
  })

  it('accepts only canonical local edition dates', () => {
    expect(isDailyBriefingEditionDate('2026-10-30')).toBe(true)
    expect(isDailyBriefingEditionDate('2026-02-30')).toBe(false)
    expect(isDailyBriefingEditionDate('2026-1-3')).toBe(false)
    expect(isDailyBriefingEditionDate('2026-10-30T00:00:00.000Z')).toBe(false)
  })

  it('keeps the four-state and three-tier vocabularies closed', () => {
    expect(isDailyBriefingReadingState('stale')).toBe(true)
    expect(isDailyBriefingReadingState('ok')).toBe(false)
    expect(isFactImportanceTier('must')).toBe(true)
    expect(isFactImportanceTier('reference')).toBe(true)
    expect(isFactImportanceTier('important')).toBe(false)
  })

  it('rejects a document above the IPC/storage budget', () => {
    expect(isDailyBriefingDocumentWithinBudget(minimalDocument)).toBe(true)
    const huge = { ...minimalDocument, lede: { ...minimalDocument.lede, text: 'x'.repeat(300_000) } }
    expect(isDailyBriefingDocumentWithinBudget(huge)).toBe(false)
  })

  it('treats an unserializable document as over budget', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(isDailyBriefingDocumentWithinBudget(circular)).toBe(false)
  })
})
