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
export function quotesRowStates(input: Readonly<{
  /** 启用表/源状态表还没读完：这时一处都不下结论。 */
  decisionsUsable: boolean
  decide: (moduleId: string, cellKey: string) => CellReadDecision
}>): Readonly<Partial<Record<QuotesRowId, QuotesRowState>>> {
  if (!input.decisionsUsable) return {}
  const states: Partial<Record<QuotesRowId, QuotesRowState>> = {}
  for (const [row, cellKey] of Object.entries(QUOTES_ROW_CELL_KEYS) as Array<[QuotesRowId, string]>) {
    const decision = input.decide('quotes', cellKey)
    if (decision.kind === 'read') continue
    states[row] = decision.kind === 'source-unknown' ? 'unreadable' : 'disabled'
  }
  return states
}
