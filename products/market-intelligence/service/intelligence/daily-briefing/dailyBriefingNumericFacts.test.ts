import { describe, expect, it } from 'vitest'

import type { BriefingMarketRow, DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import { buildNumericFactWhitelist, findUnknownNumber } from './dailyBriefingNumericFacts'
import { validateDailyBriefingEditorial } from './dailyBriefingValidation'

const marketRow = (number: number): BriefingMarketRow => ({
  id: 'btc',
  labelKey: 'dailyBriefing.row.btc',
  importance: { tier: 'must', source: 'rule', reasonCode: 'reading' },
  state: 'available',
  value: { number, format: 'percent' },
  change: null,
  window: '24h',
  observedAt: '2026-10-30T00:25:00.000Z'
})

const documentWith = (input: Readonly<{ marketValues?: readonly number[]; newsTitle?: string }> = {}): DailyBriefingDocument => ({
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
  status: { readings: [], readingsAvailable: 0, readingsTotal: 4 },
  lede: { source: 'template', text: '模板导语', generatedAt: '2026-10-30T00:30:00.000Z' },
  news: {
    items: [{
      itemId: 'n1',
      title: input.newsTitle ?? 'AI labels no longer win lenders',
      sourceName: 'wire',
      publishedAt: '2026-10-30T00:00:00.000Z',
      polarity: 'bearish',
      strength: 3,
      confidence: 80,
      symbols: ['BTC']
    }],
    macro: [],
    notes: {}
  },
  data: {
    market: (input.marketValues ?? [0.003619]).map(marketRow),
    funds: [],
    sentiment: {
      fearGreed: null,
      news: { state: 'available', counts: { bearish: 1, bullish: 0, mixed: 0, neutral: 0 }, itemCount: 1 }
    }
  },
  conclusion: null,
  next: { items: [] },
  citations: [],
  provenance: { summaryId: null, readAt: '2026-10-30T00:30:00.000Z' }
})

describe('daily briefing numeric facts', () => {
  it('accepts a full-precision fact and every legal rounding of it', () => {
    const allowed = buildNumericFactWhitelist(documentWith({ marketValues: [0.003619] }))
    expect(findUnknownNumber('资金费率 0.003619%', allowed)).toBeUndefined()
    expect(findUnknownNumber('资金费率 0.0036%', allowed)).toBeUndefined()
    expect(findUnknownNumber('资金费率 0.00362%', allowed)).toBeUndefined()
  })

  it('rejects a value that is not a rounding of any fact, even when it looks close', () => {
    const allowed = buildNumericFactWhitelist(documentWith({ marketValues: [0.003619] }))
    expect(findUnknownNumber('资金费率 0.0036199%', allowed)).toBe('0.0036199')
    expect(findUnknownNumber('资金费率 1.2345%', allowed)).toBe('1.2345')
  })

  it('accepts the direction and its absolute value for a negative fact', () => {
    const allowed = buildNumericFactWhitelist(documentWith({ marketValues: [-0.004294] }))
    expect(findUnknownNumber('资金费率 -0.004294%', allowed)).toBeUndefined()
    expect(findUnknownNumber('资金费率 0.004294%', allowed)).toBeUndefined()
  })

  it('accepts a value only when the facts actually carry it', () => {
    const allowed = buildNumericFactWhitelist(documentWith({ marketValues: [1.2345] }))
    expect(findUnknownNumber('资金费率 1.2345%', allowed)).toBeUndefined()
  })

  it('treats a grouped and an ungrouped spelling of a string fact as the same number', () => {
    const allowed = buildNumericFactWhitelist(documentWith({ newsTitle: 'Volume reached 1,234.5 units' }))
    expect(findUnknownNumber('规模 1,234.5', allowed)).toBeUndefined()
    expect(findUnknownNumber('规模 1234.5', allowed)).toBeUndefined()
  })

  it('throws instead of truncating when the whitelist would exceed its cap', () => {
    const marketValues = Array.from({ length: 1_200 }, (_, index) => -(1_000_000 + index * 1.234567890123))
    expect(() => buildNumericFactWhitelist(documentWith({ marketValues }))).toThrow(/20000/)
  })

  it('no longer rejects a full-precision fact in editorial prose', () => {
    const editorial = {
      lede: 'BTC 资金费率仍为 0.003619%，处于低位。',
      ledePattern: 'structure',
      items: [{ factId: 'news:n1', why: '这条消息解释了风险偏好的下行。' }],
      hidden: [],
      importance: []
    }
    expect(validateDailyBriefingEditorial(editorial, documentWith({ marketValues: [0.003619] }), 'zh-CN'))
      .toMatchObject({ ok: true })
  })
})
