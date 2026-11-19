import { describe, expect, it, vi } from 'vitest'

import {
  briefingCalendarCatchUpSourceIds,
  BRIEFING_CALENDAR_CATCH_UP_TIMEOUT_MS,
  ensureCalendarFreshForRun,
  isFreshAt
} from './dailyBriefingCalendarCatchUp'
import { marketCalendarPublicPolicy } from '../../../contracts/macro/marketCalendarQueryContracts'
import { calendarFeedRegistry } from '../macro-calendar/calendarFeedRegistry'
import { getMacroCalendarEvidenceSourceDescriptor } from '../macro-calendar/macroCalendarOfficialSourceRegistry'

const dataAsOf = '2026-11-05T07:00:00.000Z'
const twoHoursAgo = '2026-11-05T05:00:00.000Z'
/** The real shape of the 2026-11-05 edition: last success 42 hours before the cutoff. */
const staleAt = '2026-11-03T13:27:00.000Z'

function freshness(
  lastCollectedAt: string | null,
  attempt?: { attemptedAt: string; state: 'succeeded' | 'failed' },
  writeFailure?: { at: string; code: 'standard-write-failed' | 'value-shape-rejected'; lastSuccessAt?: string }
) {
  return {
    state: 'available' as const,
    asOf: dataAsOf,
    lastCollectedAt,
    ...(writeFailure ? { writeFailure } : {}),
    sources: (['macro-calendar-narwhal-economic-data', 'macro-calendar-narwhal-financial-events', 'macro-calendar-narwhal-central-bank-activities'] as const)
      .map((descriptorId) => ({ descriptorId, lastCollectedAt, ...(attempt ? { latestAttempt: attempt } : {}) }))
  }
}

const zeroXRouterJobId = (key: string): string => `market-intelligence.refreshMarketCalendar.automatic.${key}`
/** 当前在采的三条作业（0xRouter 每路一条）。Narwhal 那两条已下线，测试不再写它们的 id。 */
const liveCalendarJobIds = [
  zeroXRouterJobId('economic-data'),
  zeroXRouterJobId('financial-events'),
  zeroXRouterJobId('central-bank-activities')
] as const
const liveFeedIds = [
  'macro-calendar-0xrouter-economic-data',
  'macro-calendar-0xrouter-financial-events',
  'macro-calendar-0xrouter-central-bank-activities'
] as const
const registered = (...ids: readonly string[]): ReadonlySet<string> => new Set(ids)

describe('the catch-up list is the runtime schedule projection', () => {
  // 「此刻在采」只认 `listSchedules()`：登记表的 collection/optIn 是「登记了什么、默认要不要开」。
  it('lists exactly the market feeds whose job is registered', () => {
    expect(briefingCalendarCatchUpSourceIds(registered(...liveCalendarJobIds))).toEqual([...liveFeedIds])
    expect(briefingCalendarCatchUpSourceIds(registered())).toEqual([])
  })

  it('adds a reader-enabled feed the moment its job is registered, without touching the call site', () => {
    const ids = briefingCalendarCatchUpSourceIds(registered(zeroXRouterJobId('economic-data')))
    expect(ids).toEqual(['macro-calendar-0xrouter-economic-data'])
    // 停用（作业撤掉）= 从清单消失，同一个函数、同一个输入形状。
    const disabled = briefingCalendarCatchUpSourceIds(registered())
    expect(disabled).not.toContain('macro-calendar-0xrouter-economic-data')
  })

  // 被覆盖的那两条由同一次采集写三类，不该单独补：即使有人给它们挂了一个假作业，也不进清单。
  it('leaves the feeds covered by another feed out of the list, even with a registered job', () => {
    const covered = Object.values(calendarFeedRegistry).filter(feed => feed.coveredBy !== undefined)
    expect(covered.length).toBeGreaterThan(0)
    const fakeJobs = covered.flatMap(feed => [`market-intelligence.collect:${feed.feedId}`, zeroXRouterJobId(feed.feedId)])
    for (const feed of covered) {
      expect(briefingCalendarCatchUpSourceIds(registered(...liveCalendarJobIds, ...fakeJobs))).not.toContain(feed.feedId)
    }
  })

  // 官方日程有自己的排期，日报不替它补。
  it('never lists official-schedule feeds', () => {
    const officialJobs = ['market-intelligence.syncBlsScheduleAndValues.automatic', 'market-intelligence.collect:macro-calendar-fed']
    const ids = briefingCalendarCatchUpSourceIds(registered(...liveCalendarJobIds, ...officialJobs))
    expect(ids).toEqual([...liveFeedIds])
  })
})

