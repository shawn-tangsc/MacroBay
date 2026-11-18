import { describe, expect, it } from 'vitest'

import { createDailyBriefingSqliteStore } from './dailyBriefingStore'
import { createDailyBriefingReads } from './dailyBriefingReads'
import type { BriefingGenerationTrace, DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import type { DailyBriefingStore } from './dailyBriefingService'

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

describe('reading a stored edition after the display-value defect (2026-11-18)', () => {
  it('restores the frozen serialized value on the read path without rewriting the store', async () => {
    // 库里 11-18 00:08:03 那版的 `previous` 冻结成 `{"displayValue":"4.7%"}`：读口还原成 `4.7%`，
    // 界面/导出/推送三条读路径同时生效；库里那份不动（这里仍断言原始文档没被改）。
    const frozen = {
      schemaVersion: 1,
      news: {
        items: [],
        macro: [{ eventKey: 'evt-1', title: '至9月三个月ILO失业率', actual: '4.6%', previous: '{"displayValue":"4.7%"}', consensus: '4.7%' }],
        notes: {}
      }
    } as unknown as DailyBriefingDocument
    const store = {
      get: async () => ({ date: '2026-11-18', periodId: 'default', locale: 'zh-CN', generatedAt: '2026-11-18T00:08:03.644Z', windowStart: '2026-11-17T00:08:03.000Z', windowEnd: '2026-11-18T00:08:03.000Z', document: frozen })
    } as unknown as DailyBriefingStore
    const read = await createDailyBriefingReads({ store }).get({ date: '2026-11-18', locale: 'zh-CN', periodId: 'default' })
    expect(read.state).toBe('available')
    if (read.state !== 'available') return
    expect(read.document.news.macro[0]?.previous).toBe('4.7%')
    expect(read.document.news.macro[0]?.actual).toBe('4.6%')
    // 「库里的那份不动」不是注释：原始对象仍是坏串。
    expect((frozen.news.macro[0] as unknown as { previous: string }).previous).toBe('{"displayValue":"4.7%"}')
  })
})
