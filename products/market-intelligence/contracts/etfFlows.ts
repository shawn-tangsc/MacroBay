/**
 * ETF net flow summed over a window of trading rows.
 *
 * The source returns one row per completed trading day. This helper deliberately re-normalizes the
 * order instead of trusting it: rows are sorted by `tradingDate` first, so an out-of-order array
 * still yields the same windows. A duplicate `tradingDate` is ambiguous (which revision wins?) and
 * fails closed to `undefined` instead of silently merging. Windows are counted in **rows**, never
 * calendar days: a Friday-to-Monday weekend gap still counts as two trading days.
 *
 * A short window is never padded, extrapolated, or back-filled. `coveredDays` is the number of rows
 * actually summed, and `complete` is true only when that equals `windowDays`.
 *
 * The window lengths are a parameter rather than a constant because three readings ask for three
 * different ones — the panel draws five and twenty days, the analysis snapshot publishes the same
 * two as facts, and the outflow rule looks at three — and every one of them must be the same
 * arithmetic. A second copy of this loop is how a weekend ends up counted once per caller.
 */
export const etfFlowPolicy = Object.freeze({
  /** The windows the panel draws and the analysis snapshot publishes as cumulative facts. */
  cumulativeWindows: Object.freeze([5, 20] as const),
  /** The window the outflow rule judges: three consecutive trading days. */
  signalWindowDays: 3,
  /**
   * How much net outflow over {@link signalWindowDays} is worth telling the reader about.
   *
   * Negative because outflow is a negative net flow. The rule that reads it lives beside the
   * signal it raises; the number lives here, with the arithmetic that produces the sum.
   */
  signalOutflowUsd: -100_000_000,
  tradingDatePattern: /^\d{4}-\d{2}-\d{2}$/
} as const)

/**
 * 这条读数允许从哪里到达读者。
 *
 * **一个事实一个开关，不是每个出口一个开关。** 资金面卡片上的牌子是它的正身，通知是另一个
 * 出口：牌子还没上、通知先到，读者打开看板找不到它，第一反应是通知坏了——通知的可信度只有
 * 一次。所以牌子的开关是总闸，任何新出口（日报、推送）都读这里，不许各自再开一个。
 */
export const etfOutflowOutletPolicy = Object.freeze({
  /** 资金面卡片标题旁的牌子。总闸：它关着，其他出口一律关。 */
  panel: false,
  /** 通知中心。牌子落地前不许单独打开。 */
  notification: false
} as const)

export type EtfOutflowOutlet = keyof typeof etfOutflowOutletPolicy

/** 开关的取值表。生产读 {@link etfOutflowOutletPolicy}，用例传自己的表来钉住每种组合。 */
export type EtfOutflowOutletSwitch = Readonly<Record<EtfOutflowOutlet, boolean>>

/** 出口是否开着：总闸（牌子）关着时，单个出口写了 `true` 也不算开。 */
export function isEtfOutflowOutletOpen(switchState: EtfOutflowOutletSwitch, outlet: EtfOutflowOutlet): boolean {
  return switchState.panel && switchState[outlet]
}

export type EtfCumulativeFlowWindow = Readonly<{
  windowDays: number
  coveredDays: number
  netFlowUsd: number
  complete: boolean
}>

type FlowRow = Readonly<{ tradingDate: string; netFlowUsd: number }>

export function computeEtfCumulativeFlow(rows: unknown, windowDays: readonly number[] = etfFlowPolicy.cumulativeWindows): readonly EtfCumulativeFlowWindow[] | undefined {
  try {
    if (!Array.isArray(rows) || rows.length === 0) return undefined
    if (!isWindowList(windowDays)) return undefined
    const normalized: FlowRow[] = []
    for (const row of rows) {
      if (!isFlowRow(row)) return undefined
      normalized.push({ tradingDate: row.tradingDate, netFlowUsd: row.netFlowUsd })
    }
    normalized.sort((left, right) => left.tradingDate < right.tradingDate ? -1 : left.tradingDate > right.tradingDate ? 1 : 0)
    for (let index = 1; index < normalized.length; index += 1) {
      if (normalized[index]!.tradingDate === normalized[index - 1]!.tradingDate) return undefined
    }
    const windows: EtfCumulativeFlowWindow[] = []
    for (const window of windowDays) {
      const covered = normalized.slice(-window)
      const total = covered.reduce((sum, row) => sum + row.netFlowUsd, 0)
      if (!Number.isFinite(total)) return undefined
      windows.push(Object.freeze({
        windowDays: window,
        coveredDays: covered.length,
        netFlowUsd: Object.is(total, -0) ? 0 : total,
        complete: covered.length === window
      }))
    }
    return Object.freeze(windows)
  } catch {
    return undefined
  }
}

/**
 * The newest complete window at or below `windowDays`, or `undefined` when none is complete.
 *
 * The outflow rule asks one question — "is the last three trading days a large net outflow?" — and
 * must not be handed a three-day total summed over two days. Keeping that check here means the rule
 * cannot forget it, and the window list it asks for stays a single number.
 */
export function latestCompleteWindow(windows: readonly EtfCumulativeFlowWindow[] | undefined, windowDays: number): EtfCumulativeFlowWindow | undefined {
  return windows?.find(window => window.windowDays === windowDays && window.complete)
}

function isWindowList(value: unknown): value is readonly number[] {
  if (!Array.isArray(value) || value.length === 0) return false
  const seen = new Set<number>()
  for (const entry of value) {
    if (!Number.isSafeInteger(entry) || entry < 1) return false
    if (seen.has(entry)) return false
    seen.add(entry)
  }
  return true
}

function isFlowRow(value: unknown): value is FlowRow {
  if (!isPlainRecord(value)) return false
  return isTradingDate(value.tradingDate) &&
    typeof value.netFlowUsd === 'number' && Number.isFinite(value.netFlowUsd) && !Object.is(value.netFlowUsd, -0)
}

function isTradingDate(value: unknown): value is string {
  if (typeof value !== 'string' || !etfFlowPolicy.tradingDatePattern.test(value)) return false
  const parsed = Date.parse(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype && Object.getOwnPropertySymbols(value).length === 0
}
