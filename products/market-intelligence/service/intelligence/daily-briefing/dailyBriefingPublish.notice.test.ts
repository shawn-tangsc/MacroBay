import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { BriefingGenerationTrace, DailyBriefingDocument } from '../../../contracts/dailyBriefing'

/**
 * 自动发布时**把导读交给通知层**。
 *
 * 以前这条路径根本没传 `lede`：手机上只剩「这一期已生成」，正文的导读读者看不到；而手动「推送到
 * 手机」那条一直带着。用例只测了通知层能不能拼，没测发布时传没传——所以一直绿。
 *
 * 这里把通知层替换成探针，断言的是**发布这一侧交出去的东西**，不是通知层怎么拼句子。
 */
const notifyDailyBriefing = vi.fn(async () => null)
vi.mock('./dailyBriefingNotifier', () => ({
  notifyDailyBriefing,
  briefingTimeLabel: () => '07:00',
  // 失败通知的拼句函数也要有：否则测失败路径时会以「函数不存在」失败，而不是测到我们要测的那一次提交。
  briefingFailedNotice: (input: unknown) => ({ kind: 'failed', ...(input as object) })
}))

const { abandonDailyBriefingEditorial, publishDailyBriefingEdition } = await import('./dailyBriefingPublish')

const document = (lede: string): DailyBriefingDocument => ({
  schemaVersion: 1,
  policyVersion: 'daily-briefing.v1',
  edition: {
    date: '2026-11-07', locale: 'zh-CN', generatedAt: '2026-11-07T00:30:00.000Z',
    windowStart: '2026-11-07T00:00:00.000Z', windowEnd: '2026-11-07T00:30:00.000Z', timeZone: 'Asia/Shanghai'
  },
  status: {
    readings: [
      { id: 'fear-greed', state: 'available' }, { id: 'funding', state: 'available' },
      { id: 'capital', state: 'available' }, { id: 'calendar', state: 'available' }
    ],
    readingsAvailable: 4, readingsTotal: 4
  },
  lede: { source: 'template', text: lede, generatedAt: '2026-11-07T00:30:00.000Z' },
  news: { items: [], macro: [], notes: {} },
  data: { market: [], funds: [], sentiment: { fearGreed: null, news: { state: 'empty' } } },
  conclusion: null,
  next: { items: [] },
  citations: [],
  provenance: { summaryId: null, readAt: '2026-11-07T00:30:00.000Z' }
})

const trace = (): BriefingGenerationTrace => ({
  attemptId: 'a-1', state: 'success', stages: [],
  startedAt: '2026-11-07T00:00:00.000Z', finishedAt: '2026-11-07T00:30:00.000Z'
} as never)

describe('the automatic publish notice', () => {
  beforeEach(() => { notifyDailyBriefing.mockClear() })

  it('hands the digest to the notice layer, so the phone can show what the edition says', async () => {
    const lede = '10月非农新增16.5万个岗位，资金面却相反。'
    await publishDailyBriefingEdition({
      document: document(lede),
      store: { put: async () => undefined, prune: async () => undefined },
      attempts: { build: () => ({ id: 'a-1' }), settle: async () => undefined },
      run: { settle: async () => undefined },
      recorder: { begin: () => undefined, end: () => undefined, complete: () => trace() },
      now: () => '2026-11-07T00:30:00.000Z',
      noticeSubmit: (async () => ({ kind: 'created', recordId: 'r-1' })) as never,
      date: '2026-11-07',
      periodId: 'default',
      locale: 'zh-CN',
      deliver: true
    } as never)

    const calls = notifyDailyBriefing.mock.calls as unknown as { 1: unknown }[];
    const notice = calls.at(-1)?.[1] as { kind: string; lede?: string }
    expect(notice.kind).toBe('ready')
    // 正是这条以前缺的字段。
    expect(notice.lede).toBe(lede)
  })

  it('submits exactly one ready notice on a successful publish', async () => {
    // 2026-11-07：成功那期一条通知都没发出去。这条钉的是"发布这一侧确实交了一次"。
    await publishDailyBriefingEdition({
      document: document('一到两句话的导读。'),
      store: { put: async () => undefined, prune: async () => undefined },
      attempts: { build: () => ({ id: 'a-1' }), settle: async () => undefined },
      run: { settle: async () => undefined },
      recorder: { begin: () => undefined, end: () => undefined, complete: () => trace() },
      now: () => '2026-11-07T00:30:00.000Z',
      noticeSubmit: (async () => ({ kind: 'created', recordId: 'r-1' })) as never,
      date: '2026-11-07', periodId: 'default', locale: 'zh-CN', deliver: true
    } as never)

    const notices = (notifyDailyBriefing.mock.calls as unknown as { 1: { kind: string } }[]).map((call) => call[1])
    expect(notices.filter((notice) => notice.kind === 'ready')).toHaveLength(1)
    expect(notices.filter((notice) => notice.kind === 'failed')).toHaveLength(0)
  })

  it('submits exactly one failed notice when the editorial never landed', async () => {
    // 失败那期也必须有且只有一条，且带上"哪一期"的身份，否则读者只看到一句没有对象的失败。
    await abandonDailyBriefingEditorial({
      failureCode: 'run-interrupted',
      attempts: { settle: async () => undefined },
      run: { settle: async () => undefined },
      recorder: { complete: () => ({ ...trace(), state: 'failed' }) },
      now: () => '2026-11-07T12:01:39.436Z',
      noticeSubmit: (async () => ({ kind: 'created', recordId: 'r-2' })) as never,
      date: '2026-11-07', periodId: 'period_en', locale: 'en-US',
      asOf: '2026-11-07T12:00:00.000Z', timeZone: 'Asia/Shanghai'
    } as never)

    const notices = (notifyDailyBriefing.mock.calls as unknown as { 1: { kind: string; date?: string; periodId?: string } }[]).map((call) => call[1])
    const failed = notices.filter((notice) => notice.kind === 'failed')
    expect(failed).toHaveLength(1)
    expect(failed[0]).toMatchObject({ date: '2026-11-07', periodId: 'period_en' })
    expect(notices.filter((notice) => notice.kind === 'ready')).toHaveLength(0)
  })
})
