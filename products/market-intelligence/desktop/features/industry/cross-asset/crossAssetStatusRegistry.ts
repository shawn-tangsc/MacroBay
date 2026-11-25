import type { CrossAssetId } from '../../../../contracts/crossAssetObservationContracts'
import {
  macroMarketSnapshotPublicPolicy,
  type MacroMarketSnapshotReading
} from '../../../../contracts/macro/macroMarketSnapshotContracts'

/**
 * The rows of the 市场状态 block, in reading order: what moves the market first, then the assets
 * being moved.
 *
 * 两行宏观驱动：美元与黄金各有自己的序列（`dxy-synthetic`、`xau-usd`），所以一行 `connected`
 * 当且仅当它那份快照带着读数；没存下来的序列让这一行停在 `planned`，绝不显示一个没有出处的水平值。
 *
 * 美债 10Y 与实际利率那两行**不在这里**（2026-11-22 用户定）：它们有专门的「国债收益率 · 日频」卡，
 * 曲线、四档变化与两条价差都在那张卡里；同一屏再留一份就是两种说法。别再往这张表加回来。
 *
 * `planned` rows exist so the block is honest about its own coverage: the reader sees which inputs
 * the dashboard still lacks, in the place where they will appear. A planned row must never render a
 * number — a fabricated dollar level would be worse than an empty slot — so the panel prints
 * `notConnected` and nothing else. That rule is pinned by test.
 */
export type CrossAssetStatusRow =
  | Readonly<{ id: CrossAssetId; state: 'connected' }>
  /**
   * `loading` 与 `planned` 是两件事：前者是「那一路还没结算」，后者是「读完了、确实没有接入」。
   * 把没结算画成「未接入」就是先给结论再改结论（用户 11-02 报过的同一类毛病）。
   */
  | Readonly<{ id: MacroDriverRowId; state: 'connected' | 'planned' | 'loading' }>

export type MacroDriverRowId = 'dxy' | 'gold'

export type CrossAssetStatusId = CrossAssetStatusRow['id']

/**
 * Which macro series may feed which macro row, best candidate first. Nothing else may fill the dollar
 * or gold row: the dollar's first candidate is the provider's own ICE index and its second is this
 * product's synthesis, so a licensed level is never shown beside a computed one.
 */
export const crossAssetMacroSeriesIds: Readonly<Record<MacroDriverRowId, readonly string[]>> = Object.freeze({
  dxy: macroMarketSnapshotPublicPolicy.dollarIndexPreference,
  gold: Object.freeze([macroMarketSnapshotPublicPolicy.series.gold])
})

/** The rows that carry no reading at all until their own snapshot answers. */
export type CrossAssetPlannedId = MacroDriverRowId

/** The candidate series for a macro row. */
export function crossAssetMacroSeriesFor(id: CrossAssetPlannedId): readonly string[] {
  return crossAssetMacroSeriesIds[id]
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
  id: MacroDriverRowId
): MacroMarketSnapshotReading | undefined {
  let chosen: MacroMarketSnapshotReading | undefined
  for (const seriesId of crossAssetMacroSeriesFor(id)) {
    const reading = readings.find(candidate => candidate.seriesId === seriesId)
    if (!reading) continue
    if (!chosen || reading.atMs > chosen.atMs) chosen = reading
  }
  return chosen
}

const crossAssetNoDataRows = [
  Object.freeze({ id: 'dxy' as const, state: 'planned' as const }),
  Object.freeze({ id: 'gold' as const, state: 'planned' as const }),
  // Connected: the index row, answered by the licensed Nasdaq 100 index and, only when that source
  // has nothing, by the labelled Binance proxy.
  Object.freeze({ id: 'index' as const, state: 'connected' as const }),
  Object.freeze({ id: 'btc' as const, state: 'connected' as const }),
  Object.freeze({ id: 'eth' as const, state: 'connected' as const })
]

/** The no-data reading order; `resolveCrossAssetStatusRows` promotes the funded rows. */
export const crossAssetStatusRows: readonly CrossAssetStatusRow[] = Object.freeze(crossAssetNoDataRows)

/** Which of the reads behind the macro rows is still in flight. */
export type CrossAssetStatusPending = Readonly<{ macro: boolean }>

/**
 * The rows for one macro snapshot. A macro row is connected only when its own series has a reading;
 * an empty or unavailable snapshot reproduces the no-data list exactly.
 */
export function resolveCrossAssetStatusRows(
  readings: readonly MacroMarketSnapshotReading[],
  pending?: CrossAssetStatusPending
): readonly CrossAssetStatusRow[] {
  const available = new Set(readings.map(reading => reading.seriesId))
  return Object.freeze(crossAssetStatusRows.map(row => {
    if (!isPlannedMacroRow(row.id)) return row
    // 拿到了就是 connected：加载态不许盖掉已经到的读数。
    if (hasReading(row.id, available)) return Object.freeze({ id: row.id, state: 'connected' as const })
    // 没拿到、但那一路还在读 → 加载态；读完了仍然没有 → 原来的「未接入」。
    return pending?.macro === true ? Object.freeze({ id: row.id, state: 'loading' as const }) : row
  }))
}

/** The rows whose data is not connected yet, in the no-data state of the registry. */
export const plannedCrossAssetStatusIds: readonly CrossAssetPlannedId[] = Object.freeze(
  crossAssetNoDataRows.filter((row) => row.state === 'planned').map((row) => row.id)
)

function hasReading(id: MacroDriverRowId, available: ReadonlySet<string>): boolean {
  return crossAssetMacroSeriesIds[id].some(seriesId => available.has(seriesId))
}

function isPlannedMacroRow(id: CrossAssetStatusId): id is MacroDriverRowId {
  return id === 'dxy' || id === 'gold'
}
