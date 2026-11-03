import { describe, expect, it } from 'vitest'

import { analysisRunBarPolicy, analysisRunRecords } from './analysisRunBarModel'
import type { MarketAnalysisTimelineEntry } from '../../shared/ipc/marketAnalysisTimelineClient'

/** A published analysis row; only the fields the bar reads are varied per case. */
function entry(overrides: Partial<MarketAnalysisTimelineEntry> & Pick<MarketAnalysisTimelineEntry, 'id' | 'occurredAt'>): MarketAnalysisTimelineEntry {
  return {
    eventGroupId: 'mi-eg-1',
    analysisRunId: 'mi-ar-1',
    kind: 'analysis',
    status: 'published',
    summaryRef: 'mi-as-1',
    safeTitle: '市场分析已生成',
    safeExcerpt: null,
    version: 1,
    triggerStatus: null,
    groupType: null,
    groupSubject: null,
    ...overrides
  }
}

const now = '2026-11-03T02:00:00.000Z'

describe('analysisRunRecords', () => {
  it('keeps only the reader\u2019s own display day, not the UTC day', () => {
    // 17:30Z is already 11-03 01:30 in Asia/Shanghai and still 11-02 in UTC: the bar must follow
    // the reader, and include the row the UTC boundary would drop.
    const records = analysisRunRecords([
      entry({ id: 'mi-tl-today', occurredAt: '2026-11-02T17:30:00.000Z' }),
      entry({ id: 'mi-tl-yesterday', occurredAt: '2026-11-02T10:00:00.000Z' })
    ], now, 'Asia/Shanghai')

    expect(records.map(row => row.id)).toEqual(['mi-tl-today'])
  })

  it('lists the newest run first', () => {
    const records = analysisRunRecords([
      entry({ id: 'mi-tl-old', occurredAt: '2026-11-03T00:10:00.000Z' }),
      entry({ id: 'mi-tl-new', occurredAt: '2026-11-03T01:40:00.000Z' })
    ], now, 'Asia/Shanghai')

    expect(records.map(row => row.id)).toEqual(['mi-tl-new', 'mi-tl-old'])
  })

  it('keeps a run that has no recorded decision, as the third state rather than a dropped row', () => {
    const records = analysisRunRecords([entry({ id: 'mi-tl-bare', occurredAt: '2026-11-03T00:30:00.000Z' })], now, 'Asia/Shanghai')

    expect(records).toEqual([{ id: 'mi-tl-bare', at: '2026-11-03T00:30:00.000Z', reasonCode: null }])
  })

  it('carries the reason code of a run that has one', () => {
    const records = analysisRunRecords([entry({
      id: 'mi-tl-explained',
      occurredAt: '2026-11-03T00:30:00.000Z',
      triggerStatus: { triggerKey: 'calendar.refresh', reasonCode: 'significance-confirmed', decidedAt: '2026-11-03T00:30:00.000Z' }
    })], now, 'Asia/Shanghai')

    expect(records[0]?.reasonCode).toBe('significance-confirmed')
  })

  it('drops workspace rows: a `system` row is not an analysis run', () => {
    const records = analysisRunRecords([entry({ id: 'mi-tl-system', kind: 'system', occurredAt: '2026-11-03T00:30:00.000Z' })], now, 'Asia/Shanghai')

    expect(records).toEqual([])
  })

  it('is empty when nothing ran today', () => {
    expect(analysisRunRecords([entry({ id: 'mi-tl-yesterday', occurredAt: '2026-11-02T01:00:00.000Z' })], now, 'Asia/Shanghai')).toEqual([])
  })

  it('caps the list at one screen of records', () => {
    const many = Array.from({ length: analysisRunBarPolicy.maxRows + 5 }, (_, index) =>
      entry({ id: `mi-tl-${index}`, occurredAt: new Date(Date.parse('2026-11-03T00:00:00.000Z') + index * 60_000).toISOString() }))

    expect(analysisRunRecords(many, now, 'Asia/Shanghai')).toHaveLength(analysisRunBarPolicy.maxRows)
  })
})
