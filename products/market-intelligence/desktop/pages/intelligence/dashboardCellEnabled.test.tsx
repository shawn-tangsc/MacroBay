// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { productText } from '../../shared/i18n/productText'
import { CryptoIntelligenceDashboard } from './CryptoIntelligenceDashboard'
import { dashboardCellId, QUOTES_STATUS_ROW_CELLS, type CellEnabledIo } from './dashboardCellEnabled'
import { dashboardFeedStatusPublicPolicy } from '../../../contracts/macro/dashboardFeedStatusContracts'

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
  const macroQuery = vi.fn(async (_input?: { dollarSourceId?: string }) => ({ state: 'unavailable' as const }))
  return {
    crossAssetQuery,
    fearGreedQuery,
    macroQuery,
    crossAssetClient: {
      acquire: vi.fn(async () => ({ state: 'active' as const, leaseId: 'lease-1' })),
      renew: vi.fn(async () => ({ state: 'active' as const })),
      release: vi.fn(async () => undefined),
      refresh: vi.fn(async () => undefined),
      query: crossAssetQuery
    },
    fearGreedClient: { querySnapshot: fearGreedQuery },
    macroMarketClient: { query: macroQuery }
  }
}

async function render(cellEnabledIo: CellEnabledIo | undefined, extraProps: Record<string, unknown> = {}) {
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
          dashboardFeedStatusClient: {
            query: async () => ({
              state: 'available' as const,
              sources: dashboardFeedStatusPublicPolicy.sourceIds.map(sourceId => ({ sourceId, enabled: true, hasCredential: true }))
            })
          },
          macroMarketClient: built.macroMarketClient as never,
          now: () => new Date(asOf),
          onConfigureSources: () => undefined,
          onManageSource: () => undefined,
          onOpenCalendar: () => undefined,
          text,
          ...(cellEnabledIo === undefined ? {} : { cellEnabledIo }),
          ...extraProps
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

    // ① 纳指那一行改成「数据未被启用」的状态行（不是删行），同源的 BTC/ETH 两格照旧。
    const indexRow = off.container.querySelector('[data-status-row="index"]')!
    expect(indexRow.getAttribute('data-source-state')).toBe('disabled')
    expect(indexRow.textContent).toContain('数据未被启用')
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
    // 三条线都不可用：图不画，行留成状态行。
    expect(off.container.querySelector('[data-asset-line="index"]')).toBeNull()
    expect(off.container.querySelector('[data-status-row="index"]')?.getAttribute('data-source-state')).toBe('disabled')
  })

  it('does not read the fear-and-greed snapshot when its only cell is off', async () => {
    const off = await render({ read: async () => ({ [dashboardCellId('fear-greed', 'index')]: false }) })
    expect(off.fearGreedQuery).not.toHaveBeenCalled()
    expect(off.container.querySelector('[data-sentiment-gauge]')).toBeNull()
  })

  it('asks the dollar reading for the source the reader chose, and only that one', async () => {
    const chosen = await render({
      read: async () => ({}),
      readSelection: async () => ({ [dashboardCellId('quotes', 'usd')]: 'twelve-data-market' })
    })
    expect(chosen.macroQuery).toHaveBeenCalledWith({ dollarSourceId: 'twelve-data-market' })
    // 同一格不许同时读两个源：请求里只出现选中的那个，没有第二个源的字段。
    const payloads = chosen.macroQuery.mock.calls.map((call) => Object.keys(call[0] ?? {}))
    expect(payloads.every((keys) => keys.length <= 1)).toBe(true)
  })

  it('keeps reading the default primary source when no choice was made', async () => {
    const defaulted = await render({ read: async () => ({}) })
    expect(defaulted.macroQuery).toHaveBeenCalledWith({})
  })

  it('reads everything when the enable map cannot be read (缺省 = 启用)', async () => {
    const { crossAssetQuery, fearGreedQuery, container } = await render({ read: async () => { throw new Error('unreadable') } })
    expect(crossAssetQuery).toHaveBeenCalled()
    expect(fearGreedQuery).toHaveBeenCalled()
    expect(container.querySelector('[data-status-row="index"]')).not.toBeNull()
  })
})


describe('policy path keeps one placement in every state', () => {
  it('renders the disabled card inside the right-rail slot, not in the main column', async () => {
    const slot = document.createElement('div')
    slot.setAttribute('data-dashboard-policy-slot', '')
    document.body.append(slot)
    const { container } = await render(
      { read: async () => ({ [dashboardCellId('policy-path', 'probability')]: false }) },
      { policySlot: slot }
    )
    // 三支都进同一个落点：没启用这一支也在右栏（句子由 `PolicyPathUnavailable` 自己给）。
    expect(slot.textContent).toContain('来源没有启用')
    expect(container.textContent).not.toContain('来源没有启用')
    slot.remove()
  })
})
