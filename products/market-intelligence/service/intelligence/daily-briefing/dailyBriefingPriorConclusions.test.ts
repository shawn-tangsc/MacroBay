import { describe, expect, it } from 'vitest'

import type { AnalysisSummary, TimelineEntry } from '../../../contracts/marketAnalysisContracts'
import type { BriefingPriorConclusion, DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import {
  collectAnalysisPriorConclusions,
  collectBriefingPriorConclusions,
  detectPriorConclusionConflict,
  isCopiedConclusionText,
  mergePriorConclusions,
  priorConclusionPolicy
} from './dailyBriefingPriorConclusions'

const windowStart = '2026-10-29T00:00:00.000Z'
const asOf = '2026-10-30T00:00:00.000Z'

const summary = (overrides: Partial<AnalysisSummary> = {}): AnalysisSummary => ({
  id: 'mi-as-1', schemaVersion: 1, analysisRunId: 'mi-ar-1', eventGroupId: 'mi-eg-1', version: 1,
  conclusion: {
    direction: 'bearish', summary: 'Flows pull bids away.', change: 'Flows turned negative.',
    causalChain: 'Flows -> bids.', conditions: [], macro: null, evidenceStrength: null, dataGaps: []
  },
  knownFacts: [], transmissionHypotheses: [], marketReaction: [], supportingEvidence: [], counterEvidence: [],
  scenarios: [], directions: [{ horizon: 'short', direction: 'bearish', rationale: 'flows', confidence: 'high', evidenceRefIds: [] }],
  nextCatalysts: [], dataCaveats: [], evidenceRefs: ['ev-1', 'ev-2'], createdAt: '2026-10-29T08:00:00.000Z',
  ...overrides
})

// 按真实形状造：读取侧只取其中六格，但传进来的就是一条时间线条目，别用一个宽对象冒充——
// 宽对象会把 `kind`/`status`/`direction` 都写成 string，「只读 published 的分析」这条判据就落空了。
const entry = (overrides: Partial<TimelineEntry> = {}): TimelineEntry => ({
  id: 'mi-tl-1', schemaVersion: 1, eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1',
  kind: 'analysis', status: 'published', occurredAt: '2026-10-29T08:00:00.000Z',
  summaryRef: 'mi-as-1', safeTitle: 'Flows pull bids away.', safeExcerpt: null,
  direction: 'bearish', version: 1, ...overrides
})

const prior = (overrides: Partial<BriefingPriorConclusion> = {}): BriefingPriorConclusion => ({
  id: 'analysis:mi-as-1', source: 'analysis', observedAt: '2026-10-29T08:00:00.000Z',
  asOf: '2026-10-29T08:00:00.000Z', direction: 'bearish', confidence: 'high',
  summary: 'Flows pull bids away.', evidenceRefs: ['ev-1'], ...overrides
})

const briefDocument = (overrides: {
  windowEnd?: string
  generatedAt?: string
  summary?: string
  direction?: BriefingPriorConclusion['direction']
  synthesis?: 'agent' | 'fallback'
  editorialFailure?: string
  synthesisDetail?: Record<string, unknown>
} = {}): DailyBriefingDocument => ({
  edition: {
    date: '2026-10-29', locale: 'zh-CN',
    generatedAt: overrides.generatedAt ?? '2026-10-29T00:30:00.000Z',
    windowStart: '2026-10-28T00:30:00.000Z',
    windowEnd: overrides.windowEnd ?? '2026-10-29T00:30:00.000Z',
    timeZone: 'Asia/Shanghai'
  },
  conclusion: {
    summaryId: 's1', publishedAt: '2026-10-29T00:00:00.000Z',
    direction: overrides.direction ?? 'bullish',
    directions: [], summary: overrides.summary ?? 'Liquidity expansion supports bids.',
    conditions: [], invalidations: [], counterEvidence: [], topSignal: null,
    dataGaps: [], caveats: [],
    ...(overrides.synthesis ? { synthesis: overrides.synthesis } : {}),
    ...(overrides.synthesisDetail ? { synthesisDetail: overrides.synthesisDetail as never } : {})
  },
  citations: [{ index: 1, refId: 'ev-9' }],
  provenance: {
    summaryId: 's1', readAt: '2026-10-29T00:30:00.000Z',
    ...(overrides.editorialFailure ? { editorialFailure: overrides.editorialFailure } : {})
  }
} as unknown as DailyBriefingDocument)

describe('prior conclusions', () => {
  it('reads analysis conclusions only from published analysis nodes inside the window', () => {
    const conclusions = collectAnalysisPriorConclusions({
      entries: [
        entry(),
        entry({ id: 'mi-tl-2', occurredAt: '2026-10-30T01:00:00.000Z' }),
        entry({ id: 'mi-tl-3', status: 'stale' }),
        entry({ id: 'mi-tl-4', kind: 'system' })
      ],
      windowStart,
      asOf,
      readSummary: () => summary()
    })

    expect(conclusions).toHaveLength(1)
    expect(conclusions[0]).toMatchObject({
      id: 'analysis:mi-as-1', source: 'analysis', observedAt: '2026-10-29T08:00:00.000Z',
      asOf: '2026-10-29T08:00:00.000Z', direction: 'bearish', confidence: 'high',
      summary: 'Flows pull bids away.', rationale: 'Flows turned negative.', evidenceRefs: ['ev-1', 'ev-2']
    })
  })

  it('keeps a legacy free-text summary and labels missing confidence unknown', () => {
    const conclusions = collectAnalysisPriorConclusions({
      entries: [entry()],
      windowStart,
      asOf,
      readSummary: () => summary({ conclusion: undefined, eventAssessment: '方向：偏空：买盘被抽走。', directions: [] })
    })

    expect(conclusions[0]).toMatchObject({ direction: 'bearish', confidence: 'unknown', summary: '方向：偏空：买盘被抽走。' })
  })

  it('reads stored brief conclusions and excludes fallbacks, failures and the current edition', () => {
    const conclusions = collectBriefingPriorConclusions({
      editions: [
        { date: '2026-10-29', document: briefDocument({ synthesis: 'agent', synthesisDetail: { confidence: 'medium', coreTension: 'Price lags flows.', evidenceRefs: ['data:btc'] } }) },
        { date: '2026-10-28', document: briefDocument({ windowEnd: '2026-10-28T00:30:00.000Z', synthesis: 'fallback' }) },
        { date: '2026-10-27', document: briefDocument({ windowEnd: '2026-10-27T00:30:00.000Z', editorialFailure: 'editorial-timeout' }) },
        { date: '2026-10-30', document: briefDocument({ windowEnd: asOf }) },
        { date: '2026-10-26', document: briefDocument({ windowEnd: '2026-10-26T00:30:00.000Z' }) }
      ],
      windowStart,
      asOf
    })

    expect(conclusions).toHaveLength(1)
    expect(conclusions[0]).toMatchObject({
      id: 'daily-brief:2026-10-29:zh-CN', source: 'daily-brief', direction: 'bullish',
      confidence: 'medium', rationale: 'Price lags flows.', evidenceRefs: ['data:btc', 'ev-9']
    })
  })

  it('drops conclusions that were written after the cutoff even when their window is inside it', () => {
    const lateAnalysis = collectAnalysisPriorConclusions({
      entries: [entry()],
      windowStart,
      asOf,
      readSummary: () => summary({ createdAt: '2026-10-30T01:00:00.000Z' })
    })
    const lateBrief = collectBriefingPriorConclusions({
      editions: [{
        date: '2026-10-29',
        document: briefDocument({ generatedAt: '2026-10-30T01:00:00.000Z', synthesis: 'agent' })
      }],
      windowStart,
      asOf
    })

    expect(lateAnalysis).toEqual([])
    expect(lateBrief).toEqual([])
  })

  it('merges oldest first, deduplicates, and keeps the newest when capped', () => {
    const many = Array.from({ length: priorConclusionPolicy.maximumItems + 3 }, (_, index) => prior({
      id: `analysis:${index}`,
      observedAt: `2026-10-29T${String(index).padStart(2, '0')}:00:00.000Z`
    }))
    const merged = mergePriorConclusions([[prior({ id: 'analysis:duplicate', observedAt: '2026-10-29T00:30:00.000Z' })], many])

    expect(merged).toHaveLength(priorConclusionPolicy.maximumItems)
    expect(merged[0]?.id).toBe('analysis:3')
    expect(merged.at(-1)?.id).toBe(`analysis:${priorConclusionPolicy.maximumItems + 2}`)
    expect(merged.map((item) => item.observedAt)).toEqual([...merged.map((item) => item.observedAt)].sort())
  })

  it('detects no conflict, simultaneous divergence, and a time-ordered flip', () => {
    expect(detectPriorConclusionConflict([prior(), prior({ id: 'b', direction: 'bearish', observedAt: '2026-10-29T09:00:00.000Z' })])).toBe('none')
    expect(detectPriorConclusionConflict([
      prior(), prior({ id: 'b', direction: 'bullish', observedAt: '2026-10-29T08:00:00.000Z' })
    ])).toBe('divergence')
    expect(detectPriorConclusionConflict([
      prior(),
      prior({ id: 'b', direction: 'bullish', observedAt: '2026-10-29T10:00:00.000Z' }),
      prior({ id: 'c', direction: 'bearish', observedAt: '2026-10-29T12:00:00.000Z' })
    ])).toBe('flip')
  })

  it('rejects a copied conclusion but allows a short quotation', () => {
    expect(isCopiedConclusionText('Flows pull bids away.', ['Flows pull bids away.'])).toBe(true)
    expect(isCopiedConclusionText('FLOWS pull bids away', ['Flows pull bids away.'])).toBe(true)
    expect(isCopiedConclusionText('Stablecoin flows pull bids away from BTC.', ['Flows pull bids away.'])).toBe(false)
  })
})
