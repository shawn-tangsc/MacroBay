import { describe, expect, it } from 'vitest'

import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import type { DailyBriefingFactPacket } from './dailyBriefingFactPacket'
import { briefingSnapshot, factSnapshotFromPacket } from './dailyBriefingFactSnapshot'

/**
 * The digest is the same-source proof, so these cases pin the two things it must do: ignore the
 * language's words, and notice a number.
 */

const document = (text = '今日要点。', btc = 68000): DailyBriefingDocument => ({
  schemaVersion: 1,
  policyVersion: 'daily-briefing.v1',
  edition: {
    date: '2026-11-02', locale: 'zh-CN', generatedAt: '2026-11-02T00:00:00.000Z',
    windowStart: '2026-11-01T00:00:00.000Z', windowEnd: '2026-11-02T00:00:00.000Z', timeZone: 'Asia/Shanghai'
  },
  status: { readings: [], readingsAvailable: 0, readingsTotal: 4 },
  lede: { source: 'template', text, generatedAt: '2026-11-02T00:00:00.000Z' },
  news: { items: [], macro: [], notes: {} },
  data: {
    market: [{
      id: 'btc', labelKey: 'rows.btc', importance: 'must', state: 'available',
      value: { number: btc, format: 'usd' }, change: null, window: '24h', observedAt: '2026-11-02T00:00:00.000Z'
    }],
    funds: [],
    sentiment: { fearGreed: null, news: { state: 'empty' } }
  },
  conclusion: null,
  next: {
    items: [{
      eventKey: 'ev-1', title: '就业数据', at: '2026-11-03T12:30:00.000Z',
      importance: 'high', category: 'economic-indicator'
    }]
  },
  citations: [],
  provenance: { summaryId: null, readAt: '2026-11-02T00:00:00.000Z' }
})

const packet = (title = '就业数据', polarity: 'bullish' | 'bearish' = 'bullish'): DailyBriefingFactPacket => ({
  asOf: '2026-11-02T00:00:00.000Z',
  windowStart: '2026-11-01T00:00:00.000Z',
  windowEnd: '2026-11-02T00:00:00.000Z',
  windowHours: 24,
  locale: 'zh-CN',
  timeZone: 'Asia/Shanghai',
  conclusion: null,
  news: {
    state: 'available',
    items: [{
      itemId: 'news-1', title, sourceId: 's', sourceName: 'S', publishedAt: '2026-11-01T12:00:00.000Z',
      scoredAt: '2026-11-01T12:05:00.000Z', polarity, strength: 2, confidence: 70, symbols: [],
      reasonCode: 'x', engine: 'rules', caveats: []
    }]
  },
  calendar: {
    state: 'available',
    events: [{
      eventKey: 'ev-1', title: '就业数据', scheduledAt: '2026-11-03T12:30:00.000Z',
      importance: 'high', category: 'economic-indicator', surprise: { direction: 'inline' }
    } as never]
  },
  readings: {
    fearGreed: { state: 'unavailable' } as never,
    funding: { state: 'unavailable' } as never,
    capital: { state: 'unavailable' } as never
  },
  market: {},
  enabled: { fearGreed: false, funding: false, stablecoin: false, etf: false, calendar: true }
})

describe('briefing snapshot digest', () => {
  it('is the same for two editions whose facts match but whose words differ', () => {
    const chinese = briefingSnapshot(document('今日要点。'), factSnapshotFromPacket(packet('就业数据')))
    const englishPacket = { ...packet('Payrolls'), locale: 'en-US' as const }
    const english = briefingSnapshot(document('Today.’'), factSnapshotFromPacket(englishPacket))
    expect(english.hash).toBe(chinese.hash)
    expect(english.id).toBe(chinese.id)
  })

  it('changes when a number changes, even if every word stays the same', () => {
    const before = briefingSnapshot(document('今日要点。', 68000), factSnapshotFromPacket(packet()))
    const after = briefingSnapshot(document('今日要点。', 68001), factSnapshotFromPacket(packet()))
    expect(after.hash).not.toBe(before.hash)
  })

  it('changes when a window or a pointed-at event changes', () => {
    const base = briefingSnapshot(document(), factSnapshotFromPacket(packet()))
    const shiftedWindow = briefingSnapshot({ ...document(), edition: { ...document().edition, windowEnd: '2026-11-02T01:00:00.000Z' } }, packet())
    const otherPolarity = briefingSnapshot(document(), factSnapshotFromPacket(packet('就业数据', 'bearish')))
    expect(shiftedWindow.hash).not.toBe(base.hash)
    expect(otherPolarity.hash).not.toBe(base.hash)
  })
})
