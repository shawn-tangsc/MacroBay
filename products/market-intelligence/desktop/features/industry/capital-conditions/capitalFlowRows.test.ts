import { describe, expect, it } from 'vitest'

import { selectVisibleFlowRows, type FlowChartRow } from './capitalFlowRows'

const rows: FlowChartRow[] = Array.from({ length: 30 }, (_, index) => ({
  tradingDate: `2026-08-${String(index + 1).padStart(2, '0')}`,
  funds: index,
  btc: index,
  eth: index
}))

describe('selectVisibleFlowRows', () => {
  it('keeps the last window, in order', () => {
    const visible = selectVisibleFlowRows(rows, 7)
    expect(visible).toHaveLength(7)
    expect(visible[0]?.tradingDate).toBe('2026-08-24')
    expect(visible.at(-1)?.tradingDate).toBe('2026-08-30')
  })

  it('returns the very same array when there is nothing to cut', () => {
    const three = rows.slice(0, 3)
    expect(selectVisibleFlowRows(three, 7)).toBe(three)
  })

  it('handles an empty window and a zero-sized one', () => {
    expect(selectVisibleFlowRows([], 7)).toHaveLength(0)
    expect(selectVisibleFlowRows(rows, 0)).toHaveLength(0)
  })
})
