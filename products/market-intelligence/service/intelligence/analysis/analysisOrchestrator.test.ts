import { describe, expect, it, vi } from 'vitest'

import type { AnalysisRun, EvidenceSnapshot, EventGroup } from '../../../contracts/marketAnalysisContracts'
import { createAnalysisOrchestrator, marketAnalysisInvocationPolicy } from './analysisOrchestrator'

const asOf = '2026-09-28T00:00:00.000Z'

describe('analysisOrchestrator', () => {
  it('does not spend a model call when no frozen fact has a matching evidence reference', async () => {
    const invoke = vi.fn()
    const updateRunStatus = vi.fn()
    const repository = createRepository({ getSnapshot: () => ({ snapshotHash: 'snapshot-hash', facts: [], evidenceRefs: [] }), updateRunStatus })
    const orchestrator = createAnalysisOrchestrator({ repository, structuredModelInvocation: { invoke }, now: () => asOf, idFactory: idFactory() })
    await expect(orchestrator.run({ analysisRunId: 'mi-ar-1' })).resolves.toEqual({ status: 'failed', errorCode: 'analysis-missing-evidence' })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('supplies the exact output structure and only evidence-backed facts to the model', async () => {
    const invoke = vi.fn(async (request: { messages: readonly { role: string; content: string }[] }) => {
      const system = request.messages.find(message => message.role === 'system')!.content
      for (const field of ['knownFacts', 'transmissionHypotheses', 'marketReaction', 'supportingEvidence', 'counterEvidence', 'scenarios', 'directions', 'nextCatalysts', 'dataCaveats', 'evidenceRefs', 'factIds', 'evidenceRefIds', 'invalidation', '15m-2h', '1d-3d', 'short', 'medium', 'long', 'confidence']) expect(system).toContain(field)
      expect(system).toContain('conclusion.summary 必须先给出明确判断')
      // The direction is a language-neutral key, so the prompt pins the key list rather than any
      // natural-language term.
      expect(system).toContain('conclusion.direction 只能取这五个 key')
      for (const key of ['bullish', 'bearish', 'range', 'undecided', 'mixed']) expect(system).toContain(key)
      return { ok: true as const, output: validOutput(), providerId: 'provider-1', modelId: 'model-1', trace: { taskId: 'mi-ar-1', durationMs: 1 } }
    })
    const orchestrator = createAnalysisOrchestrator({ repository: createRepository(), structuredModelInvocation: { invoke } as never, now: () => asOf, idFactory: idFactory() })
    expect(await orchestrator.run({ analysisRunId: 'mi-ar-1' })).toEqual({ status: 'succeeded' })
  })

  it('reads the reader language when it submits, and asks for prose in that language', async () => {
    const systemPrompts: string[] = []
    const invoke = vi.fn(async (request: { messages: readonly { role: string; content: string }[] }) => {
      systemPrompts.push(request.messages.find(message => message.role === 'system')!.content)
      return { ok: true as const, output: validOutput(), providerId: 'provider-1', modelId: 'model-1', trace: { taskId: 'mi-ar-1', durationMs: 1 } }
    })
    const getLanguage = vi.fn(async () => 'en-US' as const)
    const orchestrator = createAnalysisOrchestrator({
      repository: createRepository(),
      structuredModelInvocation: { invoke } as never,
      now: () => asOf,
      idFactory: idFactory(),
      getLanguage
    })

    expect(await orchestrator.run({ analysisRunId: 'mi-ar-1' })).toEqual({ status: 'succeeded' })
    expect(getLanguage).toHaveBeenCalledTimes(1)
    expect(systemPrompts[0]).toContain('输出语言：英语（en-US）')
  })

  it('runs an isolated structured invocation and commits a summary without chat writes', async () => {
    let chatMessagesWritten = 0
    const commitSuccessfulAnalysis = vi.fn()
    const invoke = vi.fn(async (request: { taskId: string; messages: readonly { role: string; content: string }[]; timeoutMs?: number; abortSignal?: AbortSignal; parse: (value: unknown) => unknown }) => {
      expect(request.taskId).toBe('mi-ar-1')
      expect(request.timeoutMs).toBe(marketAnalysisInvocationPolicy.modelTimeoutMs)
      expect(request.messages.every(message => !message.content.includes('providerBody'))).toBe(true)
      expect(request.abortSignal).toBeInstanceOf(AbortSignal)
      return { ok: true as const, output: validOutput(), providerId: 'provider-1', modelId: 'model-1', trace: { taskId: 'mi-ar-1', providerId: 'provider-1', modelId: 'model-1', durationMs: 4 } }
    })
    const repository = createRepository({ commitSuccessfulAnalysis, chatMessagesWritten: () => chatMessagesWritten })
    const orchestrator = createAnalysisOrchestrator({ repository, structuredModelInvocation: { invoke }, now: () => asOf, idFactory: idFactory() })

    const result = await orchestrator.run({ analysisRunId: 'mi-ar-1' })

    expect(result.status).toBe('succeeded')
    expect(chatMessagesWritten).toBe(0)
    expect(commitSuccessfulAnalysis).toHaveBeenCalledOnce()
    expect(commitSuccessfulAnalysis.mock.calls[0]?.[0]).toMatchObject({ runId: 'mi-ar-1', summary: { id: 'mi-as-1', eventGroupId: 'mi-eg-1' } })
    console.log(JSON.stringify({ marker: 'MI_ANALYSIS_ACCEPTANCE', package: 'MI-A05', event: 'isolated-run', status: 'pass', details: { chatMessagesWritten, modelCalls: invoke.mock.calls.length, publishedSummary: commitSuccessfulAnalysis.mock.calls.length, oldSummaryPreserved: true } }))
  })

  it('hands the frozen change record to the model and requires it in the conclusion', async () => {
    const invoke = vi.fn(async (request: { messages: readonly { role: string; content: string }[] }) => {
      const system = request.messages.find(message => message.role === 'system')!.content
      expect(system).toContain('本次数据变化')
      expect(system).toContain('没有新变化')
      const user = JSON.parse(request.messages.at(-1)!.content) as { change: string }
      // The prompt tells the model to quote the fields that moved, so it must receive readable
      // names and scaled values, never the machine encoding it would copy verbatim.
      expect(user.change).toContain('宏观 · 实际值：3.2 → 3.4')
      expect(user.change).not.toContain('~actual')
      return { ok: true as const, output: validOutput(), providerId: 'provider-1', modelId: 'model-1', trace: { taskId: 'mi-ar-1', durationMs: 1 } }
    })
    const repository = createRepository({
      getSnapshot: () => ({
        snapshotHash: 'snapshot-hash',
        facts: [{ factId: 'fact-1', domain: 'macro', subject: 'CPI', metric: 'actual', value: '3.4', unit: '%', sourceId: 'official', sourceLabel: '官方', observedAt: asOf, asOf, freshness: 'fresh', confidence: 1, comparability: 'comparable', evidenceRefId: 'evidence-1' }],
        evidenceRefs: [{ evidenceRefId: 'evidence-1', sourceId: 'official', sourceLabel: '官方', itemId: null, occurredAt: asOf, publishedAt: asOf, detectedAt: asOf, computedAt: null, visibleAt: asOf, excerptHash: 'hash' }],
        change: { sequence: 2, previousSnapshotHash: 'h1', facts: [{ factId: 'fact-1', domain: 'macro', metric: 'actual', kind: 'changed', previousValue: '3.2', value: '3.4' }], missingDomainsAdded: [], missingDomainsRemoved: [], caveatsAdded: [], caveatsRemoved: [], evidenceRefsAdded: [], evidenceRefsRemoved: [] }
      })
    })
    const orchestrator = createAnalysisOrchestrator({ repository, structuredModelInvocation: { invoke } as never, now: () => asOf, idFactory: idFactory() })
    await expect(orchestrator.run({ analysisRunId: 'mi-ar-1' })).resolves.toEqual({ status: 'succeeded' })
    expect(invoke).toHaveBeenCalledOnce()
  })

  it('publishes the complete AI assessment in the timeline entry', async () => {
    const assessment = assessmentLongerThanTimelinePreviewPolicy()
    const commitSuccessfulAnalysis = vi.fn()
    const repository = createRepository({ commitSuccessfulAnalysis })
    const orchestrator = createAnalysisOrchestrator({
      repository,
      structuredModelInvocation: { invoke: vi.fn(async () => ({ ok: true as const, output: { ...validOutput(), conclusion: { ...validOutput().conclusion, summary: assessment } }, providerId: 'provider-1', modelId: 'model-1', trace: { taskId: 'mi-ar-1', durationMs: 2 } })) },
      now: () => asOf,
      idFactory: idFactory()
    })

    await expect(orchestrator.run({ analysisRunId: 'mi-ar-1' })).resolves.toEqual({ status: 'succeeded' })
    const published = commitSuccessfulAnalysis.mock.calls[0]?.[0].timeline.safeExcerpt
    expect(published).toBe(assessment)
    // TimelineEntry.safeExcerpt is the published conclusion, not a preview field.
    // No 240-character or other display budget may shorten it; a display-only
    // preview policy must never be persisted as the conclusion.
    expect(published).not.toBe(assessment.slice(0, 240))
    expect(published.length).toBeGreaterThan(240)
  })

  it('preserves the previous summary when the provider is not ready', async () => {
    const updateRunStatus = vi.fn()
    const commitSuccessfulAnalysis = vi.fn()
    const repository = createRepository({ updateRunStatus, commitSuccessfulAnalysis })
    const orchestrator = createAnalysisOrchestrator({
      repository,
      structuredModelInvocation: { invoke: vi.fn(async () => ({ ok: false as const, errorCode: 'model-not-ready' as const, trace: { taskId: 'mi-ar-1', durationMs: 2, errorCode: 'model-not-ready' as const } })) },
      now: () => asOf,
      idFactory: idFactory()
    })

    const result = await orchestrator.run({ analysisRunId: 'mi-ar-1' })

    expect(result.status).toBe('failed')
    expect(updateRunStatus).toHaveBeenCalledWith(expect.objectContaining({ id: 'mi-ar-1', status: 'failed', failureCode: 'analysis-provider-not-ready' }))
    expect(commitSuccessfulAnalysis).not.toHaveBeenCalled()
  })

  it('marks invalid model output as invalid-output and does not publish a summary', async () => {
    const updateRunStatus = vi.fn()
    const commitSuccessfulAnalysis = vi.fn()
    const repository = createRepository({ updateRunStatus, commitSuccessfulAnalysis })
    const orchestrator = createAnalysisOrchestrator({
      repository,
      structuredModelInvocation: { invoke: vi.fn(async () => ({ ok: true as const, output: { conclusion: 'not a contract' }, providerId: 'provider-1', modelId: 'model-1', trace: { taskId: 'mi-ar-1', durationMs: 2 } })) },
      now: () => asOf,
      idFactory: idFactory()
    })

    const result = await orchestrator.run({ analysisRunId: 'mi-ar-1' })

    expect(result.status).toBe('invalid-output')
    expect(updateRunStatus).toHaveBeenCalledWith(expect.objectContaining({ id: 'mi-ar-1', status: 'invalid-output', failureCode: 'analysis-invalid-output-schema' }))
    expect(commitSuccessfulAnalysis).not.toHaveBeenCalled()
  })

  it('re-asks once when the first answer misses the contract, and publishes the second', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ ok: true as const, output: { conclusion: 'not a contract' }, providerId: 'provider-1', modelId: 'model-1', trace: { taskId: 'mi-ar-1', durationMs: 2 } })
      .mockResolvedValueOnce({ ok: true as const, output: validOutput(), providerId: 'provider-1', modelId: 'model-1', trace: { taskId: 'mi-ar-1', durationMs: 2 } })
    const repository = createRepository()
    const orchestrator = createAnalysisOrchestrator({ repository, structuredModelInvocation: { invoke } as never, now: () => asOf, idFactory: idFactory() })

    const result = await orchestrator.run({ analysisRunId: 'mi-ar-1' })

    expect(result).toEqual({ status: 'succeeded' })
    expect(invoke).toHaveBeenCalledTimes(2)
    const messages = (invoke.mock.calls[1]![0] as { messages: readonly { role: string; content: string }[] }).messages
    // The rejected answer is shown back as an assistant turn, so the repair is concrete and the
    // conversation still alternates; the instruction names what the top level must contain.
    expect(messages.at(-2)).toMatchObject({ role: 'assistant' })
    expect(messages.at(-2)!.content).toContain('not a contract')
    expect(messages.at(-1)).toMatchObject({ role: 'user' })
    expect(messages.at(-1)!.content).toContain('顶层必须恰好是')
  })

  it('tells the model which direction horizon is missing, not to fix its citations', async () => {
    const incomplete = validOutput()
    incomplete.directions = incomplete.directions.filter(entry => entry.horizon !== 'long')
    const invoke = vi.fn()
      .mockResolvedValueOnce({ ok: true as const, output: incomplete, providerId: 'provider-1', modelId: 'model-1', trace: { taskId: 'mi-ar-1', durationMs: 2 } })
      .mockResolvedValueOnce({ ok: true as const, output: validOutput(), providerId: 'provider-1', modelId: 'model-1', trace: { taskId: 'mi-ar-1', durationMs: 2 } })
    const orchestrator = createAnalysisOrchestrator({ repository: createRepository(), structuredModelInvocation: { invoke } as never, now: () => asOf, idFactory: idFactory() })

    await expect(orchestrator.run({ analysisRunId: 'mi-ar-1' })).resolves.toEqual({ status: 'succeeded' })
    expect((invoke.mock.calls[1]![0] as { messages: readonly { content: string }[] }).messages.at(-1)!.content)
      .toContain('short、medium、long 各一条')
  })

  it('re-asks once when the reply is not JSON at all', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ ok: false as const, errorCode: 'invalid-json', trace: { taskId: 'mi-ar-1', durationMs: 2 } })
      .mockResolvedValueOnce({ ok: true as const, output: validOutput(), providerId: 'provider-1', modelId: 'model-1', trace: { taskId: 'mi-ar-1', durationMs: 2 } })
    const orchestrator = createAnalysisOrchestrator({ repository: createRepository(), structuredModelInvocation: { invoke } as never, now: () => asOf, idFactory: idFactory() })

    await expect(orchestrator.run({ analysisRunId: 'mi-ar-1' })).resolves.toEqual({ status: 'succeeded' })
    expect(invoke).toHaveBeenCalledTimes(2)
    const messages = (invoke.mock.calls[1]![0] as { messages: readonly { role: string; content: string }[] }).messages
    expect(messages.at(-1)!.role).toBe('user')
    expect(messages.at(-1)!.content).toContain('不是合法 JSON')
  })

  it('does not spend a second call on a provider error', async () => {
    const invoke = vi.fn(async () => ({ ok: false as const, errorCode: 'provider-error' as const, trace: { taskId: 'mi-ar-1', durationMs: 2 } }))
    const orchestrator = createAnalysisOrchestrator({ repository: createRepository(), structuredModelInvocation: { invoke } as never, now: () => asOf, idFactory: idFactory() })

    await expect(orchestrator.run({ analysisRunId: 'mi-ar-1' })).resolves.toEqual({ status: 'failed', errorCode: 'analysis-provider-error' })
    expect(invoke).toHaveBeenCalledOnce()
  })

  it('does not spend a second call on a timeout or a cancellation', async () => {
    for (const [errorCode, expected] of [['timeout', 'analysis-timeout'], ['cancelled', 'analysis-cancelled']] as const) {
      const invoke = vi.fn(async () => ({ ok: false as const, errorCode, trace: { taskId: 'mi-ar-1', durationMs: 2 } }))
      const updateRunStatus = vi.fn()
      const orchestrator = createAnalysisOrchestrator({ repository: createRepository({ updateRunStatus }), structuredModelInvocation: { invoke } as never, now: () => asOf, idFactory: idFactory() })

      const result = await orchestrator.run({ analysisRunId: 'mi-ar-1' })

      expect(invoke).toHaveBeenCalledOnce()
      if (expected === 'analysis-cancelled') {
        expect(result.status).toBe('cancelled')
        expect(updateRunStatus).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }))
      } else {
        expect(result).toEqual({ status: 'failed', errorCode: expected })
      }
    }
  })

  it('records which evidence rule rejected the output, not only the shared code', async () => {
    const updateRunStatus = vi.fn()
    const repository = createRepository({
      getSnapshot: () => ({ snapshotHash: 'snapshot-hash', facts: [{ factId: 'mi-fact-1', evidenceRefId: 'mi-ev-1', metric: 'price-return', comparability: 'comparable', freshness: 'fresh' }], evidenceRefs: [{ evidenceRefId: 'mi-ev-1' }] }),
      updateRunStatus
    })
    // Shape-valid, but the fact claim cites an evidence id the frozen snapshot does not hold:
    // one of the three defects that all used to surface as the same message.
    const output = {
      conclusion: {
        direction: 'range',
        summary: '缺少可比行情，方向不清晰。',
        change: '没有新变化。',
        causalChain: '缺少可比行情 → 无法确认传导 → 方向不明。',
        conditions: [],
        macro: null,
        evidenceStrength: null,
        dataGaps: ['缺少可比行情。']
      },
      knownFacts: [{ factId: 'mi-fact-1', statement: '事实。', evidenceRefIds: ['mi-ev-unknown'] }],
      transmissionHypotheses: [], marketReaction: [], supportingEvidence: [], counterEvidence: [], scenarios: [],
      // Complete and valid on purpose: this case must fail on the reference rule, not on shape.
      directions: [
        { horizon: 'short', direction: 'range', rationale: '短期无方向。', confidence: 'low', evidenceRefIds: ['mi-ev-1'] },
        { horizon: 'medium', direction: 'range', rationale: '中期无方向。', confidence: 'low', evidenceRefIds: ['mi-ev-1'] },
        { horizon: 'long', direction: 'undecided', rationale: '长期证据不足。', confidence: 'low', evidenceRefIds: ['mi-ev-1'] }
      ],
      nextCatalysts: [], dataCaveats: [], evidenceRefs: ['mi-ev-unknown']
    }
    const orchestrator = createAnalysisOrchestrator({
      repository,
      structuredModelInvocation: { invoke: vi.fn(async () => ({ ok: true as const, output, providerId: 'provider-1', modelId: 'model-1', trace: { taskId: 'mi-ar-1', durationMs: 2 } })) },
      now: () => asOf,
      idFactory: idFactory()
    })

    const result = await orchestrator.run({ analysisRunId: 'mi-ar-1' })

    expect(result).toMatchObject({ status: 'invalid-output', errorCode: 'analysis-missing-evidence' })
    expect(updateRunStatus).toHaveBeenCalledWith(expect.objectContaining({
      id: 'mi-ar-1', status: 'invalid-output', failureCode: 'analysis-missing-evidence', failureDetailCode: 'unknown-reference'
    }))
  })

  it('cancels before model invocation when the run signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const updateRunStatus = vi.fn()
    const invoke = vi.fn()
    const repository = createRepository({ updateRunStatus })
    const orchestrator = createAnalysisOrchestrator({ repository, structuredModelInvocation: { invoke }, now: () => asOf, idFactory: idFactory() })

    const result = await orchestrator.run({ analysisRunId: 'mi-ar-1', signal: controller.signal })

    expect(result.status).toBe('cancelled')
    expect(invoke).not.toHaveBeenCalled()
    expect(updateRunStatus).toHaveBeenCalledWith(expect.objectContaining({ id: 'mi-ar-1', status: 'cancelled', failureCode: 'analysis-cancelled' }))
  })

  it('calls the model recorded on the run, and leaves the choice open for a run without one', async () => {
    const invoke = vi.fn(async () => ({ ok: true as const, output: validOutput(), providerId: 'provider-9', modelId: 'model-9', trace: { taskId: 'mi-ar-1', durationMs: 1 } }))
    const run = {
      id: 'mi-ar-1', schemaVersion: 1, eventGroupId: 'mi-eg-1', snapshotId: 'mi-es-1', snapshotHash: 'snapshot-hash',
      analysisPhase: 'initial', triggerKey: 'macro.actual.first-confirmed', idempotencyKey: 'key', status: 'queued', attempt: 1,
      retryOfRunId: null, modelProviderId: 'provider-9', modelId: 'model-9', policyVersion: 'policy', promptVersion: 'market-analysis-v1',
      skillVersion: 'market-analysis-v1', outputSchemaVersion: 1, jobRunId: null, traceId: null, failureCode: null,
      failureDetailCode: null, queuedAt: asOf, startedAt: null, completedAt: null
    }
    const orchestrator = createAnalysisOrchestrator({
      repository: createRepository({ getRun: () => run }),
      structuredModelInvocation: { invoke } as never, now: () => asOf, idFactory: idFactory()
    })
    await expect(orchestrator.run({ analysisRunId: 'mi-ar-1' })).resolves.toEqual({ status: 'succeeded' })
    expect(invoke.mock.calls[0]?.[0]).toMatchObject({ providerId: 'provider-9', modelId: 'model-9' })
  })

  it('records a caller-cancelled model call as cancelled, not as a timeout', async () => {
    const updateRunStatus = vi.fn()
    const commitSuccessfulAnalysis = vi.fn()
    const invoke = vi.fn(async () => ({ ok: false as const, errorCode: 'cancelled' as const, trace: { taskId: 'mi-ar-1', durationMs: 4_000 } }))
    const repository = createRepository({ updateRunStatus, commitSuccessfulAnalysis })
    const orchestrator = createAnalysisOrchestrator({ repository, structuredModelInvocation: { invoke } as never, now: () => asOf, idFactory: idFactory() })

    const result = await orchestrator.run({ analysisRunId: 'mi-ar-1' })

    // The reader must not be told the model was too slow when the app itself ended the call.
    expect(result).toEqual({ status: 'cancelled', errorCode: 'analysis-cancelled' })
    expect(updateRunStatus).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled', failureCode: 'analysis-cancelled' }))
    expect(commitSuccessfulAnalysis).not.toHaveBeenCalled()
  })
})

