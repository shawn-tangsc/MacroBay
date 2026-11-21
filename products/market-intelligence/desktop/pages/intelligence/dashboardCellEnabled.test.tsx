// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { productText } from '../../shared/i18n/productText'
import { CryptoIntelligenceDashboard } from './CryptoIntelligenceDashboard'
import { dashboardCellId, QUOTES_STATUS_ROW_CELLS, useDashboardCellEnabled, type CellEnabledIo } from './dashboardCellEnabled'
import { notifySettingsRevision } from '../../shared/events/settingsRevision'
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
  // 恐惧贪婪搬到「恐惧与防跌溢价」卡之后，看板只从这一条复合查询读两半。
  const sentimentOptionsQuery = vi.fn(async (input: { asOf: string; timeZone: string }) => ({
    asOf: input.asOf, windowDays: 30 as const, timeZone: input.timeZone,
    fearGreed: { state: 'empty' as const }, optionSkew: { state: 'not-connected' as const }
  }))
  const macroQuery = vi.fn(async (_input?: { dollarSourceId?: string }) => ({ state: 'unavailable' as const }))
  return {
    crossAssetQuery,
    sentimentOptionsQuery,
    macroQuery,
    crossAssetClient: {
      acquire: vi.fn(async () => ({ state: 'active' as const, leaseId: 'lease-1' })),
      renew: vi.fn(async () => ({ state: 'active' as const })),
      release: vi.fn(async () => undefined),
      refresh: vi.fn(async () => undefined),
      query: crossAssetQuery
    },
    sentimentOptionsClient: { query: sentimentOptionsQuery },
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
          sentimentOptionsClient: built.sentimentOptionsClient,
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
    // 行级也点名了（2026-11-12）：格关了报格名（纳指），不再是笼统的「数据未被启用」。
    expect(indexRow.textContent).toContain('纳指')
    expect(indexRow.textContent).not.toContain('数据未被启用')
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

  it('keeps the card read when the fear-and-greed cell is off, and shows the disabled row', async () => {
    const off = await render({ read: async () => ({ [dashboardCellId('fear-greed', 'index')]: false }) })
    // 这一条查询同时喂两半：关掉恐惧贪婪那一格不等于关掉偏斜那半，所以请求照发；
    // 被关掉的是左半的读数，由下面那行「没启用」说出来，不是不发请求。
    expect(off.sentimentOptionsQuery).toHaveBeenCalled()
    // 卡仍在（用户 2026-11-11：不能因为没启用就不渲染），读数区被遮罩盖住。
    const card = off.container.querySelector('.mi-crypto-dashboard__sentiment')
    expect(card).not.toBeNull()
    // 关掉的格不再盖遮罩（界面设计 2026-11-11）：图照画，图下方那一行说「没启用」。
    expect(card!.querySelector('.mi-source-veil')).toBeNull()
    expect(card!.querySelector('[data-sentiment-state]')?.getAttribute('data-sentiment-state')).toBe('disabled')
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
    const { crossAssetQuery, sentimentOptionsQuery, container } = await render({ read: async () => { throw new Error('unreadable') } })
    expect(crossAssetQuery).toHaveBeenCalled()
    expect(sentimentOptionsQuery).toHaveBeenCalled()
    expect(container.querySelector('[data-status-row="index"]')).not.toBeNull()
  })
})


describe('policy path keeps one placement in every state', () => {
  /**
   * 2026-11-15 布局改了：政策那张卡不再存在，它的三支状态由**钟表卡的政策行**接住，
   * 钟表卡在左栏顶部那一排里；右栏顶部改放 AI 结论。能力（未启用要说清、要能去开）不变，
   * 由 `cryptoDashboard.test.tsx` 里那 5 条迁移用例继续盯着。
   */
  it('says the rate cell is off inside the clock card, and keeps the rail for the conclusion', async () => {
    const slot = document.createElement('div')
    slot.setAttribute('data-dashboard-policy-slot', '')
    document.body.append(slot)
    const { container } = await render(
      { read: async () => ({ [dashboardCellId('policy-path', 'probability')]: false }) },
      { policySlot: slot }
    )
    // 句子仍按**哪一格没启用**点名，但渲染在钟表卡里（左栏那一排），不再是旧政策卡。
    expect(container.querySelector('.mi-clock__policy-note')?.textContent).toContain('利率未启用')
    // 右栏顶部那格现在只装 AI 结论的挂点，不再装政策卡。
    expect(slot.querySelector('[data-dashboard-conclusion-slot]')).not.toBeNull()
    slot.remove()
  })
})


describe('格级启用表跟随同窗口的设置变更', () => {
  function renderHook(io: CellEnabledIo) {
    const seen: Array<ReturnType<typeof useDashboardCellEnabled>> = []
    function Probe(): null {
      seen.push(useDashboardCellEnabled({ io }))
      return null
    }
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => { root!.render(<Probe />) })
    return seen
  }

  it('re-reads after a sources revision from another surface', async () => {
    let cells: Record<string, boolean> = { [dashboardCellId('policy-path', 'probability')]: false }
    const reads: string[] = []
    const io: CellEnabledIo = {
      read: async () => { reads.push('read'); return cells },
      readSelection: async () => ({})
    }
    const seen = renderHook(io)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(seen.at(-1)!.cells[dashboardCellId('policy-path', 'probability')]).toBe(false)

    // 抽屉里打开那一格 → 发 sources 信号 → 看板这一层重读，不再停在旧的 false。
    cells = {}
    act(() => notifySettingsRevision('sources', 'config-drawer'))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(seen.at(-1)!.cells[dashboardCellId('policy-path', 'probability')]).toBeUndefined()
    expect(reads.length).toBeGreaterThanOrEqual(2)
  })

  it('never runs two reads at once (one round in flight, the rest coalesce into one more)', async () => {
    let inFlight = 0
    let maxInFlight = 0
    let started = 0
    let release: (() => void) | undefined
    const io: CellEnabledIo = {
      read: () => new Promise<Record<string, boolean>>((resolve) => {
        started += 1
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        release = () => { inFlight -= 1; resolve({}) }
      }),
      readSelection: async () => ({})
    }
    renderHook(io)
    await act(async () => { await Promise.resolve() })
    act(() => { notifySettingsRevision('sources', 'a'); notifySettingsRevision('sources', 'b') })
    expect(maxInFlight).toBe(1)
    await act(async () => { release?.(); await Promise.resolve(); await Promise.resolve() })
    expect(maxInFlight).toBe(1)
    // 两条信号排队后**补读了恰好一轮**（首读 1 + 补读 1）：只断言「没有并发」会被
    // 「根本不重读」蒙混过去——摘掉订阅那一次它照样绿，那就不叫判据。
    expect(started).toBe(2)
  })
})
