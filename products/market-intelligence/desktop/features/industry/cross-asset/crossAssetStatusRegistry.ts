import type { CrossAssetId } from '../../../../contracts/crossAssetObservationContracts'
import {
  macroMarketSnapshotPublicPolicy,
  type MacroMarketSnapshotReading
} from '../../../../contracts/macro/macroMarketSnapshotContracts'
import { macroRatesSnapshotPublicPolicy } from '../../../../contracts/macro/macroRatesSnapshotContracts'

/**
 * The rows of the 市场状态 block, in reading order: what moves the market first, then the assets
 * being moved.
 *
 * Four macro drivers, in two classes. The dollar and gold have a series behind them
 * (`dxy-synthetic`, `xau-usd`), and the 10-year and the real rate have FRED's official *daily*
 * closes (`DGS10`, `DFII10`) — so a macro row is `connected` exactly when the snapshot it belongs to
 * carries that reading. A series with no stored point leaves the row `planned` rather than showing a
 * level from nowhere.
 *
 * `planned` rows exist so the block is honest about its own coverage: the reader sees which inputs
 * the dashboard still lacks, in the place where they will appear. A planned row must never render a
 * number — a fabricated dollar level would be worse than an empty slot — so the panel prints
 * `notConnected` and nothing else. That rule is pinned by test.
 */
export type CrossAssetStatusRow =
  | Readonly<{ id: CrossAssetId; state: 'connected' }>
  | Readonly<{ id: 'dxy' | 'gold' | 'us10y' | 'realRate'; state: 'connected' | 'planned' }>

export type CrossAssetStatusId = CrossAssetStatusRow['id']

/**
 * Which macro series may feed which macro row, best candidate first. Nothing else may fill the dollar
 * or gold row: the dollar's first candidate is the provider's own ICE index and its second is this
 * product's synthesis, so a licensed level is never shown beside a computed one.
 */
export const crossAssetMacroSeriesIds: Readonly<Record<'dxy' | 'gold', readonly string[]>> = Object.freeze({
  dxy: macroMarketSnapshotPublicPolicy.dollarIndexPreference,
  gold: Object.freeze([macroMarketSnapshotPublicPolicy.series.gold])
})

/**
 * Which daily FRED series feeds the two rate rows. The 2Y and the breakeven are context for the
 * detail line; they fill no row.
 */
export const crossAssetRatesSeriesIds: Readonly<Record<'us10y' | 'realRate', string>> = Object.freeze({
  us10y: macroRatesSnapshotPublicPolicy.series.us10y,
  realRate: macroRatesSnapshotPublicPolicy.series.realRate
})

/** The rows that carry no reading at all until their own snapshot answers. */
export type CrossAssetPlannedId = 'dxy' | 'gold' | 'us10y' | 'realRate'

/** The candidate series for a macro row; the two rate rows read their own daily source instead. */
export function crossAssetMacroSeriesFor(id: CrossAssetPlannedId): readonly string[] | undefined {
  return id === 'dxy' || id === 'gold' ? crossAssetMacroSeriesIds[id] : undefined
}

/**
 * The reading a macro row renders: the candidate the snapshot carries.
 *
 * 这条线**不自带新鲜度规则**。以前它自己又判了一遍"真实 DXY 是否过期"，而主进程已经判过一次：同一条
 * 规矩两处实现，读者 2026-10-17 看到的「合成」正是它们的合谋——周末 FX 收盘，真实那条是周五的收盘价，
 * 合成那条两天前就停了，两层规则各自"回退"到了一个更旧、还是另一件东西的值。
 *
 * 现在线上每条快照只带一条美元读数（主进程按"兜底不能比被替换的那条更旧"选好）。两条都在时（只有在
 * 某个旧主进程或测试里才会发生）取**更新**的一条：较旧的那条永远不该赢，不论它叫什么名字。
 */
export function crossAssetMacroReading(
  readings: readonly MacroMarketSnapshotReading[],
  id: 'dxy' | 'gold'
): MacroMarketSnapshotReading | undefined {
  let chosen: MacroMarketSnapshotReading | undefined
  for (const seriesId of crossAssetMacroSeriesFor(id) ?? []) {
    const reading = readings.find(candidate => candidate.seriesId === seriesId)
    if (!reading) continue
    if (!chosen || reading.atMs > chosen.atMs) chosen = reading
  }
  return chosen
}

const crossAssetNoDataRows = [
  Object.freeze({ id: 'dxy' as const, state: 'planned' as const }),
  Object.freeze({ id: 'gold' as const, state: 'planned' as const }),
  Object.freeze({ id: 'us10y' as const, state: 'planned' as const }),
  Object.freeze({ id: 'realRate' as const, state: 'planned' as const }),
  // Connected: the index row, answered by the licensed Nasdaq 100 index and, only when that source
  // has nothing, by the labelled Binance proxy.
  Object.freeze({ id: 'index' as const, state: 'connected' as const }),
  Object.freeze({ id: 'btc' as const, state: 'connected' as const }),
  Object.freeze({ id: 'eth' as const, state: 'connected' as const })
]

/** The no-data reading order; `resolveCrossAssetStatusRows` promotes the funded rows. */
export const crossAssetStatusRows: readonly CrossAssetStatusRow[] = Object.freeze(crossAssetNoDataRows)

/**
 * The rows for one macro snapshot and one daily rates snapshot. A macro row is connected only when
 * its own series has a reading; an empty or unavailable snapshot reproduces the no-data list exactly.
 */
export function resolveCrossAssetStatusRows(
  readings: readonly MacroMarketSnapshotReading[],
  rateReadings: readonly Readonly<{ seriesId: string }>[] = []
): readonly CrossAssetStatusRow[] {
  const available = new Set(readings.map(reading => reading.seriesId))
  const rates = new Set(rateReadings.map(reading => reading.seriesId))
  return Object.freeze(crossAssetStatusRows.map(row =>
    isPlannedMacroRow(row.id) && hasReading(row.id, available, rates)
      ? Object.freeze({ id: row.id, state: 'connected' as const })
      : row))
}

/** The rows whose data is not connected yet, in the no-data state of the registry. */
export const plannedCrossAssetStatusIds: readonly CrossAssetPlannedId[] = Object.freeze(
  crossAssetNoDataRows.filter((row) => row.state === 'planned').map((row) => row.id)
)

function hasReading(id: 'dxy' | 'gold' | 'us10y' | 'realRate', available: ReadonlySet<string>, rates: ReadonlySet<string>): boolean {
  if (id === 'dxy' || id === 'gold') return crossAssetMacroSeriesIds[id].some(seriesId => available.has(seriesId))
  return rates.has(crossAssetRatesSeriesIds[id])
}

function isPlannedMacroRow(id: CrossAssetStatusId): id is 'dxy' | 'gold' | 'us10y' | 'realRate' {
  return id === 'dxy' || id === 'gold' || id === 'us10y' || id === 'realRate'
}
