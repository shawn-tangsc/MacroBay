import { describe, expect, it, vi } from 'vitest'

import type { JobHandler, JobRuntime } from '@platform/jobs'

import { registerIntelligenceJobs } from './registerIntelligenceJobs'
import { GROUP_MARKET_ANALYSIS_CHANGE_JOB } from './marketAnalysisJobIds'
import { INTELLIGENCE_SCORE_NEWS_SENTIMENT_JOB } from './intelligenceJobIds'

type Scored = Readonly<{
  processed: number
  model: number
  rules: number
  skipped: number
  failed: number
  modelCalls: number
  /** 旧版本还会返回它；新版本不产出，这里故意留着，验证「即使有也不排分析」。 */
  triggerCandidates?: readonly Readonly<{ itemId: string; scoredAt: string }>[]
}>

function harness(scoreItems: (input: unknown) => Promise<Scored>) {
  const handlers = new Map<string, JobHandler>()
  const enqueueDefinition = vi.fn(async (definition: { id: string }) => ({ id: definition.id }))
  const jobRuntime = {
    registerHandler: (id: string, handler: JobHandler) => { handlers.set(id, handler) },
    enqueueDefinition
  } as unknown as JobRuntime
  registerIntelligenceJobs(jobRuntime, {
    pipeline: {} as never,
    newsSentiment: { enrichItems: (async () => ({})) as never, scoreItems: scoreItems as never }
  })
  return { handlers, enqueueDefinition }
}

const context = { jobRunId: 'news-trigger', signal: new AbortController().signal, log: async () => undefined, progress: async () => undefined }

/**
 * R39：新闻解读只有读者手动触发。评分这一步过去会把「有标的、非中性、强度 ≥2」的判定
 * 交回分析触发路径，结果排了一次读不到那条新闻的市场分析。现在这一环整个移除；
 * 旧形状的返回值（还带 `triggerCandidates`）也不许再排。
 */
describe('新闻判定落地后不再补分析触发（R39）', () => {
  it('does not enqueue an analysis even if the score result still carries trigger candidates', async () => {
    const { handlers, enqueueDefinition } = harness(async () => ({
      processed: 1, model: 0, rules: 1, skipped: 0, failed: 0, modelCalls: 0,
      triggerCandidates: [{ itemId: 'item-x', scoredAt: '2026-11-16T09:07:50.718Z' }]
    }))
    await handlers.get(INTELLIGENCE_SCORE_NEWS_SENTIMENT_JOB)!({ itemIds: ['item-x'] }, context as never)

    expect(enqueueDefinition).not.toHaveBeenCalled()
    expect(enqueueDefinition).not.toHaveBeenCalledWith(expect.objectContaining({ handlerId: GROUP_MARKET_ANALYSIS_CHANGE_JOB }))
  })

  it('does not enqueue one for a rebuild either', async () => {
    const { handlers, enqueueDefinition } = harness(async () => ({
      processed: 1, model: 0, rules: 1, skipped: 0, failed: 0, modelCalls: 0,
      triggerCandidates: [{ itemId: 'item-x', scoredAt: '2026-11-16T09:07:50.718Z' }]
    }))
    await handlers.get(INTELLIGENCE_SCORE_NEWS_SENTIMENT_JOB)!({ rebuild: true }, context as never)

    expect(enqueueDefinition).not.toHaveBeenCalled()
  })
})
