import { cellOffLabel } from './dashboardCellOff'
import type { CellReadDecision } from './dashboardCellEnabled'

/** 市场状态表的行 → 这一行读的是哪一格（`quotes` 模块下）。顺序即行序。 */
export const QUOTES_ROW_CELL_KEYS = {
  index: 'ndx', btc: 'btc', eth: 'eth', dxy: 'usd', gold: 'gold', us10y: 'ust10y', realRate: 'ust10y'
} as const

export type QuotesRowId = keyof typeof QUOTES_ROW_CELL_KEYS
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
  for (const [row, cellKey] of Object.entries(QUOTES_ROW_CELL_KEYS) as Array<[QuotesRowId, string]>) {
    const decision = input.decide('quotes', cellKey)
    if (decision.kind === 'read') continue
    // 与资金面/情绪卡同一口径：源关了点名源，格关了点名格，读不到仍是「读不到」。
    const label = cellOffLabel({ decision, cellLabel: input.cellLabel(row), sourceName: input.sourceName })
    states[row] = { state: decision.kind === 'source-unknown' ? 'unreadable' : 'disabled', ...(label === undefined ? {} : { label }) }
  }
  return states
}
