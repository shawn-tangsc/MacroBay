// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'

import type { CrossAssetId } from '../../../contracts/crossAssetObservationContracts'
import { attachReactions, createCalendarCardReactionReader, reactionAnchors, reactionReturns, calendarCardReactionPolicy } from './calendarCardReaction'
import type { CalendarCardProjection, CalendarCardRow } from './projectUpcomingCalendarCard'

/**
 * 日历卡片上的「±30 分」反应（原型 ④：已公布行下面那一行 QQQ/BTC/ETH）。
 *
 * 测试清单：
 * - 两侧都有点 → 逐资产给出窗口内的相对收益（与 `crossAssetWindowReturns` 同一套算法：两个锚定收益的比值）；
 * - 事件之前没有点、或事件之后还没到（发布不足 30 分钟）→ **不给数字**，而不是给半个窗口；
 * - 某个资产那一端是空洞（`returnPercent === null`）→ 那个资产没有数字，别的资产照给；
 * - 三个资产都没有数字 → `undefined`（卡片不画这一行）；
 * - 读反应的行：只有「最近已公布（有变化）」且**有确切时刻**的行（没有时刻就没有窗口）；
 * - `attachReactions`：只给这些行加上反应，其它行一个字都不动。
 *
 * 时间是本模块唯一的坐标：窗口两端都取"不晚于该时刻的最后一个点"，所以 5 分钟网格允许的误差
 * 最多 5 分钟，且永远不会借用一个还没发生的点。
 */
const STEP_MS = 300_000
const base = Date.parse('2026-10-14T02:00:00.000Z')
const iso = (offsetMinutes: number): string => new Date(base + offsetMinutes * 60_000).toISOString()
/** A curve whose points sit on the five-minute grid, offset in minutes from `base`. */
const curve = (points: readonly (readonly [number, number | null])[]) =>
  points.map(([offset, returnPercent]) => ({ at: iso(offset), returnPercent }))
const curves = (points: readonly (readonly [number, number | null])[]): Record<CrossAssetId, ReturnType<typeof curve>> =>
  ({ index: curve(points), btc: curve(points), eth: curve(points) })

/** A window with both ends present: −60…+60 in five-minute steps, flat at first then rising. */
const fullWindow = [[-60, 0], [-35, 1], [-30, 2], [-5, 3], [0, 4], [25, 5], [30, 6], [60, 7]] as const

const row = (overrides: Partial<CalendarCardRow> = {}): CalendarCardRow => ({
  eventKey: 'US.CPI.RELEASE.2026-M10', titleKey: 'cpi', month: '2026-10', date: '2026-10-14', at: iso(0),
  importance: 'high', category: 'economic-indicator', kind: 'released-changed', awaitingData: false,
  actual: '3.2%', previous: '3.1%', consensus: '3.0%',
  surprise: { direction: 'beat', value: 0.2, unit: 'pp', reason: null }, ...overrides
})
const projection = (today: readonly CalendarCardRow[], upcoming: readonly CalendarCardRow[] = []): CalendarCardProjection =>
  ({ today, upcoming, state: today.length + upcoming.length > 0 ? 'available' : 'empty' })

describe('the ±30 minute reaction around a release', () => {
  it('reads the move between the two ends of the window, per asset', () => {
    const reaction = reactionReturns({ curves: curves(fullWindow), instant: iso(0) })
    // −30 的点是 +2%，+30 的点是 +6%：两个锚定收益的比值，而不是差值。
    const expected = ((1 + 6 / 100) / (1 + 2 / 100) - 1) * 100
    for (const asset of ['index', 'btc', 'eth'] as const) expect(reaction?.[asset]).toBeCloseTo(expected, 12)
    expect(calendarCardReactionPolicy.windowMs).toBe(30 * 60 * 1_000)
  })

  it('refuses to state half a window, in either direction', () => {
    // 事件之前没有点：窗口的左端不存在。
    expect(reactionReturns({ curves: curves([[-10, 0], [0, 1], [30, 2], [60, 3]]), instant: iso(0) })).toBeUndefined()
    // 发布还不到 30 分钟：右端还没发生。
    expect(reactionReturns({ curves: curves([[-60, 0], [-30, 1], [0, 2], [15, 3]]), instant: iso(0) })).toBeUndefined()
    // 事件落在曲线覆盖之外（快照是给它自己那 24 小时读的）。
    expect(reactionReturns({ curves: curves(fullWindow), instant: iso(600) })).toBeUndefined()
  })

  it('keeps a hole in one asset from blanking the other two', () => {
    const holed = { ...curves(fullWindow), eth: curve([[-60, 0], [-30, null], [30, 6], [60, 7]]) }
    const reaction = reactionReturns({ curves: holed, instant: iso(0) })
    expect(reaction?.index).toBeCloseTo(((1 + 6 / 100) / (1 + 2 / 100) - 1) * 100, 12)
    expect(reaction?.eth).toBeNull()
  })

  it('says nothing at all when no asset can answer', () => {
    const empty = { index: [], btc: curve([[-10, 1]]), eth: curve([[-30, null], [30, null]]) }
    expect(reactionReturns({ curves: empty, instant: iso(0) })).toBeUndefined()
    // 曲线比窗口还稀（小时级的点配 ±1 分钟的窗口）读不出这个窗口：不许把一小时的运动标成 ±30 分钟。
    expect(reactionReturns({ curves: curves([[-60, 0], [0, 4], [60, 7]]), instant: iso(0), windowMs: 60_000 })).toBeUndefined()
  })

  it('normalises a negative zero, like every other return in this product', () => {
    const flat = reactionReturns({ curves: curves([[-30, 3], [0, 3], [30, 3]]), instant: iso(0) })
    for (const asset of ['index', 'btc', 'eth'] as const) {
      expect(flat?.[asset], asset).toBe(0)
      expect(Object.is(flat?.[asset], -0), asset).toBe(false)
    }
  })
})

