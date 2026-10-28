import { crossAssetContractPolicy, crossAssetCurveStrideMs, type CrossAssetId, type CrossAssetMacroProxyId } from '../../../contracts/crossAssetObservationContracts'
import type { CalendarCardProjection, CalendarCardRow } from './projectUpcomingCalendarCard'

/**
 * 「这次发布前后各 30 分钟，四条线各自走了多少」（原型 ④：已公布行下面的那一行）。
 *
 * 原型里那一行长这样：`QQQ −0.12%  BTC −0.18%  ETH −0.21%  美元 +0.04%`。它是**行情事实**，不是判断：
 * 谁都没说这 0.12% 是这次发布造成的，只是把窗口两端的读数摆在一起，让读者自己看那次发布前后市场
 * 有没有动。判断留给判读与分析结论，两者不合流。
 *
 * 三条规矩：
 *
 * 1. **锚点是这一行自己显示的时刻**（`CalendarCardRow.at`）：读者看到的时间就是窗口的中心，不需要
 *    再猜是官方时刻还是 provider 时刻——那两个在两条路线上本来就可能差几分钟。没有时刻的行（官方只
 *    给了日期）没有窗口，不画。
 * 2. **窗口两端都必须到齐**：左端取"不晚于 −30 分的最后一个点"，右端取"不早于 +30 分的第一个点"。
 *    发布还不到 30 分钟时右端还没发生，这里就**不给数字**——半个窗口配「±30分」这个标签是假话。
 * 3. **读数用相对收益**：曲线上的点都是相对窗口起点的锚定收益，所以两点之间的变化是两个锚定收益的
 *    比值，与 `crossAssetWindowReturns` 同一套算法（+10% 之后 +5%，子窗口是 4.76% 而不是 −5%）。
 *
 * 这个模块是纯的：读哪一段曲线、什么时候读，由调用方（`useCalendarCardData`）决定；失败、缺数据、
 * 曲线不覆盖，一律是"不画这一行"，绝不用 0 或上一笔读数顶上。
 */
export const calendarCardReactionPolicy = Object.freeze({
  version: 'marketIntelligenceCalendarCardReactionPolicy.v1',
  /** 事件两侧各取这么长：原型写的是「±30分」。 */
  windowMs: 30 * 60 * 1_000,
  /**
   * The line order. The dollar is a macro-proxy curve on the same grid, not a collected symbol, but
   * it is the first thing a macro release moves — a rate surprise priced without it is half a move.
   */
  displayOrder: Object.freeze(['index', 'btc', 'eth', 'dxy'] as const)
})

export type CalendarCardReactionId = CrossAssetId | 'dxy'

/** 每条线在这段窗口里的收益（%）。`null` = 这条线在这一段答不出来，卡片就不印它。 */
export type CalendarCardReaction = Readonly<Record<CalendarCardReactionId, number | null>>

type CurvePoint = Readonly<{ at: string; returnPercent: number | null }>
type Bound = Readonly<{ atMs: number; returnPercent: number | null }>

/** 不晚于该时刻的最后一个点：窗口左端就是这么取的。 */
function lastAtOrBefore(points: readonly CurvePoint[], instantMs: number): Bound | undefined {
  let found: Bound | undefined
  for (const point of points) {
    const atMs = Date.parse(point.at)
    if (!Number.isFinite(atMs) || atMs > instantMs) continue
    // 曲线按时间递增，但契约不保证；取时刻最大的那个点，而不是最后一个。
    if (!found || atMs > found.atMs) found = { atMs, returnPercent: point.returnPercent }
  }
  return found
}

/** 不早于该时刻的第一个点：窗口右端要的是"已经发生"的点，不是"最接近但还没到"。 */
function firstAtOrAfter(points: readonly CurvePoint[], instantMs: number): Bound | undefined {
  let found: Bound | undefined
  for (const point of points) {
    const atMs = Date.parse(point.at)
    if (!Number.isFinite(atMs) || atMs < instantMs) continue
    if (!found || atMs < found.atMs) found = { atMs, returnPercent: point.returnPercent }
  }
  return found
}

/**
 * 这条曲线自己相邻两点之间的最小间距。
 *
 * 与 `crossAssetWindowReturns` 同一条规矩：**比窗口还稀的曲线读不出这个窗口**。今天读的是 24h 的
 * 5 分钟档，所以这是保险；一旦有人换了读法（比如拿 7d 的小时级曲线来算），这里先红。
 */
function curveStrideMs(points: readonly CurvePoint[]): number | undefined {
  const instants = points.map(point => Date.parse(point.at)).filter(atMs => Number.isFinite(atMs)).sort((left, right) => left - right)
  let stride: number | undefined
  for (let index = 1; index < instants.length; index += 1) {
    const gap = instants[index]! - instants[index - 1]!
    if (gap > 0 && (stride === undefined || gap < stride)) stride = gap
  }
  return stride
}

export function reactionReturns(input: Readonly<{
  curves: Readonly<Partial<Record<CrossAssetId, readonly CurvePoint[]>>>
  /** The dollar/gold curves the cross-asset snapshot carries beside the collected symbols. */
  macroCurves?: Readonly<Partial<Record<CrossAssetMacroProxyId, readonly CurvePoint[]>>>
  /** 这一行显示的时刻（ISO）。 */
  instant: string
  windowMs?: number
}>): CalendarCardReaction | undefined {
  const instantMs = Date.parse(input.instant)
  if (!Number.isFinite(instantMs)) return undefined
  const windowMs = input.windowMs ?? calendarCardReactionPolicy.windowMs
  const returns: Partial<Record<CalendarCardReactionId, number | null>> = {}
  for (const asset of crossAssetContractPolicy.assets) returns[asset] = seriesReturn(input.curves[asset] ?? [], instantMs, windowMs)
  returns.dxy = seriesReturn(input.macroCurves?.dxy ?? [], instantMs, windowMs)
  // 四条线都答不出来、或全都平（0.00%）时，卡片就没有这一行可画：印一行 0 不是反应。
  const hasSignal = calendarCardReactionPolicy.displayOrder.some(asset => {
    const value = returns[asset]
    return typeof value === 'number' && value !== 0
  })
  return hasSignal ? Object.freeze(returns as CalendarCardReaction) : undefined
}

