import { describe, expect, it } from 'vitest'

import { createDailyBriefingSqliteStore } from './dailyBriefingStore'
import { createDailyBriefingReads } from './dailyBriefingReads'
import type { BriefingGenerationTrace } from '../../../contracts/dailyBriefing'

const trace = {
  attemptId: 'a1', startedAt: '2026-11-06T10:11:23.763Z', finishedAt: '2026-11-06T10:13:23.899Z',
  state: 'failed' as const,
  stages: [{ id: 'writing', state: 'failed' as const, startedAt: '2026-11-06T10:12:00.000Z', finishedAt: '2026-11-06T10:13:20.000Z', durationMs: 80_000 }]
} as unknown as BriefingGenerationTrace

describe('reading an edition that failed', () => {
  // 用户 2026-11-06：点开失败的项应该能看到对应的 step 和失败原因。没有版次时，读版次这一步
  // 以前只回 `missing`，把码与步骤都丢了。
  it('answers with the failure code and that attempt’s own trace when nothing was published', async () => {
    const store = createDailyBriefingSqliteStore(':memory:')
    const date = '2026-11-06'
    const attemptNo = await store.beginAttempt!({ date, periodId: 'period_a', locale: 'en-US', startedAt: trace.startedAt })
    await store.finishAttempt!({
      date, periodId: 'period_a', locale: 'en-US', attemptNo, state: 'failed',
      failureCode: 'editorial-timeout', finishedAt: '2026-11-06T10:13:23.899Z', trace
    })
    const reads = createDailyBriefingReads({ store })

    const result = await reads.get({ date, locale: 'en-US', periodId: 'period_a' })
    expect(result.state).toBe('unavailable')
    if (result.state !== 'unavailable') return
    expect(result.failureCode).toBe('editorial-timeout')
    expect(result.generationTrace?.stages.map((stage) => stage.id)).toEqual(['writing'])
    // 另一期同一天：没有尝试记录，就是"没有内容"，不是"失败"。
    expect((await reads.get({ date, locale: 'en-US', periodId: 'period_b' })).state).toBe('missing')
    // 也只按它自己的语言算：中文那一版从没跑过。
    expect((await reads.get({ date, locale: 'zh-CN', periodId: 'period_a' })).state).toBe('missing')
  })
})
