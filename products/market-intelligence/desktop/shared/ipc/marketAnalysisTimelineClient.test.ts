import { afterEach, describe, expect, it, vi } from 'vitest'

import { marketAnalysisTimelineClient } from './marketAnalysisTimelineClient'

const asOf = '2026-09-28T00:00:00.000Z'

afterEach(() => vi.unstubAllGlobals())

describe('marketAnalysisTimelineClient', () => {
  it('passes only a bounded renderer-safe timeline DTO to the workspace', async () => {
    const invoke = vi.fn(async () => ({
      schemaVersion: 1,
      items: [{
        id: 'mi-tl-1', eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1', kind: 'analysis', status: 'published',
        occurredAt: asOf, summaryRef: 'mi-as-1', safeTitle: '市场分析已生成', safeExcerpt: '摘要', version: 1,
        triggerStatus: { triggerKey: 'calendar.refresh', reasonCode: 'significance-confirmed', decidedAt: asOf }
      }],
      nextCursor: null
    }))
    vi.stubGlobal('window', { platform: { products: { invoke } } })

    await expect(marketAnalysisTimelineClient.listTimeline()).resolves.toEqual({
      state: 'available',
      page: {
        schemaVersion: 1,
        items: [{
          id: 'mi-tl-1', eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1', kind: 'analysis', status: 'published',
          occurredAt: asOf, summaryRef: 'mi-as-1', safeTitle: '市场分析已生成', safeExcerpt: '摘要', direction: null, version: 1, triggerStatus: { triggerKey: 'calendar.refresh', reasonCode: 'significance-confirmed', decidedAt: asOf }
        }],
        nextCursor: null
      }
    })
    expect(invoke).toHaveBeenCalledWith('market-intelligence', 'marketAnalysis.listTimeline', {})
  })

  it('passes a structured conclusion through and keeps its direction key', async () => {
    const entry = {
      id: 'mi-tl-1', eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1', kind: 'analysis' as const, status: 'published' as const,
      occurredAt: asOf, summaryRef: 'mi-as-1', safeTitle: '市场分析已生成', safeExcerpt: '收益率上行压制风险资产。', direction: 'bearish' as const, version: 1
    }
    const conclusion = {
      direction: 'bearish', summary: '收益率上行压制风险资产。', change: 'ETF 净流出。',
      causalChain: '通胀高于前值 → 实际利率上升 → 风险资产承压。',
      conditions: ['通胀粘性持续。'], macro: '美债收益率上行。', evidenceStrength: null, dataGaps: ['缺少市场预期值。']
    }
    const summary = {
      id: 'mi-as-1', schemaVersion: 1, analysisRunId: 'mi-ar-1', eventGroupId: 'mi-eg-1', version: 1,
      conclusion, knownFacts: [], transmissionHypotheses: [], marketReaction: [], supportingEvidence: [], counterEvidence: [],
      scenarios: [], directions: [{ horizon: 'short', direction: 'bearish', rationale: '收益率上行。', confidence: 'medium', evidenceRefIds: ['mi-ev-1'] }],
      nextCatalysts: [], dataCaveats: [], evidenceRefs: ['mi-ev-1'], createdAt: asOf
    }
    const invoke = vi.fn(async (_productId: string, method: string) => {
      if (method === 'marketAnalysis.getAnalysisRun') return {
        id: 'mi-ar-1', eventGroupId: 'mi-eg-1', analysisPhase: 'initial', status: 'succeeded', failureCode: null,
        queuedAt: asOf, startedAt: asOf, completedAt: asOf, asOf, dataCutoff: asOf, evidenceCount: 1
      }
      if (method === 'marketAnalysis.getSummary') return summary
      return []
    })
    vi.stubGlobal('window', { platform: { products: { invoke } } })

    const result = await marketAnalysisTimelineClient.getDetail(entry)
    expect(result.state).toBe('available')
    expect(result.state === 'available' ? result.detail.summary.conclusion?.direction : undefined).toBe('bearish')
    expect(result.state === 'available' ? result.detail.summary.eventAssessment : undefined).toBeUndefined()
  })

  it('fails closed when the product IPC is unavailable or extends the safe contract', async () => {
    vi.stubGlobal('window', { platform: { products: { invoke: vi.fn(async () => ({ schemaVersion: 1, items: [], nextCursor: null, extra: true })) } } })
    await expect(marketAnalysisTimelineClient.listTimeline()).resolves.toEqual({ state: 'unavailable' })
  })

  it('distinguishes an empty published timeline from an unavailable product IPC', async () => {
    vi.stubGlobal('window', { platform: { products: { invoke: vi.fn(async () => { throw new Error('runtime unavailable') }) } } })
    await expect(marketAnalysisTimelineClient.listTimeline()).resolves.toEqual({ state: 'unavailable' })
  })

  it('joins a selected timeline entry only to its matching safe run and summary detail', async () => {
    const entry = {
      id: 'mi-tl-1', eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1', kind: 'analysis' as const, status: 'published' as const,
      occurredAt: asOf, summaryRef: 'mi-as-1', safeTitle: '市场分析已生成', safeExcerpt: '摘要', version: 1
    }
    const invoke = vi.fn(async (_productId: string, method: string) => {
      if (method === 'marketAnalysis.getAnalysisRun') return {
        id: 'mi-ar-1', eventGroupId: 'mi-eg-1', analysisPhase: 'initial', status: 'succeeded', failureCode: null,
        queuedAt: asOf, startedAt: asOf, completedAt: asOf, asOf, dataCutoff: asOf, evidenceCount: 2, change: { summary: '~actual:3.2->3.4', facts: [{ domain: 'macro', subject: 'CPI', metric: 'actual', unit: '%', kind: 'changed', previousValue: '3.2', value: '3.4' }], missingDomainsAdded: [], missingDomainsRemoved: [], caveatsAdded: 0, caveatsRemoved: 0, evidenceRefsAdded: 0, evidenceRefsRemoved: 0 }
      }
      if (method === 'marketAnalysis.getSummary') return {
        id: 'mi-as-1', schemaVersion: 1, analysisRunId: 'mi-ar-1', eventGroupId: 'mi-eg-1', version: 1,
        eventAssessment: '市场情绪偏谨慎', knownFacts: [], transmissionHypotheses: [], marketReaction: [],
        supportingEvidence: [], counterEvidence: [], scenarios: [], nextCatalysts: [], dataCaveats: ['资金费率不可比'], evidenceRefs: ['ev-1', 'ev-2'], createdAt: asOf
      }
      return [{
        id: 'mi-pr-1', summaryId: 'mi-as-1', asset: 'BTC', horizonStart: asOf, horizonEnd: '2026-09-28T01:00:00.000Z',
        baseCase: '震荡', conditions: ['区间不破'], invalidation: '跌破支撑', nextCatalyst: null, status: 'pending', verificationDueAt: '2026-09-28T01:00:00.000Z', createdAt: asOf
      }]
    })
    vi.stubGlobal('window', { platform: { products: { invoke } } })

    await expect(marketAnalysisTimelineClient.getDetail(entry)).resolves.toEqual(expect.objectContaining({
      state: 'available', detail: expect.objectContaining({
        run: expect.objectContaining({ evidenceCount: 2, change: { summary: '~actual:3.2->3.4', facts: [{ domain: 'macro', subject: 'CPI', metric: 'actual', unit: '%', kind: 'changed', previousValue: '3.2', value: '3.4' }], missingDomainsAdded: [], missingDomainsRemoved: [], caveatsAdded: 0, caveatsRemoved: 0, evidenceRefsAdded: 0, evidenceRefsRemoved: 0 } }),
        summary: expect.objectContaining({ version: 1, evidenceCount: 2 }),
        predictions: [expect.objectContaining({ asset: 'BTC', status: 'pending' })]
      })
    }))
  })

  it('names the refusals a reader can act on instead of blaming the model configuration', async () => {
    const entry = { id: 'mi-tl-1', eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1', kind: 'analysis' as const, status: 'published' as const, occurredAt: asOf, summaryRef: 'mi-as-1', safeTitle: 't', safeExcerpt: 'e', version: 1 }
    void entry
    const invokeFor = (error: string) => vi.fn(async () => { throw new Error(error) })
    const cases: readonly (readonly [string, string])[] = [
      // A click during a restart hits this one: the main process answers before its runtime is wired.
      ['analysis-initial-request-unavailable', 'not-ready'],
      ['analysis-not-eligible', 'not-eligible'],
      ['analysis-already-available', 'already-available'],
      ['something-else-entirely', 'failed']
    ]
    for (const [error, reason] of cases) {
      vi.stubGlobal('window', { platform: { products: { invoke: invokeFor(error) } } })
      await expect(marketAnalysisTimelineClient.requestInitialAnalysis(undefined, 'refresh')).resolves.toEqual({ state: 'unavailable', reason })
    }
  })

  it('carries which open a slot run served, and drops a malformed one instead of the entry', async () => {
    const invoke = vi.fn(async (_productId: string, method: string) => {
      if (method === 'marketAnalysis.listTimeline') return {
        schemaVersion: 1, nextCursor: null,
        items: [
          { id: 'mi-tl-1', eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1', kind: 'analysis', status: 'published', occurredAt: asOf, summaryRef: 'mi-as-1', safeTitle: '市场分析已生成', safeExcerpt: '摘要', version: 1,
            // A delayed catch-up of the European open, as the reader saw it: the line has to be able
            // to say which open it was, or a 01:21 analysis labelled "欧洲盘" looks like a mistake.
            triggerStatus: { triggerKey: 'schedule.europe.open', reasonCode: 'session-slot-europe', decidedAt: '2026-10-13T17:21:16.780Z', slotOpenAt: '2026-10-13T08:00:00.000Z', slotDelayed: true } },
          { id: 'mi-tl-2', eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-2', kind: 'analysis', status: 'published', occurredAt: asOf, summaryRef: 'mi-as-2', safeTitle: '市场分析已生成', safeExcerpt: '摘要', version: 1,
            // An unreadable open is dropped; the decision itself still explains the run.
            triggerStatus: { triggerKey: 'schedule.asia.open', reasonCode: 'session-slot-asia', decidedAt: '2026-10-13T17:21:16.780Z', slotOpenAt: 'yesterday' } }
        ]
      }
      return []
    })
    vi.stubGlobal('window', { platform: { products: { invoke } } })

    const page = await marketAnalysisTimelineClient.listTimeline()
    expect(page.state).toBe('available')
    const items = page.state === 'available' ? page.page.items : []
    expect(items[0]?.triggerStatus).toEqual({
      triggerKey: 'schedule.europe.open', reasonCode: 'session-slot-europe', decidedAt: '2026-10-13T17:21:16.780Z',
      slotOpenAt: '2026-10-13T08:00:00.000Z', slotDelayed: true
    })
    expect(items[1]?.triggerStatus).toEqual({ triggerKey: 'schedule.asia.open', reasonCode: 'session-slot-asia', decidedAt: '2026-10-13T17:21:16.780Z' })
  })

  it('renders a conclusion that cites more claims than the render bound, instead of blanking itself', async () => {
    // The real defect: the newest conclusion cited 54 facts, the panel's 50-item bound is a rendering
    // limit rather than a validity rule, and rejecting the payload turned the whole detail into
    // "详情暂不可用" for the richest analysis in the store.
    const entry = {
      id: 'mi-tl-1', eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1', kind: 'analysis' as const, status: 'published' as const,
      occurredAt: asOf, summaryRef: 'mi-as-1', safeTitle: '市场分析已生成', safeExcerpt: '摘要', version: 1
    }
    const knownFacts = Array.from({ length: 54 }, (_, index) => ({ factId: `f${index}`, statement: `事实 ${index}`, evidenceRefIds: ['ev-1'] }))
    const invoke = vi.fn(async (_productId: string, method: string) => {
      if (method === 'marketAnalysis.getAnalysisRun') return {
        id: 'mi-ar-1', eventGroupId: 'mi-eg-1', analysisPhase: 'correction', status: 'succeeded', failureCode: null,
        queuedAt: asOf, startedAt: asOf, completedAt: asOf, asOf, dataCutoff: asOf, evidenceCount: 1
      }
      if (method === 'marketAnalysis.getSummary') return {
        id: 'mi-as-1', schemaVersion: 1, analysisRunId: 'mi-ar-1', eventGroupId: 'mi-eg-1', version: 1,
        eventAssessment: '方向：偏空：资金面转弱。', knownFacts, transmissionHypotheses: [], marketReaction: [],
        supportingEvidence: [], counterEvidence: [], scenarios: [], nextCatalysts: [], dataCaveats: [], evidenceRefs: ['ev-1'], createdAt: asOf
      }
      return []
    })
    vi.stubGlobal('window', { platform: { products: { invoke } } })

    const result = await marketAnalysisTimelineClient.getDetail(entry)
    expect(result.state).toBe('available')
    expect(result.state === 'available' ? result.detail.summary.knownFacts : []).toHaveLength(50)
  })

  it('carries the operation directions through the wire, one row per horizon', async () => {
    const entry = {
      id: 'mi-tl-1', eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1', kind: 'analysis' as const, status: 'published' as const,
      occurredAt: asOf, summaryRef: 'mi-as-1', safeTitle: '市场分析已生成', safeExcerpt: '摘要', version: 1
    }
    const directions = [
      { horizon: 'short', direction: '偏多', rationale: '资金流转正。', confidence: 'medium', evidenceRefIds: ['ev-1'] },
      { horizon: 'medium', direction: '震荡', rationale: '缺少方向性资金。', confidence: 'low', evidenceRefIds: ['ev-1'] },
      { horizon: 'long', direction: '暂不判断', rationale: '长期证据不足。', confidence: 'low', evidenceRefIds: ['ev-1'] }
    ]
    const invoke = vi.fn(async (_productId: string, method: string) => {
      if (method === 'marketAnalysis.getAnalysisRun') return {
        id: 'mi-ar-1', eventGroupId: 'mi-eg-1', analysisPhase: 'correction', status: 'succeeded', failureCode: null,
        queuedAt: asOf, startedAt: asOf, completedAt: asOf, asOf, dataCutoff: asOf, evidenceCount: 1
      }
      if (method === 'marketAnalysis.getSummary') return {
        id: 'mi-as-1', schemaVersion: 1, analysisRunId: 'mi-ar-1', eventGroupId: 'mi-eg-1', version: 1,
        eventAssessment: '方向：偏多：资金流转正。', knownFacts: [], transmissionHypotheses: [], marketReaction: [],
        supportingEvidence: [], counterEvidence: [], scenarios: [], directions, nextCatalysts: [],
        dataCaveats: [], evidenceRefs: ['ev-1'], createdAt: asOf
      }
      return []
    })
    vi.stubGlobal('window', { platform: { products: { invoke } } })

    const result = await marketAnalysisTimelineClient.getDetail(entry)
    expect(result.state).toBe('available')
    // The whole detail used to be dropped when a key it did not know appeared; the sanitiser must
    // both accept the field and actually return it (scenarios was accepted and then thrown away).
    expect(result.state === 'available' ? result.detail.summary.directions : undefined).toEqual([
      { horizon: 'short', direction: '偏多', rationale: '资金流转正。', confidence: 'medium' },
      { horizon: 'medium', direction: '震荡', rationale: '缺少方向性资金。', confidence: 'low' },
      { horizon: 'long', direction: '暂不判断', rationale: '长期证据不足。', confidence: 'low' }
    ])
  })

  it('drops the whole detail when the directions are malformed, and keeps working without them', async () => {
    const entry = {
      id: 'mi-tl-1', eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1', kind: 'analysis' as const, status: 'published' as const,
      occurredAt: asOf, summaryRef: 'mi-as-1', safeTitle: '市场分析已生成', safeExcerpt: '摘要', version: 1
    }
    const summary = (directions?: unknown) => ({
      id: 'mi-as-1', schemaVersion: 1, analysisRunId: 'mi-ar-1', eventGroupId: 'mi-eg-1', version: 1,
      eventAssessment: '方向：偏多：资金流转正。', knownFacts: [], transmissionHypotheses: [], marketReaction: [],
      supportingEvidence: [], counterEvidence: [], scenarios: [], ...(directions === undefined ? {} : { directions }),
      nextCatalysts: [], dataCaveats: [], evidenceRefs: ['ev-1'], createdAt: asOf
    })
    const invokeFor = (payload: unknown) => vi.fn(async (_productId: string, method: string) => {
      if (method === 'marketAnalysis.getAnalysisRun') return {
        id: 'mi-ar-1', eventGroupId: 'mi-eg-1', analysisPhase: 'correction', status: 'succeeded', failureCode: null,
        queuedAt: asOf, startedAt: asOf, completedAt: asOf, asOf, dataCutoff: asOf, evidenceCount: 1
      }
      if (method === 'marketAnalysis.getSummary') return payload
      return []
    })

    // A summary published before the field existed stays readable.
    vi.stubGlobal('window', { platform: { products: { invoke: invokeFor(summary()) } } })
    const legacy = await marketAnalysisTimelineClient.getDetail(entry)
    expect(legacy.state).toBe('available')
    expect(legacy.state === 'available' ? legacy.detail.summary.directions : undefined).toBeUndefined()

    // A row missing its reason is malformed, and the panel must not print half of it.
    vi.stubGlobal('window', { platform: { products: { invoke: invokeFor(summary([{ horizon: 'short', direction: '偏多', confidence: 'medium', evidenceRefIds: [] }])) } } })
    await expect(marketAnalysisTimelineClient.getDetail(entry)).resolves.toEqual({ state: 'unavailable' })
  })

  it('still renders a run that does not carry the optional change summary', async () => {
    // A renderer can be newer than the local service that answers the IPC (an app
    // that has not been restarted yet), so an absent optional field must not turn
    // the whole detail into "unavailable".
    const entry = {
      id: 'mi-tl-1', eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1', kind: 'analysis' as const, status: 'published' as const,
      occurredAt: asOf, summaryRef: 'mi-as-1', safeTitle: '市场分析已生成', safeExcerpt: '摘要', version: 1
    }
    const invoke = vi.fn(async (_productId: string, method: string) => {
      if (method === 'marketAnalysis.getAnalysisRun') return {
        id: 'mi-ar-1', eventGroupId: 'mi-eg-1', analysisPhase: 'initial', status: 'succeeded', failureCode: null,
        queuedAt: asOf, startedAt: asOf, completedAt: asOf, asOf, dataCutoff: asOf, evidenceCount: 2
      }
      if (method === 'marketAnalysis.getSummary') return {
        id: 'mi-as-1', schemaVersion: 1, analysisRunId: 'mi-ar-1', eventGroupId: 'mi-eg-1', version: 1,
        eventAssessment: '市场情绪偏谨慎', knownFacts: [], transmissionHypotheses: [], marketReaction: [],
        supportingEvidence: [], counterEvidence: [], scenarios: [], nextCatalysts: [], dataCaveats: [], evidenceRefs: ['ev-1'], createdAt: asOf
      }
      return []
    })
    vi.stubGlobal('window', { platform: { products: { invoke } } })

    const result = await marketAnalysisTimelineClient.getDetail(entry)
    expect(result.state).toBe('available')
    expect(result.state === 'available' ? result.detail.summary.eventAssessment : undefined).toBe('市场情绪偏谨慎')
  })
})
