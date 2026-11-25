import { cellOffLabel } from './dashboardCellOff'
import { QUOTES_STATUS_ROW_CELLS, cellKeyOfId, type CellReadDecision } from './dashboardCellEnabled'

/**
 * 市场状态表的行 → 这一行读的**那几格**（`quotes` 模块下）。顺序即行序。
 *
 * 一行可能是两个格：美元与黄金各有主源与备用源（`usd` + `usd-fallback`、`gold` + `gold-fallback`），
 * **任一格能读，这一行就是数据行**。只按主格判的话，读者关了主格、开着备用格时，行会被整行遮成
 * 「没启用」——合成美元采到了也不显示（真机 2026-11-25）。所以行→格只认 `dashboardCellEnabled`
 * 那一份表，这里不另立一份。
 *
 * 美债 10Y 与实际利率那两格（`ust10y`）不在这里：它们已经由「国债收益率 · 日频」卡负责
 * （用户 2026-11-22 定），这一屏同一条数据不留两份行状态。
 */
export type QuotesRowId = keyof typeof QUOTES_STATUS_ROW_CELLS
/** 行级的两句状态词：读不到、还是没启用。 */
export type QuotesRowState = 'unreadable' | 'disabled'

/**
 * 每一行要不要画状态行（画了就不是数据行）。判定来自 `decideCellRead` 的 kind——
 * 压成布尔就分不出「源没启用」与「源状态读不到」，这一行只能笼统说「不可用」。
 */
/** 面板要的两份表：状态词（行 → 三态）与要点名时的那句话素材（行 → 源名/格名）。 */
export function quoteRowPresentation(input: Readonly<{
  decisionsUsable: boolean
  decide: (moduleId: string, cellKey: string) => CellReadDecision
  cellLabel: (row: QuotesRowId) => string | undefined
  sourceName: (sourceId: string) => string
}>): Readonly<{
  rowStates: Readonly<Partial<Record<QuotesRowId, QuotesRowState>>>
  rowStateLabels: Readonly<Partial<Record<QuotesRowId, string>>>
}> {
  const rows = quotesRowStates(input)
  return {
    rowStates: Object.fromEntries(Object.entries(rows).map(([row, entry]) => [row, entry.state])),
    rowStateLabels: Object.fromEntries(Object.entries(rows).flatMap(([row, entry]) => entry.label === undefined ? [] : [[row, entry.label]]))
  }
}

export function quotesRowStates(input: Readonly<{
  /** 启用表/源状态表还没读完：这时一处都不下结论。 */
  decisionsUsable: boolean
  decide: (moduleId: string, cellKey: string) => CellReadDecision
  /** 这一行的格名（`not-enabled` 时报它）。 */
  cellLabel: (row: QuotesRowId) => string | undefined
  /** 源显示名（`source-disabled` 时报它）。 */
  sourceName: (sourceId: string) => string
}>): Readonly<Partial<Record<QuotesRowId, Readonly<{ state: QuotesRowState; label?: string }>>>> {
  if (!input.decisionsUsable) return {}
  const states: Partial<Record<QuotesRowId, { state: QuotesRowState; label?: string }>> = {}
  for (const [row, cellKeys] of Object.entries(QUOTES_STATUS_ROW_CELLS) as Array<[QuotesRowId, readonly string[]]>) {
    const decisions = cellKeys.map((cellId) => input.decide('quotes', cellKeyOfId(cellId)))
    // 任一格能读 → 这一行照常画数据（备用格替主格读数时是最常见的一种）。
    if (decisions.some((decision) => decision.kind === 'read')) continue
    // 与资金面/情绪卡同一口径：源关了点名源，格关了点名格，读不到仍是「读不到」。
    // 一行两格时先报更确定的那个原因：读不到 > 源关了 > 两格都关。
    const decision = decisions.find((entry) => entry.kind === 'source-unknown')
      ?? decisions.find((entry) => entry.kind === 'source-disabled')
      ?? decisions[0]!
    const label = cellOffLabel({ decision, cellLabel: input.cellLabel(row), sourceName: input.sourceName })
    states[row] = { state: decision.kind === 'source-unknown' ? 'unreadable' : 'disabled', ...(label === undefined ? {} : { label }) }
  }
  return states
}

/** 这一行点名时用哪一格（主格）：`not-enabled` 报的是它的格名。 */
export const quotesRowLabelCell = (row: QuotesRowId): string => cellKeyOfId(QUOTES_STATUS_ROW_CELLS[row][0]!)

/** 第一个「没启用」的行的主格：标题那颗「补数据」按钮打开的就是它。 */
export function firstDisabledQuotesCellKey(
  rowStates: Readonly<Partial<Record<QuotesRowId, QuotesRowState>>>
): string | undefined {
  const row = (Object.keys(QUOTES_STATUS_ROW_CELLS) as QuotesRowId[]).find((candidate) => rowStates[candidate] === 'disabled')
  return row === undefined ? undefined : quotesRowLabelCell(row)
}
