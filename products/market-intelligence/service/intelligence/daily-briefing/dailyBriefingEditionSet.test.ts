import { describe, expect, it } from 'vitest'

import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import { briefingEditionRowIds, briefingFactDirection, firstRowSetDifference, isOppositeDirection, restrictEditionRows } from './dailyBriefingEditionSet'

/** The two fixtures the acceptance asks for live here: a dropped row and an opposite verdict. */

const document = (locale: 'zh-CN' | 'en-US' = 'zh-CN'): DailyBriefingDocument => ({
  schemaVersion: 1,
  policyVersion: 'daily-briefing.v1',
  edition: {
    date: '2026-11-02', locale, generatedAt: '2026-11-02T00:00:00.000Z',
    windowStart: '2026-11-01T00:00:00.000Z', windowEnd: '2026-11-02T00:00:00.000Z', timeZone: 'Asia/Shanghai'
  },
  status: { readings: [], readingsAvailable: 0, readingsTotal: 4 },
  lede: { source: 'template', text: locale === 'zh-CN' ? '今日要点。' : 'Today.', generatedAt: '2026-11-02T00:00:00.000Z' },
  news: { items: [], macro: [], notes: {} },
  data: {
    market: [{
      id: 'btc', labelKey: 'rows.btc', importance: { tier: 'must', source: 'rule', reasonCode: 'largest-move' }, state: 'available',
      value: { number: 68000, format: 'usd' }, change: null, window: '24h', observedAt: '2026-11-02T00:00:00.000Z'
    }],
    funds: [{
      id: 'etf-btc', group: 'funds', labelKey: 'rows.etfBtc', importance: { tier: 'support', source: 'rule', reasonCode: 'reading' }, state: 'available',
      value: { number: -1, format: 'flow-usd' }, change: null, window: 'trading-day', observedAt: '2026-11-02T00:00:00.000Z'
    }],
    sentiment: {
      fearGreed: { id: 'fear-greed', group: 'sentiment', labelKey: 'rows.fearGreed', importance: { tier: 'support', source: 'rule', reasonCode: 'reading' }, state: 'available', value: { number: 30, format: 'score' }, change: null, window: '24h', observedAt: '2026-11-02T00:00:00.000Z' },
      news: { state: 'empty' }
    }
  },
  conclusion: {
    summaryId: 's1', publishedAt: '2026-11-02T00:00:00.000Z', direction: 'bearish', directions: [],
    summary: 's', conditions: [], invalidations: [], counterEvidence: [], topSignal: null,
    dataGaps: [], caveats: [], synthesis: 'fallback'
  },
  next: { items: [] },
  citations: [],
  provenance: { summaryId: 's1', readAt: '2026-11-02T00:00:00.000Z' }
})

describe('edition row set', () => {
  it('lists the rows in one order and does not care which language the edition is in', () => {
    const rows = briefingEditionRowIds(document())
    expect(rows).toEqual(['market:btc', 'funds:etf-btc', 'sentiment:fear-greed'])
    expect(briefingEditionRowIds(document('en-US'))).toEqual(rows)
  })

  it('shows exactly which row a version dropped', () => {
    // The fixture: the writer is handed a set with one row missing, so the published edition loses
    // that row. The comparator has to name it, otherwise "少一行" cannot be judged.
    const frozen = briefingEditionRowIds(document())
    const trimmed = restrictEditionRows(document(), ['market:btc', 'sentiment:fear-greed'])
    const published = briefingEditionRowIds(trimmed)
    expect(firstRowSetDifference(frozen, published)).toBe('funds:etf-btc')
    expect(published).toEqual(['market:btc', 'sentiment:fear-greed'])
  })

  it('treats only the two opposing calls as a conflict', () => {
    expect(isOppositeDirection('bullish', 'bearish')).toBe(true)
    expect(isOppositeDirection('bearish', 'bullish')).toBe(true)
    expect(isOppositeDirection('bullish', 'bullish')).toBe(false)
    expect(isOppositeDirection('bearish', 'range')).toBe(false)
    expect(isOppositeDirection('bullish', 'undecided')).toBe(false)
  })

  it('reads the verdict from the data layer, and has none when there is no analysis', () => {
    expect(briefingFactDirection(document())).toBe('bearish')
    expect(briefingFactDirection({ ...document(), conclusion: null })).toBe('undecided')
  })
})
