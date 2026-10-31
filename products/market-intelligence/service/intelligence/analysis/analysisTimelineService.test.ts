import { describe, expect, it, vi } from 'vitest'

import { createAnalysisTimelineService } from './analysisTimelineService'

describe('analysisTimelineService', () => {
  it('allows follow-up on a historical successful run without replacing it with the current summary', async () => {
    const service = createAnalysisTimelineService({ repository: {
      getEventGroup: () => ({ id: 'mi-eg-1', currentSummaryId: 'mi-as-new' }),
      getRun: () => ({ id: 'mi-ar-old', eventGroupId: 'mi-eg-1', status: 'succeeded' }),
      getSummaryForRun: () => ({ id: 'mi-as-old', analysisRunId: 'mi-ar-old', eventGroupId: 'mi-eg-1' }),
      getSummary: () => ({ id: 'mi-as-new', analysisRunId: 'mi-ar-new', eventGroupId: 'mi-eg-1' })
    } as never, createFollowUpSession: async () => 's-1' })
    await expect(service.startFollowUp({ eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-old' })).resolves.toMatchObject({ analysisRunId: 'mi-ar-old', sessionId: 's-1' })
  })
  it('returns renderer-safe paged timeline data with an opaque cursor', () => {
    const fullAssessment = `${'宏观数据已发布，资本流向与价格反应需要结合后续证据判断。'.repeat(12)}结论仍需观察。`
    const service = createAnalysisTimelineService({
      repository: {
        listTimeline: vi.fn(() => ({ items: [{ id: 'mi-tl-1', schemaVersion: 1, eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1', kind: 'analysis', status: 'published', occurredAt: '2026-09-28T00:00:00.000Z', summaryRef: 'mi-as-1', safeTitle: '市场分析已生成', safeExcerpt: fullAssessment.slice(0, 240), version: 1 }], nextCursor: 'opaque-cursor' })),
        getSummary: vi.fn(() => ({ eventAssessment: fullAssessment }))
      } as never
    })

    const page = service.listTimeline({ eventGroupId: 'mi-eg-1', limit: 50 })

    expect(page).toEqual({ schemaVersion: 1, items: [{ id: 'mi-tl-1', eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1', kind: 'analysis', status: 'published', occurredAt: '2026-09-28T00:00:00.000Z', summaryRef: 'mi-as-1', safeTitle: '市场分析已生成', safeExcerpt: fullAssessment, direction: null, version: 1, triggerStatus: null, groupType: null, groupSubject: null }], nextCursor: 'opaque-cursor' })
    expect(() => JSON.parse(page.nextCursor!)).toThrow()
  })

  it('publishes the structured verdict and its direction key for current summaries', () => {
    const service = createAnalysisTimelineService({
      repository: {
        listTimeline: vi.fn(() => ({ items: [{ id: 'mi-tl-2', schemaVersion: 1, eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-2', kind: 'analysis', status: 'published', occurredAt: '2026-09-29T00:00:00.000Z', summaryRef: 'mi-as-2', safeTitle: '市场分析已生成', safeExcerpt: null, version: 2 }], nextCursor: null })),
        getSummary: vi.fn(() => ({ conclusion: { direction: 'bearish', summary: '收益率上行压制风险资产。' } }))
      } as never
    })

    const [entry] = service.listTimeline({ eventGroupId: 'mi-eg-1', limit: 50 }).items
    expect(entry?.safeExcerpt).toBe('收益率上行压制风险资产。')
    expect(entry?.direction).toBe('bearish')
  })

  it('restores a complete assessment for a historical node whose stored excerpt was truncated', () => {
    const fullAssessment = `${'宏观数据已发布，资本流向与价格反应需要结合后续证据判断。'.repeat(12)}结论仍需观察。`
    const truncated = fullAssessment.slice(0, 240)
    const entry = { id: 'mi-tl-1', schemaVersion: 1, eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1', kind: 'analysis', status: 'published', occurredAt: '2026-09-28T00:00:00.000Z', summaryRef: 'mi-as-1', safeTitle: '市场分析已生成', safeExcerpt: truncated, version: 1 }
    const service = createAnalysisTimelineService({
      repository: { listTimeline: vi.fn(() => ({ items: [entry], nextCursor: null })), getSummary: vi.fn(() => ({ eventAssessment: fullAssessment })) } as never
    })

    const [restored] = service.listTimeline({ eventGroupId: 'mi-eg-1', limit: 50 }).items
    expect(restored?.safeExcerpt).toBe(fullAssessment)
    expect(restored?.safeExcerpt).not.toBe(truncated)
  })

  it('reads the complete assessment through the entry lookup used by node selection', () => {
    const fullAssessment = `${'宏观数据已发布，资本流向与价格反应需要结合后续证据判断。'.repeat(12)}结论仍需观察。`
    const service = createAnalysisTimelineService({
      repository: {
        getTimelineEntry: vi.fn(() => ({ id: 'mi-tl-1', schemaVersion: 1, eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1', kind: 'analysis', status: 'published', occurredAt: '2026-09-28T00:00:00.000Z', summaryRef: 'mi-as-1', safeTitle: '市场分析已生成', safeExcerpt: fullAssessment.slice(0, 240), version: 1 })),
        getSummary: vi.fn(() => ({ eventAssessment: fullAssessment }))
      } as never
    })

    expect(service.getTimelineEntry('mi-tl-1').safeExcerpt).toBe(fullAssessment)
  })

  it('keeps an empty published assessment instead of falling back to the stored excerpt', () => {
    const entry = { id: 'mi-tl-1', schemaVersion: 1, eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1', kind: 'analysis', status: 'published', occurredAt: '2026-09-28T00:00:00.000Z', summaryRef: 'mi-as-1', safeTitle: '市场分析已生成', safeExcerpt: '历史截断摘要', version: 1 }
    const service = createAnalysisTimelineService({
      repository: { listTimeline: vi.fn(() => ({ items: [entry], nextCursor: null })), getSummary: vi.fn(() => ({ eventAssessment: '' })) } as never
    })

    expect(service.listTimeline({ eventGroupId: 'mi-eg-1', limit: 50 }).items[0]?.safeExcerpt).toBe('')
  })

  it('falls back to the stored excerpt when the summary is unreadable', () => {
    const entry = { id: 'mi-tl-1', schemaVersion: 1, eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1', kind: 'analysis', status: 'published', occurredAt: '2026-09-28T00:00:00.000Z', summaryRef: 'mi-as-1', safeTitle: '市场分析已生成', safeExcerpt: '历史截断摘要', version: 1 }
    const service = createAnalysisTimelineService({
      repository: {
        listTimeline: vi.fn(() => ({ items: [entry], nextCursor: null })),
        getSummary: vi.fn(() => { throw new Error('analysis-summary-not-found') })
      } as never
    })

    expect(service.listTimeline({ eventGroupId: 'mi-eg-1', limit: 50 }).items[0]?.safeExcerpt).toBe('历史截断摘要')
  })

  it('renders the frozen change summary for a run, deriving it when the stored record is absent', () => {
    const facts = [{ factId: 'f1', domain: 'macro', metric: 'actual', value: '3.4' }]
    const service = createAnalysisTimelineService({
      repository: {
        getRun: vi.fn(() => ({ id: 'mi-ar-1', eventGroupId: 'mi-eg-1', analysisPhase: 'initial', status: 'succeeded', failureCode: null, queuedAt: '2026-09-28T00:00:00.000Z', startedAt: null, completedAt: null, snapshotId: 'mi-es-2' })),
        getSnapshot: vi.fn(() => ({ id: 'mi-es-2', eventGroupId: 'mi-eg-1', createdAt: '2026-09-28T00:00:00.000Z', asOf: '2026-09-28T00:00:00.000Z', dataCutoff: '2026-09-28T00:00:00.000Z', snapshotHash: 'h2', facts, missingDomains: [], caveats: [], evidenceRefs: [], change: undefined })),
        listSnapshots: vi.fn(() => [{ id: 'mi-es-1', eventGroupId: 'mi-eg-1', createdAt: '2026-09-27T00:00:00.000Z', snapshotHash: 'h1', facts: [{ ...facts[0], value: '3.2' }], missingDomains: [], caveats: [], evidenceRefs: [] }])
      } as never
    })

    const change = service.getAnalysisRun('mi-ar-1').change
    // The renderer view must not carry the compact encoding: for a large diff it
    // exceeds the renderer's text bound and the whole detail is rejected.
    expect(change).not.toHaveProperty('summary')
    // The renderer must get display fields, not internal identifiers.
    expect(change?.facts).toEqual([expect.objectContaining({ domain: 'macro', metric: 'actual', kind: 'changed', previousValue: '3.2', value: '3.4' })])
  })

  it('creates one follow-up session only after validating the same event group and run', async () => {
    const createSession = vi.fn(async (input: { existingSessionId?: string }) => {
      if (input.existingSessionId && input.existingSessionId !== 'session-1') throw new Error('analysis-follow-up-unavailable')
      return 'session-1'
    })
    const service = createAnalysisTimelineService({
      repository: {
        getEventGroup: vi.fn((id: string) => id === 'mi-eg-1' ? ({ id: 'mi-eg-1', currentSummaryId: 'mi-as-1' }) : undefined),
        getRun: vi.fn(() => ({ id: 'mi-ar-1', eventGroupId: 'mi-eg-1', status: 'succeeded' })),
        getSummaryForRun: vi.fn(() => ({ id: 'mi-as-1', analysisRunId: 'mi-ar-1', eventGroupId: 'mi-eg-1' })),
        getSummary: vi.fn(() => ({ id: 'mi-as-1', analysisRunId: 'mi-ar-1', eventGroupId: 'mi-eg-1' }))
      } as never,
      createFollowUpSession: createSession
    })

    await expect(service.startFollowUp({ eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1' })).resolves.toEqual({ agentId: 'crypto-market-analyst', sessionId: 'session-1', eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1' })
    expect(createSession).toHaveBeenCalledOnce()
    await expect(service.startFollowUp({ eventGroupId: 'mi-eg-other', analysisRunId: 'mi-ar-1' })).rejects.toThrow('analysis-event-group-not-found')
    await expect(service.startFollowUp({ eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1', existingSessionId: 'foreign-session' })).rejects.toThrow('analysis-follow-up-unavailable')
  })
})

function timelineEntry(runId = 'mi-ar-1') {
  return { id: 'mi-tl-1', schemaVersion: 1, eventGroupId: 'mi-eg-1', analysisRunId: runId, kind: 'analysis', status: 'published', occurredAt: '2026-09-28T00:00:00.000Z', summaryRef: null, safeTitle: '市场分析已生成', safeExcerpt: null, version: 1 }
}

const floorDecision = { triggerKey: 'schedule.asia.open', reasonCode: 'session-slot', decision: 'queued', createdAt: '2026-09-27T07:02:09.203Z' }

function serviceFor(run: Record<string, unknown>, entryRunId = String(run.id)) {
  return createAnalysisTimelineService({ repository: {
    listTimeline: vi.fn(() => ({ items: [timelineEntry(entryRunId)], nextCursor: null })),
    listTriggerLedger: () => [
      { triggerKey: 'calendar.refresh', reasonCode: 'interval-active', decision: 'skipped', createdAt: '2026-09-28T00:00:00.000Z' },
      { triggerKey: 'calendar.refresh', reasonCode: 'significance-confirmed', decision: 'queued', createdAt: '2026-09-28T00:30:00.000Z' },
      floorDecision
    ],
    getEventGroup: () => ({ id: 'mi-eg-1', currentSummaryId: null }),
    getRun: (id: string) => id === run.id ? run : undefined,
    getSummary: () => undefined, getSummaryForRun: () => undefined, listPredictions: () => []
  } as never })
}

it('attaches the decision that explains the entry\'s own run, as tokens only', () => {
  const service = serviceFor({ id: 'mi-ar-1', triggerKey: 'calendar.refresh', queuedAt: '2026-09-28T00:31:00.000Z', completedAt: '2026-09-28T00:32:00.000Z' })
  expect(service.listTimeline({}).items[0]!.triggerStatus)
    .toEqual({ triggerKey: 'calendar.refresh', reasonCode: 'significance-confirmed', decidedAt: '2026-09-28T00:30:00.000Z' })
})

it('explains a reader-triggered entry as the reader\'s, never with the floor\'s decision', () => {
  // The reported defect: every row carried the group's newest explainable decision, so an
  // analysis the reader had just requested displayed the staleness floor's wording.
  const service = serviceFor({ id: 'mi-ar-manual', triggerKey: 'manual.refresh', queuedAt: '2026-09-28T01:00:00.000Z', completedAt: '2026-09-28T01:01:00.000Z' })
  expect(service.listTimeline({}).items[0]!.triggerStatus)
    .toEqual({ triggerKey: 'manual.refresh', reasonCode: 'manual-request', decidedAt: '2026-09-28T01:00:00.000Z' })
})

it('says nothing rather than guessing when the entry\'s run cannot be read', () => {
  const service = serviceFor({ id: 'mi-ar-1', triggerKey: 'calendar.refresh', queuedAt: '2026-09-28T00:31:00.000Z' }, 'mi-ar-absent')
  expect(service.listTimeline({}).items[0]!.triggerStatus).toBeNull()
})

// Two rows published twenty seconds apart are two different events. The list spans event groups,
// so without the group's own name the reader sees the same bearish paragraph posted twice.
describe('analysisTimelineService group identity', () => {
  const groups: Record<string, { id: string; currentSummaryId: string | null; groupType: string; mergeKey: string }> = {
    'mi-eg-news': { id: 'mi-eg-news', currentSummaryId: null, groupType: 'sentiment', mergeKey: 'sentiment|official|sentiment|A Nasdaq-listed company may sell $450 million bitcoin|1494542' },
    'mi-eg-macro': { id: 'mi-eg-macro', currentSummaryId: null, groupType: 'macro', mergeKey: 'macro|official|unknown|unknown|Fed Funds Target Range Upper|1494504' },
    'mi-eg-blank': { id: 'mi-eg-blank', currentSummaryId: null, groupType: 'funding', mergeKey: 'funding|official|unknown|unknown|1494550' }
  }
  const entry = (id: string, eventGroupId: string, occurredAt: string) => ({ id, schemaVersion: 1, eventGroupId, analysisRunId: null, kind: 'analysis' as const, status: 'published' as const, occurredAt, summaryRef: null, safeTitle: '市场分析已生成', safeExcerpt: '偏空。', version: 1 })

  it('names each row with its own group type and subject', () => {
    const service = createAnalysisTimelineService({
      repository: {
        listTimeline: () => ({ items: [entry('mi-tl-2', 'mi-eg-news', '2026-10-31T13:36:23.000Z'), entry('mi-tl-1', 'mi-eg-macro', '2026-10-31T13:36:04.000Z')], nextCursor: null }),
        getEventGroup: (id: string) => groups[id],
        getSummary: () => undefined, getRun: () => undefined, listPredictions: () => []
      } as never
    })

    const [newer, older] = service.listTimeline({}).items
    expect(newer).toMatchObject({ groupType: 'sentiment', groupSubject: 'A Nasdaq-listed company may sell $450 million bitcoin' })
    expect(older).toMatchObject({ groupType: 'macro', groupSubject: 'Fed Funds Target Range Upper' })
  })

  it('drops a subject that is only a placeholder instead of captioning the row with it', () => {
    const service = createAnalysisTimelineService({
      repository: {
        listTimeline: () => ({ items: [entry('mi-tl-3', 'mi-eg-blank', '2026-10-31T13:36:23.000Z')], nextCursor: null }),
        getEventGroup: (id: string) => groups[id],
        getSummary: () => undefined, getRun: () => undefined, listPredictions: () => []
      } as never
    })

    expect(service.listTimeline({}).items[0]).toMatchObject({ groupType: 'funding', groupSubject: null })
  })

  it('keeps the list readable when the group row cannot be read', () => {
    const service = createAnalysisTimelineService({
      repository: {
        listTimeline: () => ({ items: [entry('mi-tl-4', 'mi-eg-gone', '2026-10-31T13:36:23.000Z')], nextCursor: null }),
        getEventGroup: () => { throw new Error('mi_analysis_event_groups is locked') },
        getSummary: () => undefined, getRun: () => undefined, listPredictions: () => []
      } as never
    })

    expect(service.listTimeline({}).items[0]).toMatchObject({ groupType: null, groupSubject: null, safeExcerpt: '偏空。' })
  })
})