// 等多久与读者被告知的那句话必须同一个数（用户 2026-11-14 定 20 秒）。这条钉的是决定本身：
// 谁把它改回契约默认的 90 秒，日报就会为一次排不上的采集多等一分半，而超时那句已经不写秒数了，
// 没有人会从界面上发现。红在这里，而不是靠人记得。
describe('the catch-up budget', () => {
  it('is 20 seconds — the same cap the queue trigger uses', () => {
    expect(BRIEFING_CALENDAR_CATCH_UP_TIMEOUT_MS).toBe(20_000)
  })
})

describe('ensureCalendarFreshForRun', () => {
  it('skips the catch-up when the last success is inside the two-hour window', async () => {
    const refreshNow = vi.fn()
    const reading = await ensureCalendarFreshForRun({
      dataAsOf, enabled: true, refreshNow,
      readFreshness: async () => freshness(twoHoursAgo)
    })

    expect(reading).toMatchObject({ state: 'available', lastCollectedAt: twoHoursAgo, catchUp: { state: 'skipped' } })
    expect(refreshNow).not.toHaveBeenCalled()
  })

  // `#32`（用户 2026-11-19）：写库失败时**不再发补采**——采集会成功、写入仍会失败，白花一次请求。
  // 判据断的是 `refreshNow` 的调用次数（0），不是返回值；跳过必须留痕，且带失败码。
  it('skips the catch-up when the write itself failed, and logs the code', async () => {
    const refreshNow = vi.fn()
    const logged: string[] = []
    const original = console.log
    console.log = (line: string) => { logged.push(String(line)) }
    try {
      const reading = await ensureCalendarFreshForRun({
        dataAsOf, enabled: true, refreshNow, registeredScheduleIds: () => [...liveCalendarJobIds],
        readFreshness: async () => freshness(staleAt, undefined, {
          at: '2026-11-05T06:45:00.000Z', code: 'standard-write-failed', lastSuccessAt: '2026-11-05T06:00:00.000Z'
        })
      })

      expect(reading.catchUp).toEqual({ state: 'skipped', reasonCode: 'write-failed' })
      expect(refreshNow).toHaveBeenCalledTimes(0)
      expect(logged).toHaveLength(1)
      expect(logged[0]).toContain('[macro-calendar.catch-up]')
      expect(logged[0]).toContain('"reasonCode":"write-failed"')
      expect(logged[0]).toContain('"firstErrorCode":"standard-write-failed"')
      expect(logged[0]).not.toContain('http')
    } finally {
      console.log = original
    }
  })

  // 三重 fail-safe 里最容易写错的一条：失败早于最后一次成功写入 = 数据后来写进去了，照常补。
  it('still catches up when the write failure predates the last success', async () => {
    const refreshNow = vi.fn(async () => ({ state: 'collected' as const, sources: [marketCalendarPublicPolicy.collectionFeeds[0]!] }))
    const reads = [
      freshness(staleAt, undefined, { at: '2026-11-02T00:00:00.000Z', code: 'standard-write-failed', lastSuccessAt: '2026-11-03T00:00:00.000Z' }),
      freshness(dataAsOf)
    ]
    let call = 0
    const reading = await ensureCalendarFreshForRun({
      dataAsOf, enabled: true, refreshNow, registeredScheduleIds: () => [...liveCalendarJobIds],
      readFreshness: async () => reads[call++]!
    })

    expect(refreshNow).toHaveBeenCalledTimes(1)
    expect(reading.catchUp).toEqual({ state: 'collected' })
  })

  // 第四重 fail-safe（用户 2026-11-19 定）：`lastSuccessAt` 缺席 = 从没成功过，这次失败就是当前的，
  // 方向只能是「显示」。夹具造的是「采集成功过、写入从没成功」那一格，不是「从没采集过」。
  it('treats a write failure with no recorded success as current and skips the catch-up', async () => {
    const refreshNow = vi.fn()
    const reading = await ensureCalendarFreshForRun({
      dataAsOf, enabled: true, refreshNow, registeredScheduleIds: () => [...liveCalendarJobIds],
      readFreshness: async () => freshness(staleAt, undefined, { at: '2026-11-05T06:45:00.000Z', code: 'standard-write-failed' })
    })
    expect(reading.catchUp).toEqual({ state: 'skipped', reasonCode: 'write-failed' })
    expect(refreshNow).toHaveBeenCalledTimes(0)
  })

  // 老数据没有这个键：行为必须与改动前完全一致（字段缺失不挡补采）。
  it('still catches up when the reading carries no write failure at all', async () => {
    const refreshNow = vi.fn(async () => ({ state: 'collected' as const, sources: [marketCalendarPublicPolicy.collectionFeeds[0]!] }))
    const reads = [freshness(staleAt), freshness(dataAsOf)]
    let call = 0
    await ensureCalendarFreshForRun({
      dataAsOf, enabled: true, refreshNow, registeredScheduleIds: () => [...liveCalendarJobIds],
      readFreshness: async () => reads[call++]!
    })
    expect(refreshNow).toHaveBeenCalledTimes(1)
  })

  // 整份作废（多键 / 码越界 / 时间不合法）走的是既有的「读不到」：既不补，也不说成写库失败。
  it('reads a malformed freshness answer as unavailable, never as a write failure', async () => {
    const refreshNow = vi.fn()
    const reading = await ensureCalendarFreshForRun({
      dataAsOf, enabled: true, refreshNow, registeredScheduleIds: () => [...liveCalendarJobIds],
      readFreshness: async () => ({
        ...freshness(staleAt),
        writeFailure: { at: '2026-11-05T06:45:00.000Z', code: 'standard-write-failed', extra: 1 }
      })
    })

    expect(reading).toEqual({ state: 'unavailable' })
    expect(refreshNow).not.toHaveBeenCalled()
  })

  it('catches up once for a stale calendar and decides from the reading taken afterwards', async () => {
    const refreshNow = vi.fn(async () => ({ state: 'collected' as const, sources: [marketCalendarPublicPolicy.collectionFeeds[0]!] }))
    const reads = [freshness(staleAt), freshness(dataAsOf)]
    let call = 0
    const reading = await ensureCalendarFreshForRun({
      dataAsOf, enabled: true, refreshNow, registeredScheduleIds: () => [...liveCalendarJobIds],
      readFreshness: async () => reads[call++]!
    })

    // Only the post-catch-up reading decides: the edition must not report 42 hours of staleness it
    // has just replaced, and must not report freshness it had not seen.
    expect(reading).toMatchObject({ state: 'available', lastCollectedAt: dataAsOf, catchUp: { state: 'collected' } })
    expect(refreshNow).toHaveBeenCalledTimes(1)
    expect(refreshNow).toHaveBeenCalledWith({ sourceIds: expect.any(Array), timeoutMs: BRIEFING_CALENDAR_CATCH_UP_TIMEOUT_MS })
    expect(call).toBe(2)
  })

  it('keeps the stale reading when the catch-up runs out of time, and reports a timeout', async () => {
    const reading = await ensureCalendarFreshForRun({
      dataAsOf, enabled: true, registeredScheduleIds: () => [...liveCalendarJobIds],
      refreshNow: async () => ({ state: 'timeout' as const, timeoutMs: 90_000 }),
      readFreshness: async () => freshness(staleAt)
    })

    // A timeout is its own verdict, not a failure, and the reading stays stale rather than fresh.
    expect(reading).toEqual({ state: 'available', lastCollectedAt: staleAt, catchUp: { state: 'timeout', timeoutMs: 90_000 } })
  })

  it('records a failed catch-up as failed, never as timeout', async () => {
    const reading = await ensureCalendarFreshForRun({
      dataAsOf, enabled: true, registeredScheduleIds: () => [...liveCalendarJobIds],
      refreshNow: async () => ({ state: 'failed' as const, failureCode: 'credential-not-configured' }),
      readFreshness: async () => freshness(staleAt)
    })

    expect(reading.catchUp).toEqual({ state: 'failed', failureCode: 'credential-not-configured' })
  })

  it('treats a throwing command as a failure, and keeps going', async () => {
    const reading = await ensureCalendarFreshForRun({
      dataAsOf, enabled: true, registeredScheduleIds: () => [...liveCalendarJobIds],
      refreshNow: async () => { throw new Error('queue closed') },
      readFreshness: async () => freshness(staleAt)
    })

    expect(reading.catchUp).toEqual({ state: 'failed', failureCode: 'queue closed' })
  })

  // 2026-11-14 的真实形状：补跑改成「排一个作业」后就返回了 `{state:'completed'}`——契约里没有这一种。
  // 它**不是**采集失败（没有任何东西失败），读的人也不该被告知「源坏了」。落 `unknown`，
  // 那句话交给补跑之后的新鲜度决定。
  it('records a verdict the contract does not name as unknown, never as a failed collection', async () => {
    const reading = await ensureCalendarFreshForRun({
      dataAsOf, enabled: true, registeredScheduleIds: () => [...liveCalendarJobIds],
      refreshNow: async () => ({ state: 'completed', sources: [] }),
      readFreshness: async () => freshness(staleAt)
    })

    expect(reading.catchUp).toEqual({ state: 'unknown', failureCode: 'catch-up-verdict-invalid' })
    // 未知不等于变新：读数还是补跑前那份。
    expect(reading).toMatchObject({ state: 'available', lastCollectedAt: staleAt })
  })

  // 只校验 `state` 那个词不够：`{state:'collected'}` 少了 `sources` 是「看着像、其实不是」。
  // 以前这种半截形状会被当成真结果记下来（于是补跑后判「采到了」），现在落 unknown。
  it('rejects a half-valid verdict: the contract validates the shape, not just the state word', async () => {
    const reading = await ensureCalendarFreshForRun({
      dataAsOf, enabled: true, registeredScheduleIds: () => [...liveCalendarJobIds],
      refreshNow: async () => ({ state: 'collected' }),
      readFreshness: async () => freshness(staleAt)
    })

    expect(reading.catchUp).toEqual({ state: 'unknown', failureCode: 'catch-up-verdict-invalid' })
  })

  it('commands only the feeds whose jobs are registered, and names them exactly', async () => {
    const refreshNow = vi.fn(async () => ({ state: 'collected' as const, sources: [marketCalendarPublicPolicy.collectionFeeds[0]!] }))
    const reads = [freshness(staleAt), freshness(dataAsOf)]
    let call = 0
    await ensureCalendarFreshForRun({
      dataAsOf, enabled: true, refreshNow,
      registeredScheduleIds: () => [...liveCalendarJobIds],
      readFreshness: async () => reads[call++]!
    })

    expect(refreshNow).toHaveBeenCalledWith({
      sourceIds: [...liveFeedIds],
      timeoutMs: BRIEFING_CALENDAR_CATCH_UP_TIMEOUT_MS
    })
  })

  it('sends no command to a feed whose job is not registered', async () => {
    const refreshNow = vi.fn(async (_input: { sourceIds: readonly string[]; timeoutMs: number }) =>
      ({ state: 'collected' as const, sources: [marketCalendarPublicPolicy.collectionFeeds[0]!] }))
    const reads = [freshness(staleAt), freshness(dataAsOf)]
    let call = 0
    await ensureCalendarFreshForRun({
      dataAsOf, enabled: true, refreshNow,
      registeredScheduleIds: () => [...liveCalendarJobIds],
      readFreshness: async () => reads[call++]!
    })

    const passed = refreshNow.mock.calls[0]![0].sourceIds
    // 名单只含此刻注册的作业对应的 feed；已下线的 Narwhal 一路绝不能被点名（否则只会 input-invalid）。
    expect(passed).toEqual([...liveFeedIds])
    for (const id of passed) expect(id).not.toContain('narwhal')
  })

  // 用户 2026-11-16（Chief 定）：同一统计期内**最多补一次**。上限是「要不要发请求」的策略，
  // 不是采集结果；跳过不写失败态、也不产生「补采没成功」那句话。
  it('attempts at most one catch-up in the same period', async () => {
    const attempted = new Set<string>()
    const budget = { alreadyAttempted: () => attempted.has('period-1'), markAttempted: () => attempted.add('period-1') }
    const refreshNow = vi.fn(async () => ({ state: 'collected' as const, sources: [marketCalendarPublicPolicy.collectionFeeds[0]!] }))

    const first = await ensureCalendarFreshForRun({
      dataAsOf, enabled: true, refreshNow, registeredScheduleIds: () => [...liveCalendarJobIds],
      catchUpBudget: budget, readFreshness: async () => freshness(staleAt)
    })
    const second = await ensureCalendarFreshForRun({
      dataAsOf, enabled: true, refreshNow, registeredScheduleIds: () => [...liveCalendarJobIds],
      catchUpBudget: budget, readFreshness: async () => freshness(staleAt)
    })

    expect(refreshNow).toHaveBeenCalledTimes(1)
    expect(first.catchUp?.state).not.toBe('skipped')
    expect(second.catchUp).toMatchObject({ state: 'skipped', reasonCode: 'already-caught-up-this-period' })
    // 跳过不是失败：没有 failureCode，也不会被写成「补采没成功」。
    expect(second.catchUp !== undefined && 'failureCode' in second.catchUp).toBe(false)
  })

  it('attempts nothing at all when no collection job is scheduled', async () => {
    const refreshNow = vi.fn()
    const reading = await ensureCalendarFreshForRun({
      dataAsOf, enabled: true, refreshNow,
      registeredScheduleIds: () => [],
      readFreshness: async () => freshness(staleAt)
    })

    // 不是失败、也不是「排上了」：没有任何作业可补。读数保持过期，原因码照旧说「过期」。
    expect(reading).toMatchObject({ state: 'available', lastCollectedAt: staleAt, catchUp: { state: 'no-registered-jobs' } })
    expect(refreshNow).not.toHaveBeenCalled()
  })

  it('answers "not wired" — not "nothing" — when no freshness reader was injected', async () => {
    const reading = await ensureCalendarFreshForRun({ dataAsOf, enabled: true })

    expect(reading.state).toBe('not-wired')
    expect(reading.catchUp).toBeUndefined()
  })

  it('answers "unavailable" when the bound reader fails, keeping it distinct from not wired', async () => {
    const reading = await ensureCalendarFreshForRun({
      dataAsOf, enabled: true,
      readFreshness: async () => ({ state: 'unavailable', failureCode: 'query-unavailable' })
    })

    expect(reading.state).toBe('unavailable')
  })

  it('does nothing at all while the reader has the calendar switched off', async () => {
    const refreshNow = vi.fn()
    const readFreshness = vi.fn()
    const reading = await ensureCalendarFreshForRun({ dataAsOf, enabled: false, refreshNow, readFreshness })

    expect(reading.state).toBe('source-disabled')
    expect(readFreshness).not.toHaveBeenCalled()
    expect(refreshNow).not.toHaveBeenCalled()
  })

  it('reports the latest attempt across the feeds, so "the last try failed" is about the try', async () => {
    const reading = await ensureCalendarFreshForRun({
      dataAsOf, enabled: true,
      readFreshness: async () => freshness(staleAt, { attemptedAt: '2026-11-05T06:40:00.000Z', state: 'failed' })
    })

    expect(reading).toMatchObject({ lastAttemptAt: '2026-11-05T06:40:00.000Z', lastAttemptFailed: true })
  })
})