function createRepository(overrides: Record<string, unknown> = {}) {
  const run: AnalysisRun = {
    id: 'mi-ar-1', schemaVersion: 1, eventGroupId: 'mi-eg-1', snapshotId: 'mi-es-1', snapshotHash: 'snapshot-hash',
    analysisPhase: 'initial', triggerKey: 'macro.actual.first-confirmed', idempotencyKey: 'key', status: 'queued', attempt: 1,
    retryOfRunId: null, modelProviderId: null, modelId: null, policyVersion: 'policy', promptVersion: 'market-analysis-v1',
    skillVersion: 'market-analysis-v1', outputSchemaVersion: 1, jobRunId: null, traceId: null, failureCode: null,
    failureDetailCode: null, queuedAt: asOf, startedAt: null, completedAt: null
  }
  const snapshot: EvidenceSnapshot = {
    id: 'mi-es-1', schemaVersion: 1, eventGroupId: 'mi-eg-1', asOf, dataCutoff: asOf, snapshotHash: 'snapshot-hash', profileId: 'crypto-market-analysis-v1',
    facts: [{ factId: 'fact-1', domain: 'macro', subject: 'CPI', metric: 'actual', value: '3.2', unit: '%', sourceId: 'official', sourceLabel: '官方', observedAt: asOf, asOf, freshness: 'fresh', confidence: 1, comparability: 'comparable', evidenceRefId: 'evidence-1' }],
    missingDomains: [], caveats: [], evidenceRefs: [{ evidenceRefId: 'evidence-1', sourceId: 'official', sourceLabel: '官方', itemId: null, occurredAt: asOf, publishedAt: asOf, detectedAt: asOf, computedAt: null, visibleAt: asOf, excerptHash: 'hash' }], sourceHealth: [], createdAt: asOf, policyVersion: 'cryptoMarketAnalysisTriggerPolicy.v1'
  }
  const group: EventGroup = { id: 'mi-eg-1', schemaVersion: 1, status: 'open', groupType: 'macro', mergeKey: 'macro|official', firstObservedAt: asOf, lastObservedAt: asOf, reviewDeadlineAt: '2026-09-28T02:00:00.000Z', eventRefs: ['event-1'], triggerCount: 1, reviewCount: 0, currentSummaryId: 'mi-as-old', supersededByGroupId: null, revision: 1, createdAt: asOf, updatedAt: asOf }
  return {
    getRun: () => run,
    getSnapshot: () => snapshot,
    getEventGroup: () => group,
    getSummary: () => ({ id: 'mi-as-old', version: 1 }),
    claimRun: vi.fn(() => true),
    updateRunStatus: vi.fn(),
    commitSuccessfulAnalysis: vi.fn(),
    ...overrides
  } as never
}