describe('which rows get a reaction read', () => {
  it('takes the released rows that have an instant, in order, once each', () => {
    const rows = [
      row({ eventKey: 'a', at: iso(-120) }),
      row({ eventKey: 'b', at: iso(-60) }),
      // 同一分钟的两条发布共用一个窗口：一次读，两行都用它。
      row({ eventKey: 'c', at: iso(0) }),
      row({ eventKey: 'd', at: iso(0) }),
      // 没有确切时刻（官方只给了日期）：没有窗口可算，不读。
      row({ eventKey: 'e', at: null }),
      // 还没发布：没有反应可言。
      row({ eventKey: 'f', at: iso(60), kind: 'upcoming' })
    ]
    expect(reactionAnchors(rows)).toEqual([iso(-120), iso(-60), iso(0)])
  })

  it('leaves the projection alone apart from the reaction it was handed', () => {
    const released = row({ eventKey: 'a', at: iso(0) })
    const upcoming = row({ eventKey: 'b', at: iso(60), kind: 'upcoming' })
    const before = projection([released], [upcoming])
    const reaction = { index: 0.5, btc: null, eth: -0.25 }
    const after = attachReactions(before, new Map([[iso(0), reaction]]))
    expect(after.today[0]?.reaction).toEqual(reaction)
    expect(after.upcoming[0]?.reaction).toBeUndefined()
    expect(after.state).toBe(before.state)
    // 没有读数的那一行不带字段，而不是带一个 null —— 卡片据此决定画不画这一行。
    expect(attachReactions(before, new Map()).today[0]).not.toHaveProperty('reaction')
  })
})

/**
 * 读窗口的那一步：向跨资产那条已有查询要"以事件 +30 分钟为终点的 24 小时"，再算 ±30 分。
 *
 * 只替掉 IPC 边界（查询本身），窗口与算法的判断都在真实代码里——这样"读到什么、怎么算"仍然是被测的
 * 行为，而不是替身的行为。
 */
describe('reading the window for one row', () => {
  // 真快照没有 `state`（只有"不可用"那个分支有），所以夹具照真形状写。
  const snapshot = (points: readonly (readonly [number, number | null])[]) =>
    ({ range: '24h' as const, mode: 'historical' as const, asOf: iso(30), curves: curves(points) })

  it('asks for the 24h window that ends 30 minutes after the event, and reads the move across it', async () => {
    const query = vi.fn(async () => snapshot(fullWindow))
    const read = createCalendarCardReactionReader(query)
    const reaction = await read(iso(0))
    const expected = ((1 + 6 / 100) / (1 + 2 / 100) - 1) * 100
    expect(reaction?.index).toBeCloseTo(expected, 12)
    // 终点的选择不是随意的：曲线以 asOf 为终点（并被主进程截到 5 分钟网格上），所以要向 +30 分钟
    // 之后再要一个网格步长，右端才有"已经发生"的点——发布时间不在网格上时（12:31 这种）尤其如此。
    expect(query).toHaveBeenCalledWith({ range: '24h', asOf: iso(30 + 5) })
  })

  it('treats an unavailable read, a throw and a malformed instant as "no reaction"', async () => {
    expect(await createCalendarCardReactionReader(async () => ({ state: 'unavailable' as const }))(iso(0))).toBeUndefined()
    expect(await createCalendarCardReactionReader(async () => { throw new Error('ipc down') })(iso(0))).toBeUndefined()
    const query = vi.fn(async () => snapshot(fullWindow))
    expect(await createCalendarCardReactionReader(query)('not-an-instant')).toBeUndefined()
    // 时刻不合法就连读都不读：不发一个没有意义的请求。
    expect(query).not.toHaveBeenCalled()
  })
})