describe('isFreshAt', () => {
  it('accepts exactly two hours and rejects a minute more', () => {
    expect(isFreshAt(twoHoursAgo, dataAsOf)).toBe(true)
    expect(isFreshAt('2026-11-05T04:59:00.000Z', dataAsOf)).toBe(false)
  })

  it('treats "never collected" as not fresh', () => {
    expect(isFreshAt(null, dataAsOf)).toBe(false)
    expect(isFreshAt(undefined, dataAsOf)).toBe(false)
  })
})

/**
 * 补跑清单不许是「另一份手抄的 id 表」。
 *
 * `refreshNow` 只认 `marketCalendarPublicPolicy.descriptors`，别的 id 一律 `input-invalid`；
 * 所以清单与那份契约必须逐条相同，且每一条都要能在登记日历 descriptor 的注册表里查到——
 * 这条守卫会在 id 被删掉/改名的当天变红，而不是等到补跑空跑或报错才发现。
 */
describe('the catch-up list', () => {
  it('holds only registered descriptors, and only the ones the runtime says are running', () => {
    // 契约说的是「登记了哪条采集入口」，补跑要的是「此刻有作业在跑」——今天在采的是 0xRouter 三路。
    const ids = briefingCalendarCatchUpSourceIds(registered(...liveCalendarJobIds))
    expect([...ids]).toEqual([...liveFeedIds])
    for (const feedId of ids) expect(marketCalendarPublicPolicy.descriptors).toContain(feedId)
    for (const feedId of ids) {
      // 「登记」看的是日历 feed 注册表（证据源注册表里没有市场侧 feed，那是另一张表）。
      expect(calendarFeedRegistry[feedId as keyof typeof calendarFeedRegistry]).toBeDefined()
    }
    // 反证：不存在的 id 在注册表里查不到——上面那条断言不是空转。
    expect(calendarFeedRegistry['macro-calendar-0xrouter-economic-dat' as keyof typeof calendarFeedRegistry]).toBeUndefined()
  })
})
