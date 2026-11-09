import { describe, expect, it, vi } from 'vitest'

import type { NotificationSubmitOutcome, NotificationSubmitRequest } from '@platform/notifications/contracts/notificationContracts'
import type { AnalysisRun, AnalysisSummary } from '../../../contracts/marketAnalysisContracts'
import { createAnalysisConclusionManualSend } from './analysisConclusionManualSend'

/**
 * 「发送到频道」：读者点名发那一条。这里钉住三件事——
 * **与自动推送同一个构造器**、**去重键带点击时刻（所以不占真实键）**、**被拒的原因原样交回**。
 */

const asOf = '2026-11-08T03:00:00.000Z'
const clickAt = '2026-11-08T12:44:00.000Z'

const run = (overrides: Partial<AnalysisRun> = {}): AnalysisRun => ({
  id: 'mi-ar-1', schemaVersion: 1, eventGroupId: 'mi-eg-1', snapshotId: 'mi-es-1', snapshotHash: 'snapshot-hash',
  analysisPhase: 'initial', triggerKey: 'signal.open-interest.oi-liquidation-proxy', idempotencyKey: 'key',
  status: 'succeeded', attempt: 1, retryOfRunId: null, modelProviderId: null, modelId: null, validationMode: null,
  policyVersion: 'policy', promptVersion: 'market-analysis-v1', skillVersion: 'market-analysis-v1',
  outputSchemaVersion: 2, jobRunId: null, traceId: null, failureCode: null, failureDetailCode: null,
  queuedAt: asOf, startedAt: asOf, completedAt: asOf,
  ...overrides
})

const summary = (overrides: Partial<AnalysisSummary> = {}): AnalysisSummary => ({
  id: 'mi-as-1', schemaVersion: 1, analysisRunId: 'mi-ar-1', eventGroupId: 'mi-eg-1', version: 1,
  conclusion: {
    direction: 'bearish',
    summary: '多头被清，价格跌到位后买盘回来了。',
    change: 'no change',
    causalChain: 'chain',
    conditions: [],
    macro: null,
    evidenceStrength: null,
    dataGaps: []
  },
  knownFacts: [],
  transmissionHypotheses: [],
  marketReaction: [],
  supportingEvidence: [],
  counterEvidence: [],
  scenarios: [],
  directions: [],
  nextCatalysts: [],
  dataCaveats: [],
  evidenceRefs: ['ev-1', 'ev-2'],
  createdAt: asOf,
  ...overrides
})

const accepted: NotificationSubmitOutcome = { kind: 'accepted', recordId: 'n-1', levels: ['center', 'channel'], suppressedLevels: [] }

function harness(options: Readonly<{ run?: AnalysisRun; summary?: AnalysisSummary; outcome?: NotificationSubmitOutcome }> = {}) {
  const outcome = options.outcome ?? accepted
  const submit = vi.fn(async (_request: NotificationSubmitRequest) => outcome)
  const send = createAnalysisConclusionManualSend({
    repository: {
      getRun: () => ('run' in options ? options.run : run()),
      getSummaryForRun: () => ('summary' in options ? options.summary : summary()),
      getSnapshot: () => ({ asOf })
    },
    submit,
    now: () => clickAt
  })
  return { send, submit }
}

describe('sending one conclusion to the channel', () => {
  it('submits the same event the automatic push uses, without narrowing', async () => {
    const { send, submit } = harness()
    await expect(send({ analysisRunId: 'mi-ar-1' })).resolves.toEqual({ kind: 'accepted', recordId: 'n-1', levels: ['center', 'channel'] })
    expect(submit).toHaveBeenCalledTimes(1)
    const request = submit.mock.calls[0]![0] as Record<string, unknown>
    expect(request.eventTypeId).toBe('market-intelligence.analysis.conclusion')
    // 读者点名要发：不收窄，手机那一档照排。
    expect(request.narrowedDisruptionLevels).toBeUndefined()
    // 正文与自动推送同一条规则：一句结论 + 证据条数（推手机才带）。
    expect((request.rendered as Record<string, { body: string }>)['zh-CN']!.body).toBe('多头被清，价格跌到位后买盘回来了。 · 证据 2 条')
  })

  it('makes a new dedupe key from the click time, so the real key is never occupied', async () => {
    const { send, submit } = harness()
    await send({ analysisRunId: 'mi-ar-1' })
    // 模板拼出来就是 analysis:{桶}:{截止}:{点击}——第二个分量带点击时刻，所以每次点击都是新键。
    expect(submit.mock.calls[0]![0].dedupeVars).toEqual({
      builder: 'template',
      vars: { bucket: 'manual:mi-eg-1', cutoff: `${asOf}:${clickAt}` }
    })
  })

  it('hands a rejection back by its platform reason — the daily cap is not a generic failure', async () => {
    const { send } = harness({
      outcome: { kind: 'rejected', reason: 'daily-limit-reached', message: 'limit' } as unknown as NotificationSubmitOutcome
    })
    await expect(send({ analysisRunId: 'mi-ar-1' })).resolves.toEqual({ kind: 'rejected', reason: 'daily-limit-reached' })
  })

  it('says which thing is missing instead of submitting half a notice', async () => {
    const noRun = harness({ run: undefined })
    await expect(noRun.send({ analysisRunId: 'mi-ar-404' })).resolves.toEqual({ kind: 'rejected', reason: 'run-missing' })
    expect(noRun.submit).not.toHaveBeenCalled()

    const noConclusion = harness({ summary: summary({ conclusion: undefined }) })
    await expect(noConclusion.send({ analysisRunId: 'mi-ar-1' })).resolves.toEqual({ kind: 'rejected', reason: 'conclusion-missing' })
    expect(noConclusion.submit).not.toHaveBeenCalled()
  })

  it('never claims a send when the submit entry is not wired', async () => {
    const send = createAnalysisConclusionManualSend({ repository: { getRun: () => run(), getSummaryForRun: () => summary() }, now: () => clickAt })
    await expect(send({ analysisRunId: 'mi-ar-1' })).resolves.toEqual({ kind: 'rejected', reason: 'submit-unavailable' })
  })
})
