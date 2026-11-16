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
  triggerCandidates: readonly Readonly<{ itemId: string; scoredAt: string }>[]
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
 * 事故链路的那一环：判定写在评分这一步（比采集事件晚几秒），所以触发必须由评分这一步补。
 * 没有这一环，新闻就再也触发不了分析——不是「不重要」，是没人叫醒它。
 */
describe('新闻判定落地后补一次分析触发', () => {
  it('把够格的判定交回分析触发这条路，身份带上判定时刻避免重复排队', async () => {
    const { handlers, enqueueDefinition } = harness(async () => ({
      processed: 1, model: 0, rules: 1, skipped: 0, failed: 0, modelCalls: 0,
      triggerCandidates: [{ itemId: 'item-x', scoredAt: '2026-11-16T09:07:50.718Z' }]
    }))
    await handlers.get(INTELLIGENCE_SCORE_NEWS_SENTIMENT_JOB)!({ itemIds: ['item-x'] }, context as never)

    expect(enqueueDefinition).toHaveBeenCalledWith(expect.objectContaining({
      id: 'market-analysis:news-sentiment:item-x:2026-11-16T09:07:50.718Z',
      handlerId: GROUP_MARKET_ANALYSIS_CHANGE_JOB,
      payload: { changeId: 'item-x', eventRef: 'item-x' }
    }))
  })

  it('没有够格的判定就不排任何分析', async () => {
    const { handlers, enqueueDefinition } = harness(async () => ({
      processed: 1, model: 0, rules: 1, skipped: 0, failed: 0, modelCalls: 0, triggerCandidates: []
    }))
    await handlers.get(INTELLIGENCE_SCORE_NEWS_SENTIMENT_JOB)!({ itemIds: ['item-x'] }, context as never)

    expect(enqueueDefinition).not.toHaveBeenCalled()
  })

  it('重建是重算历史，不是新事件：不补触发', async () => {
    const { handlers, enqueueDefinition } = harness(async () => ({
      processed: 1, model: 0, rules: 1, skipped: 0, failed: 0, modelCalls: 0,
      triggerCandidates: [{ itemId: 'item-x', scoredAt: '2026-11-16T09:07:50.718Z' }]
    }))
    await handlers.get(INTELLIGENCE_SCORE_NEWS_SENTIMENT_JOB)!({ rebuild: true }, context as never)

    expect(enqueueDefinition).not.toHaveBeenCalled()
  })
})
