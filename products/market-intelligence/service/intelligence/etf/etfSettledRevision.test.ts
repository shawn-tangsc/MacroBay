import { describe, expect, it, vi } from 'vitest'

import { reportSettledEtfRevisions } from './etfSettledRevision'

const asOf = '2026-11-07T06:00:00.000Z'
const rows = (value: number, tradingDate = '2026-11-05') => [{ tradingDate, netFlowUsd: value, observedAt: `${tradingDate}T00:00:00.000Z` }]
const window = (btc: number, eth = -1) => ({ btc: rows(btc), eth: rows(eth) } as never)

describe('settled-day revisions', () => {
  // 判过之后又变：记一条，带前后值与计数——30 小时够不够，只能靠这个回答。
  it('counts a settled day whose value changed after we judged it', () => {
    const log = vi.fn()
    const revisions = reportSettledEtfRevisions({ previous: window(-14_000_000), current: window(-411_900_000), asOf, log })

    expect(revisions).toEqual([{ asset: 'btc', tradingDate: '2026-11-05', previousUsd: -14_000_000, currentUsd: -411_900_000 }])
    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      marker: 'MI_ETF_SETTLED_REVISION', asset: 'btc', tradingDate: '2026-11-05', previousUsd: -14_000_000, currentUsd: -411_900_000
    }))
    expect(Number(log.mock.calls[0]![0].count)).toBeGreaterThan(0)
  })

  // 还没定稿的那天本来就会变：那是补报本身，不是余量不够。
  it('stays silent while the day is still inside the settle window', () => {
    const log = vi.fn()
    const revisions = reportSettledEtfRevisions({
      previous: window(-14_000_000), current: window(-411_900_000),
      asOf: '2026-11-06T04:52:00.000Z', log
    })
    expect(revisions).toEqual([])
    expect(log).not.toHaveBeenCalled()
  })

  it('says nothing when the reading did not change, or there is nothing to compare against', () => {
    const log = vi.fn()
    expect(reportSettledEtfRevisions({ previous: window(-411_900_000), current: window(-411_900_000), asOf, log })).toEqual([])
    expect(reportSettledEtfRevisions({ previous: undefined, current: window(-411_900_000), asOf, log })).toEqual([])
    expect(log).not.toHaveBeenCalled()
  })
})