/** One series' return across the window, or `null` when either end or the sampling is missing. */
function seriesReturn(points: readonly CurvePoint[], instantMs: number, windowMs: number): number | null {
  const from = lastAtOrBefore(points, instantMs - windowMs)
  const to = firstAtOrAfter(points, instantMs + windowMs)
  const stride = curveStrideMs(points)
  // 两端缺一不可；比窗口还稀的曲线读不出这个窗口（用小时级的点标「±30分」是假话）。
  if (!from || !to || from.returnPercent === null || to.returnPercent === null ||
    (stride !== undefined && stride > windowMs)) return null
  const value = ((1 + to.returnPercent / 100) / (1 + from.returnPercent / 100) - 1) * 100
  return Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : null
}

/**
 * 需要读反应的行时刻，按出现顺序去重。
 *
 * 只有「最近已公布（有变化）」且显示了自己时刻的行才有窗口：还没发布的没有反应可言，只给了日期的
 * 没有时刻可依。去重是因为同一分钟里的两条发布共用一个窗口——一次读，两行都用。
 */
export function reactionAnchors(rows: readonly CalendarCardRow[]): readonly string[] {
  const anchors: string[] = []
  for (const row of rows) {
    if (row.kind !== 'released-changed' || row.at === null) continue
    if (!Number.isFinite(Date.parse(row.at))) continue
    if (!anchors.includes(row.at)) anchors.push(row.at)
  }
  return Object.freeze(anchors)
}

/** 把读回来的反应贴到对应时刻的行上；没有读数的行不带字段，卡片据此决定画不画。 */
export function attachReactions(
  projection: CalendarCardProjection,
  reactions: ReadonlyMap<string, CalendarCardReaction>
): CalendarCardProjection {
  if (reactions.size === 0) return projection
  return {
    ...projection,
    today: projection.today.map(row => {
      const reaction = row.at === null ? undefined : reactions.get(row.at)
      return reaction === undefined ? row : { ...row, reaction }
    })
  }
}

/** 反应只用这一档：24 小时、5 分钟网格 —— 唯一能覆盖事件两侧的档位。 */
export const calendarCardReactionReaderPolicy = Object.freeze({ range: '24h' as const })

/**
 * 这条查询就是跨资产那条已有查询（面板用的同一个客户端）：要的是它自己的快照，或它的"不可用"。
 *
 * 只声明它真正读的那一部分——`curves`——其余字段（相关性、闭合收益、读数）与「±30 分」无关；
 * 页面因此可以把 `crossAssetClient.query` 直接交给读取器，不必在页面入口再包一层适配。
 */
export type CalendarCardReactionQuery = (input: Readonly<{ range: '24h'; asOf: string }>) =>
  Promise<Readonly<{ state: 'unavailable' }> | Readonly<{
    curves: Readonly<Partial<Record<CrossAssetId, readonly CurvePoint[]>>>
    macroCurves?: Readonly<Partial<Record<CrossAssetMacroProxyId, readonly CurvePoint[]>>>
  }>>

/**
 * 把跨资产那条已有查询包成"给我这一行的 ±30 分反应"。
 *
 * 读法由这里定，而且只有这里定：以**事件 +30 分钟再加一个网格步长**为终点的 24 小时查询。多要一步是因为
 * 曲线以 `asOf` 为终点、而 `asOf` 会被主进程截到 5 分钟网格上：发布时间不在网格上时（例如 12:31），
 * 正好压在 +30 分钟上的终点会被截到 +30 之前，右端就没有"已经发生"的点了。多要一步之后，右端必然存在，
 * 且窗口只可能比 ±30 分钟**宽**（左端取最后一个不晚于 −30 的点，右端取第一个不早于 +30 的点）。
 *
 * 读失败（不可用、抛错、返回不合法）一律是 `undefined`：卡片不画这一行。时刻不合法时连读都不读——
 * 不发一个注定没有意义的请求。
 */
export function createCalendarCardReactionReader(query: CalendarCardReactionQuery) {
  const offsetMs = calendarCardReactionPolicy.windowMs
  // 网格步长归契约（`crossAssetCurveStrideMs`），这里不再写一个 5 分钟。
  const gridMs = crossAssetCurveStrideMs(calendarCardReactionReaderPolicy.range)
  return async function readReaction(instant: string): Promise<CalendarCardReaction | undefined> {
    const instantMs = Date.parse(instant)
    if (!Number.isFinite(instantMs)) return undefined
    try {
      const asOf = new Date(instantMs + offsetMs + gridMs).toISOString()
      const result = await query({ range: calendarCardReactionReaderPolicy.range, asOf })
      // 客户端的"不可用"是它自己的形状（`{state:'unavailable'}`）；快照本身没有 `state`。
      if ('state' in result) return undefined
      return reactionReturns({ curves: result.curves, macroCurves: result.macroCurves, instant })
    } catch {
      return undefined
    }
  }
}