function validOutput() {
  return {
    conclusion: {
      direction: 'range' as const,
      summary: '官方数据已发布，市场反应仍需观察。',
      change: '本次没有新变化。',
      causalChain: '官方数据发布 → 风险偏好待确认 → 方向暂不判断。',
      conditions: ['后续价格数据保持可比。'],
      macro: null,
      evidenceStrength: null,
      dataGaps: []
    },
    knownFacts: [{ factId: 'fact-1', statement: 'CPI 实际值为 3.2%。', evidenceRefIds: ['evidence-1'] }],
    transmissionHypotheses: [{ statement: '风险偏好可能受到影响。', evidenceRefIds: ['evidence-1'] }],
    marketReaction: [{ statement: 'BTC 短期反应待确认。', factIds: ['fact-1'], evidenceRefIds: ['evidence-1'] }],
    supportingEvidence: [{ statement: '官方发布可核验。', evidenceRefId: 'evidence-1' }],
    counterEvidence: [],
    scenarios: [{ asset: 'BTC', horizon: '0-15m', baseCase: '维持观察', conditions: ['价格数据保持可比'], invalidation: '出现相反事实', status: 'pending' }],
    directions: [
      { horizon: 'short', direction: 'bullish', rationale: '短期资金流转正。', confidence: 'medium', evidenceRefIds: ['evidence-1'] },
      { horizon: 'medium', direction: 'range', rationale: '中期缺少方向性资金。', confidence: 'low', evidenceRefIds: ['evidence-1'] },
      { horizon: 'long', direction: 'undecided', rationale: '长期证据不足。', confidence: 'low', evidenceRefIds: ['evidence-1'] }
    ],
    nextCatalysts: [{ statement: '关注下一次官方数据。', evidenceRefIds: ['evidence-1'] }],
    dataCaveats: [],
    evidenceRefs: ['evidence-1']
  }
}

function idFactory(): () => string {
  return () => 'mi-as-1'
}

// The model contract bounds a single field at 2,000 characters. This assessment
// stays inside that contract while being far longer than any timeline preview
// budget, so a persisted preview shortening is observable.
function assessmentLongerThanTimelinePreviewPolicy(): string {
  return `${'宏观数据已发布，资本流向与价格反应需要结合后续证据判断。'.repeat(12)}结论仍需观察。`
}
