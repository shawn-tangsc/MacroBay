import { describe, expect, it, vi } from 'vitest'

import { reportSettledEtfRevisions } from './etfSettledRevision'

// 11-05 的交易日窗口在 11-06T06:00Z 满 30 小时。
const settledReadAt = '2026-11-06T10:00:00.000Z'
const notYetSettledReadAt = '2026-11-06T00:00:00.000Z'
const asOf = '2026-11-07T06:00:00.000Z'
const rows = (value: number, tradingDate = '2026-11-05') => [{ tradingDate, netFlowUsd: value, observedAt: `${tradingDate}T00:00:00.000Z` }]
const window = (btc: number, eth = -1) => ({ btc: rows(btc), eth: rows(eth) } as never)

describe('settled-day revisions', () => {
  // 判据一：上次读到它时还没定稿（−14M 是补报中的中间值）——这次变大是补报完成，不记。
  it('does not count a revision whose previous read was still inside the window', () => {
    const log = vi.fn()
    const revisions = reportSettledEtfRevisions({
      previous: window(-14_000_000), previousAsOf: notYetSettledReadAt,
      current: window(-411_900_000), asOf, log
    })

    expect(revisions).toEqual([])
    expect(log).not.toHaveBeenCalled()
  })

  // 判据二：上次读到它时已经定稿，之后又变——这才是余量不足，记一条。
  it('counts a revision when both reads were already settled', () => {
    const log = vi.fn()
    const revisions = reportSettledEtfRevisions({
      previous: window(-411_900_000), previousAsOf: settledReadAt,
      current: window(-500_000_000), asOf, log
    })

    expect(revisions).toEqual([{ asset: 'btc', tradingDate: '2026-11-05', previousUsd: -411_900_000, currentUsd: -500_000_000 }])
    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      marker: 'MI_ETF_SETTLED_REVISION', asset: 'btc', tradingDate: '2026-11-05', previousUsd: -411_900_000, currentUsd: -500_000_000
    }))
    expect(Number(log.mock.calls[0]![0].count)).toBeGreaterThan(0)
  })

  it('stays silent when the current read is not settled yet, or nothing changed', () => {
    const log = vi.fn()
    expect(reportSettledEtfRevisions({
      previous: window(-411_900_000), previousAsOf: settledReadAt,
      current: window(-500_000_000), asOf: '2026-11-06T04:52:00.000Z', log
    })).toEqual([])
    expect(reportSettledEtfRevisions({
      previous: window(-411_900_000), previousAsOf: settledReadAt, current: window(-411_900_000), asOf, log
    })).toEqual([])
    expect(reportSettledEtfRevisions({ previous: undefined, previousAsOf: undefined, current: window(-411_900_000), asOf, log })).toEqual([])
    expect(log).not.toHaveBeenCalled()
  })
})
