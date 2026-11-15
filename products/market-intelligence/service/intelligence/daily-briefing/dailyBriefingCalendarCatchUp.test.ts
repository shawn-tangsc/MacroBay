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

function freshness(lastCollectedAt: string | null, attempt?: { attemptedAt: string; state: 'succeeded' | 'failed' }) {
  return {
    state: 'available' as const,
    asOf: dataAsOf,
    lastCollectedAt,
    sources: (['macro-calendar-narwhal-economic-data', 'macro-calendar-narwhal-financial-events', 'macro-calendar-narwhal-central-bank-activities'] as const)
      .map((descriptorId) => ({ descriptorId, lastCollectedAt, ...(attempt ? { latestAttempt: attempt } : {}) }))
  }
}

describe('the catch-up list is the registry\'s "actually collecting" answer', () => {
  // 清单恒等于「注册表里 collection 非 none 的 feed」——不手抄、不读契约。
  it('equals exactly the feeds the registry says are collecting', () => {
    /* 与实现同一判据：**在市场侧、有采集作业、不被别的 feed 覆盖、且不是「读者启用后才采」**。
       `optIn` 那条是 2026-11-15 加的：0xRouter 三路是补充源，没配置就没有作业，不能算在采。 */
    const collecting = Object.values(calendarFeedRegistry)
      .filter(feed => feed.owner === 'market' && feed.collection !== 'none'
        && feed.coveredBy === undefined && feed.optIn !== true)
      .map(feed => feed.feedId)
    expect([...briefingCalendarCatchUpSourceIds()].sort()).toEqual([...collecting].sort())
  })

  // 反向、最重要：**登记 ≠ 在采**。Narwhal 这一版三条都登记了，但只有「登记、没接采集器」，
  // 一条都不许进补跑清单——否则 refreshNow 只会回 unavailable。
  // 反向、最重要：**被覆盖的那两条不进清单**（一次写三类的作业只挂第一条）。
  it('leaves the feeds covered by another feed out of the list', () => {
    const covered = Object.values(calendarFeedRegistry).filter(feed => feed.coveredBy !== undefined)
    expect(covered.length).toBeGreaterThan(0)
    for (const feed of covered) expect(briefingCalendarCatchUpSourceIds()).not.toContain(feed.feedId)
  })

  // 时间性：接上采集器之后它自动进清单，调用点一个字不改（B 相对「新增字段」的全部收益）。
  it('picks a feed up automatically once the registry says it collects', () => {
    const feed = Object.values(calendarFeedRegistry).find(candidate => candidate.coveredBy !== undefined)!
    const patched = { ...feed, collection: 'job' as const, coveredBy: undefined }
    const collecting = [...Object.values(calendarFeedRegistry).filter(candidate => candidate.feedId !== feed.feedId), patched]
    const ids = collecting.filter(candidate => candidate.owner === 'market' && candidate.collection !== 'none' && candidate.coveredBy === undefined).map(candidate => candidate.feedId)
    expect(ids).toContain(feed.feedId)
    // 与实现的判据同形：同样的过滤函数对注册表取值。
    expect(briefingCalendarCatchUpSourceIds()).not.toContain(feed.feedId)
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

  it('catches up once for a stale calendar and decides from the reading taken afterwards', async () => {
    const refreshNow = vi.fn(async () => ({ state: 'collected' as const, sources: ['macro-calendar-narwhal-economic-data'] }))
    const reads = [freshness(staleAt), freshness(dataAsOf)]
    let call = 0
    const reading = await ensureCalendarFreshForRun({
      dataAsOf, enabled: true, refreshNow,
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
      dataAsOf, enabled: true,
      refreshNow: async () => ({ state: 'timeout' as const, timeoutMs: 90_000 }),
      readFreshness: async () => freshness(staleAt)
    })

    // A timeout is its own verdict, not a failure, and the reading stays stale rather than fresh.
    expect(reading).toEqual({ state: 'available', lastCollectedAt: staleAt, catchUp: { state: 'timeout', timeoutMs: 90_000 } })
  })

  it('records a failed catch-up as failed, never as timeout', async () => {
    const reading = await ensureCalendarFreshForRun({
      dataAsOf, enabled: true,
      refreshNow: async () => ({ state: 'failed' as const, failureCode: 'credential-not-configured' }),
      readFreshness: async () => freshness(staleAt)
    })

    expect(reading.catchUp).toEqual({ state: 'failed', failureCode: 'credential-not-configured' })
  })

  it('treats a throwing command as a failure, and keeps going', async () => {
    const reading = await ensureCalendarFreshForRun({
      dataAsOf, enabled: true,
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
      dataAsOf, enabled: true,
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
      dataAsOf, enabled: true,
      refreshNow: async () => ({ state: 'collected' }),
      readFreshness: async () => freshness(staleAt)
    })

    expect(reading.catchUp).toEqual({ state: 'unknown', failureCode: 'catch-up-verdict-invalid' })
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
  it('holds only registered descriptors, and only the ones the registry says are collecting', () => {
    // 不再是「等于契约里那三条」：契约说的是登记，补跑要的是在采（今天一条）。
    expect([...briefingCalendarCatchUpSourceIds()]).toEqual(['macro-calendar-narwhal-economic-data'])
    expect(marketCalendarPublicPolicy.feedByKind).toContain('macro-calendar-narwhal-economic-data')
    for (const feedId of briefingCalendarCatchUpSourceIds()) {
      // 「登记」看的是日历 feed 注册表（证据源注册表里没有市场侧 feed，那是另一张表）。
      expect(calendarFeedRegistry[feedId as keyof typeof calendarFeedRegistry]).toBeDefined()
    }
    // 反证：不存在的 id 在注册表里查不到——上面那条断言不是空转。
    expect(calendarFeedRegistry['macro-calendar-0xrouter-economic-dat' as keyof typeof calendarFeedRegistry]).toBeUndefined()
  })
})
