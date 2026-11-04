import { describe, expect, it } from 'vitest'

import {
  briefingEditionPeriod,
  dailyBriefingGenerationPolicy,
  dailyBriefingGenerationTimes,
  isDailyBriefingGenerationTime,
  briefingGenerationDisplayRows,
  briefingGenerationStageIds,
  dailyBriefingPolicy,
  isBriefingGenerationTrace,
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
    // 200 per class is the candidate budget: the service fails with `candidate-overflow` instead of
    // silently storing a truncated selection.
    expect(dailyBriefingPolicy.maximumNewsItems).toBe(200)
    expect(dailyBriefingPolicy.maximumMacroItems).toBe(200)
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

describe('daily briefing editorial layer', () => {
  it('keeps the agent lede, why lines, conclusion translation and editorial provenance optional', () => {
    const editorial: DailyBriefingDocument = {
      ...minimalDocument,
      lede: { source: 'agent', text: 'Agent lede.', factCount: 3, generatedAt: '2026-10-30T00:30:00.000Z' },
      news: {
        items: [{
          itemId: 'n1', title: 'Headline', translatedTitle: '标题', sourceName: 'Source',
          publishedAt: '2026-10-30T00:00:00.000Z', polarity: 'bearish', strength: 3, confidence: 80,
          symbols: ['BTC'], why: 'Because flows turned negative.'
        }],
        macro: [{
          eventKey: 'US.CPI', title: 'cpi', scheduledAt: '2026-10-29T12:30:00.000Z', importance: 'high',
          actual: '3.4%', consensus: '3.2%', surprise: { direction: 'beat', value: 0.2, unit: 'pp' },
          why: 'The beat lifts the front end.'
        }],
        notes: {}
      },
      conclusion: {
        summaryId: 's1', publishedAt: '2026-10-30T00:00:00.000Z', direction: 'bearish',
        directions: [{ horizon: 'short', direction: 'bearish', confidence: 'medium' }],
        summary: 'Summary.', translation: '摘要。', conditions: [], invalidations: [],
        counterEvidence: [], topSignal: null, dataGaps: [], caveats: []
      },
      editorial: { dataNote: 'Data note.', invalidationNote: 'Invalidation note.' },
      provenance: {
        summaryId: 's1', readAt: '2026-10-30T00:30:00.000Z',
        editorialMeta: { promptVersion: 'daily-briefing.v1', model: 'model', source: 'custom', fallback: 'custom-unavailable' }
      }
    }
    expect(editorial.lede.source).toBe('agent')
    expect(editorial.news.items[0]?.why).toBe('Because flows turned negative.')
    expect(editorial.news.macro[0]?.why).toBe('The beat lifts the front end.')
    expect(editorial.conclusion?.translation).toBe('摘要。')
    expect(editorial.provenance.editorialMeta?.fallback).toBe('custom-unavailable')
    expect(isDailyBriefingDocumentWithinBudget(editorial)).toBe(true)
  })

  it('guards the optional generation trace', () => {
    const trace = {
      attemptId: '2026-10-30:zh-CN:2026-10-30T00:30:00.000Z',
      startedAt: '2026-10-30T00:30:00.000Z',
      finishedAt: '2026-10-30T00:30:02.000Z',
      state: 'failed',
      stages: [
        { id: 'source', state: 'success', durationMs: 10 },
        { id: 'candidates', state: 'failed', failureCode: 'build-failed' },
        { id: 'writing', state: 'skipped' }
      ]
    }
    expect(isBriefingGenerationTrace(trace)).toBe(true)
    expect(isBriefingGenerationTrace({ ...trace, stages: [] })).toBe(false)
    expect(isBriefingGenerationTrace({ ...trace, stages: [{ id: 'source', state: 'success' }, { id: 'source', state: 'failed' }] })).toBe(false)
    expect(isBriefingGenerationTrace({ ...trace, stages: [{ id: 'nope', state: 'success' }] })).toBe(false)
    expect(isBriefingGenerationTrace({ ...trace, stages: [{ id: 'source', state: 'running' }] })).toBe(false)
  })
})

describe('generation display rows', () => {
  it('covers every stage exactly once, in pipeline order', () => {
    const flattened = briefingGenerationDisplayRows.flatMap((row) => row.stages)
    // No stage may fall out of the picture, and none may be counted under two rows.
    expect([...flattened].sort()).toEqual([...briefingGenerationStageIds].sort())
    expect(new Set(flattened).size).toBe(flattened.length)
  })

  it('folds the three repair rounds into one row', () => {
    const repair = briefingGenerationDisplayRows.filter((row) => (row.stages as readonly string[]).includes('repair-1'))
    expect(repair).toHaveLength(1)
    expect(repair[0]!.stages).toEqual(['repair-1', 'repair-2', 'repair-3'])
    // Eight rows for the reader, nine stages in the pipeline.
    expect(briefingGenerationDisplayRows).toHaveLength(8)
  })
})

describe('edition period identity', () => {
  it('reads an edition written before schema 13 as the default period of its day', () => {
    // Old rows have no period fields, were the one fixed period of the day, and predate manual runs.
    expect(briefingEditionPeriod({ generatedAt: '2026-10-30T00:30:00.000Z' })).toEqual({
      periodId: 'default',
      periodTime: '2026-10-30T00:30:00.000Z',
      periodKind: 'scheduled',
      // Those editions recorded no trigger: they read as running on schedule, never as "补跑".
      runTrigger: 'scheduled'
    })
  })

  it('keeps the identity a new edition wrote, manual kind included', () => {
    expect(briefingEditionPeriod({
      generatedAt: '2026-11-03T07:00:12.345Z',
      periodId: 'period_01J8Z6Q4T3',
      periodTime: '2026-11-03T07:00:00.000Z',
      periodKind: 'manual',
      runTrigger: 'manual'
    })).toEqual({
      periodId: 'period_01J8Z6Q4T3',
      periodTime: '2026-11-03T07:00:00.000Z',
      periodKind: 'manual',
      runTrigger: 'manual'
    })
  })

  it('never derives the id from the cutoff, and a deleted period stays scheduled', () => {
    // Two periods may legitimately share a cutoff; identity is the stored id. And a scheduled
    // edition whose configuration row was deleted still reads as scheduled — the kind travels with
    // the edition, not with a lookup that can come back empty.
    const first = briefingEditionPeriod({ generatedAt: '2026-11-03T07:00:01.000Z', periodId: 'period_a', periodTime: '2026-11-03T07:00:00.000Z', periodKind: 'scheduled' })
    const second = briefingEditionPeriod({ generatedAt: '2026-11-03T07:00:02.000Z', periodId: 'period_b', periodTime: '2026-11-03T07:00:00.000Z', periodKind: 'scheduled' })
    expect(first.periodTime).toBe(second.periodTime)
    expect(first.periodId).not.toBe(second.periodId)
    expect(first.periodKind).toBe('scheduled')
    expect(first.runTrigger).toBe('scheduled')
  })
})

describe('generation times a period may run at', () => {
  it('offers every half hour of the day, and keeps the old morning slots valid', () => {
    expect(dailyBriefingGenerationTimes).toHaveLength(48)
    expect(dailyBriefingGenerationTimes[0]).toBe('00:00')
    expect(dailyBriefingGenerationTimes.at(-1)).toBe('23:30')
    // The default is unchanged, and values an older install may have saved are still accepted.
    expect(dailyBriefingGenerationPolicy.defaultGenerationTime).toBe('07:00')
    for (const time of ['06:00', '07:00', '09:30', '10:00']) expect(isDailyBriefingGenerationTime(time)).toBe(true)
    // Evening slots the morning-only table could not express.
    expect(isDailyBriefingGenerationTime('12:00')).toBe(true)
    expect(isDailyBriefingGenerationTime('21:30')).toBe(true)
    // Still a closed set: no odd minutes, nothing outside the day.
    expect(isDailyBriefingGenerationTime('12:15')).toBe(false)
    expect(isDailyBriefingGenerationTime('24:00')).toBe(false)
  })
})
