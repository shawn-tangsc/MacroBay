// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { productText } from '../../shared/i18n/productText'
import { CryptoIntelligenceDashboard } from './CryptoIntelligenceDashboard'
import { dashboardCellId, QUOTES_STATUS_ROW_CELLS } from './dashboardCellEnabled'

const asOf = '2026-08-05T00:00:00.000Z'
const text = productText['zh-CN'].pages.intelligence.portal.dashboard
let root: Root | undefined

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  vi.useRealTimers()
  document.body.replaceChildren()
})

/** 一格都不关时的基线：跨资产那一路问一次快照（BTC/ETH 要它）。 */
function clients() {
  const crossAssetQuery = vi.fn(async () => ({ state: 'unavailable' as const, cause: 'query' as const }))
  const fearGreedQuery = vi.fn(async () => ({ state: 'empty' as const, asOf }))
  // 一条可判的配对（杠杆腿那一组）：关掉「价格腿」不影响它，正好用来看卡片是否还在。
  const divergenceQuery = vi.fn(async () => ({
    state: 'available' as const, asOf, escalated: false, withheld: [],
    rows: [{
      pairId: 'liquidity-leverage' as const, direction: 'bearish' as const,
      legs: [
        { id: 'stablecoin' as const, value: -1.2, unit: 'percent' as const, observedAt: '2026-08-04T22:00:00.000Z' },
        { id: 'open-interest' as const, value: 3.4, unit: 'percent' as const, observedAt: '2026-08-04T23:00:00.000Z' },
        { id: 'funding' as const, value: 0.01, unit: 'percent-per-8h' as const, observedAt: '2026-08-04T23:00:00.000Z' }
      ]
    }]
  }))
  return {
    crossAssetQuery,
    fearGreedQuery,
    divergenceQuery,
    crossAssetClient: {
      acquire: vi.fn(async () => ({ state: 'active' as const, leaseId: 'lease-1' })),
      renew: vi.fn(async () => ({ state: 'active' as const })),
      release: vi.fn(async () => undefined),
      refresh: vi.fn(async () => undefined),
      query: crossAssetQuery
    },
    fearGreedClient: { querySnapshot: fearGreedQuery },
    divergenceClient: { query: divergenceQuery }
  }
}

async function render(cellEnabledIo: { read: () => Promise<Record<string, boolean>> } | undefined) {
  vi.useFakeTimers()
  const built = clients()
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(
      createElement(ShellTimeZoneProvider, {
        timeZone: 'UTC',
        children: createElement(CryptoIntelligenceDashboard, {
          client: { queryMonth: async () => ({ state: 'available' as const, asOf, events: [] }) },
          fearGreedClient: built.fearGreedClient,
          fundingRateClient: { query: async () => ({ state: 'empty' as const, asOf }) },
          openInterestClient: { query: async () => ({ state: 'empty' as const, asOf, window: '7d' as const }) },
          crossAssetClient: built.crossAssetClient as never,
          divergenceClient: built.divergenceClient as never,
          now: () => new Date(asOf),
          onConfigureSources: () => undefined,
          onManageSource: () => undefined,
          onOpenCalendar: () => undefined,
          text,
          ...(cellEnabledIo === undefined ? {} : { cellEnabledIo })
        } as never)
      })
    )
  })
  // 两拍：一格读盘（启用表）+ 各 client 的首次异步答案。
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
  return { container: host, ...built }
}

describe('dashboard cells read only when the reader left them on', () => {
  it('keeps every 市场状态 row when the enable map is missing a key', async () => {
    const { container } = await render({ read: async () => ({}) })
    const rows = Array.from(container.querySelectorAll('[data-status-row]')).map((row) => row.getAttribute('data-status-row'))
    expect(rows).toContain('index')
    expect(rows).toContain('btc')
    expect(rows).toContain('eth')
  })

  it('drops the disabled 纳指 row, keeps BTC/ETH, and leaves the shared collection untouched', async () => {
    const ndxCell = QUOTES_STATUS_ROW_CELLS.index[0]!
    const on = await render(undefined)
    const off = await render({ read: async () => ({ [ndxCell]: false }) })

    // ① 纳指那一格不渲染，同源的 BTC/ETH 两格照旧。
    expect(off.container.querySelector('[data-status-row="index"]')).toBeNull()
    expect(off.container.querySelector('[data-status-row="btc"]')).not.toBeNull()
    expect(off.container.querySelector('[data-status-row="eth"]')).not.toBeNull()
    // ② 关掉一格不等于关掉源：跨资产那一路的调用次数与不关时相同（BTC/ETH 仍要它）。
    expect(off.crossAssetQuery).toHaveBeenCalledTimes(on.crossAssetQuery.mock.calls.length)
    expect(off.crossAssetQuery.mock.calls.length).toBeGreaterThan(0)
  })

  it('stops the cross-asset read entirely when every cell it feeds is off', async () => {
    const off = await render({
      read: async () => ({
        [QUOTES_STATUS_ROW_CELLS.index[0]!]: false,
        [QUOTES_STATUS_ROW_CELLS.btc[0]!]: false,
        [QUOTES_STATUS_ROW_CELLS.eth[0]!]: false
      })
    })
    expect(off.crossAssetQuery).not.toHaveBeenCalled()
    expect(off.container.querySelector('[data-status-row="index"]')).toBeNull()
  })

  it('does not read the fear-and-greed snapshot when its only cell is off', async () => {
    const off = await render({ read: async () => ({ [dashboardCellId('fear-greed', 'index')]: false }) })
    expect(off.fearGreedQuery).not.toHaveBeenCalled()
    expect(off.container.querySelector('[data-sentiment-gauge]')).toBeNull()
  })

  it('stops the 背离 read and drops the card only when every leg cell is off', async () => {
    const allOff = await render({
      read: async () => ({
        [dashboardCellId('divergence', 'capital-flows')]: false,
        [dashboardCellId('divergence', 'capital-flows-aggregate')]: false,
        [dashboardCellId('divergence', 'leverage')]: false,
        [dashboardCellId('divergence', 'price')]: false
      })
    })
    expect(allOff.divergenceQuery).not.toHaveBeenCalled()
    expect(allOff.container.querySelector('.mi-divergence')).toBeNull()
  })

  it('keeps reading the 背离 card while any leg it needs is still on', async () => {
    const partial = await render({ read: async () => ({ [dashboardCellId('divergence', 'price')]: false }) })
    // 价格腿关掉，稳定币腿那一组还判得出来：这一路照样读，卡也还在（用到价格腿的配对由面板滤掉）。
    expect(partial.divergenceQuery).toHaveBeenCalled()
    expect(partial.container.querySelector('.mi-divergence')).not.toBeNull()
  })

  it('reads everything when the enable map cannot be read (缺省 = 启用)', async () => {
    const { crossAssetQuery, fearGreedQuery, container } = await render({ read: async () => { throw new Error('unreadable') } })
    expect(crossAssetQuery).toHaveBeenCalled()
    expect(fearGreedQuery).toHaveBeenCalled()
    expect(container.querySelector('[data-status-row="index"]')).not.toBeNull()
  })
})
