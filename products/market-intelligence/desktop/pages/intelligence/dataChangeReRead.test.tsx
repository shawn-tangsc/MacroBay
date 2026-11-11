// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { productText } from '../../shared/i18n/productText'
import { CryptoIntelligenceDashboard } from './CryptoIntelligenceDashboard'
import { dashboardFeedStatusPublicPolicy } from '../../../contracts/macro/dashboardFeedStatusContracts'

/**
 * 政策路径的读口在 hook 里直接 import（页面不注入），所以这里换掉那个模块，只留下可计数的 read。
 * 别的读口都由页面注入，直接给 spy。
 */
const { policyPathRead } = vi.hoisted(() => ({ policyPathRead: vi.fn() }))
vi.mock('../../shared/ipc/policyPathClient', () => ({ policyPathClient: { read: policyPathRead } }))

const asOf = '2026-08-05T00:00:00.000Z'
const text = productText['zh-CN'].pages.intelligence.portal.dashboard
let root: Root | undefined

/** 产品事件通道上的订阅者：页面自己一条（`dashboard`），日历月读口自己一条（`economic-calendar`）。 */
let delivered: Array<(data: unknown) => void> = []
let unsubscribed = 0

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  vi.useRealTimers()
  Reflect.deleteProperty(window, 'platform')
  delivered = []
  unsubscribed = 0
  policyPathRead.mockReset()
})

function installProductEventChannel(): void {
  Object.defineProperty(window, 'platform', {
    configurable: true,
    value: {
      products: {
        onEvent: (_productId: string, _event: string, listener: (data: unknown) => void) => {
          delivered.push(listener)
          return () => { delivered = delivered.filter(entry => entry !== listener); unsubscribed += 1 }
        }
      }
    }
  })
}

/** 一次采集写库：把事件灌给每一条订阅（真实宿主也是同一组订阅者）。 */
async function deliverDataChanged(payload: unknown): Promise<void> {
  await act(async () => { delivered.forEach(listener => listener(payload)) })
  await flush()
}

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

type Counts = {
  fearGreed: number
  fundingRate: number
  openInterest: number
  divergence: number
  capital: number
  policyPath: number
  calendar: number
}

async function render() {
  vi.useFakeTimers()
  installProductEventChannel()
  policyPathRead.mockResolvedValue({ state: 'unavailable', failureCode: 'query-failed' })

  const query = {
    fearGreed: vi.fn(async () => ({ state: 'empty' as const, asOf })),
    fundingRate: vi.fn(async () => ({ state: 'empty' as const, asOf })),
    openInterest: vi.fn(async () => ({ state: 'empty' as const, asOf, window: '7d' as const })),
    divergence: vi.fn(async () => ({ state: 'unavailable' as const, reason: 'query-failed' as const, missing: [] })),
    capital: vi.fn(async () => { throw new Error('no snapshot') }),
    calendar: vi.fn(async () => ({ state: 'available' as const, asOf, events: [] }))
  }
  const crossAssetQuery = vi.fn(async () => ({ state: 'unavailable' as const, cause: 'query' as const }))

  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(
      createElement(ShellTimeZoneProvider, {
        timeZone: 'UTC',
        children: createElement(CryptoIntelligenceDashboard, {
          client: { queryMonth: query.calendar },
          fearGreedClient: { querySnapshot: query.fearGreed },
          fundingRateClient: { query: query.fundingRate },
          openInterestClient: { query: query.openInterest },
          divergenceClient: { query: query.divergence },
          capitalConditionsClient: { querySnapshot: query.capital },
          crossAssetClient: {
            acquire: vi.fn(async () => ({ state: 'active' as const, leaseId: 'lease-1' })),
            renew: vi.fn(async () => ({ state: 'active' as const })),
            release: vi.fn(async () => undefined),
            refresh: vi.fn(async () => undefined),
            query: crossAssetQuery
          },
          macroMarketClient: { query: vi.fn(async () => ({ state: 'unavailable' as const })) },
          dashboardFeedStatusClient: {
            query: async () => ({
              state: 'available' as const,
              sources: dashboardFeedStatusPublicPolicy.sourceIds.map(sourceId => ({ sourceId, enabled: true, hasCredential: true }))
            })
          },
          cellEnabledIo: { read: async () => ({}), readSelection: async () => ({}) },
          now: () => new Date(asOf),
          onConfigureSources: () => undefined,
          onManageSource: () => undefined,
          onOpenCalendar: () => undefined,
          text
        } as never)
      })
    )
  })
  await flush()

  const counts = (): Counts => ({
    fearGreed: query.fearGreed.mock.calls.length,
    fundingRate: query.fundingRate.mock.calls.length,
    openInterest: query.openInterest.mock.calls.length,
    divergence: query.divergence.mock.calls.length,
    capital: query.capital.mock.calls.length,
    policyPath: policyPathRead.mock.calls.length,
    calendar: query.calendar.mock.calls.length
  })

  return { container: host, counts }
}

describe('看板按「采集写了库」重读自己的读口', () => {
  it('re-reads every dashboard read point once, without remounting the page', async () => {
    const { container, counts } = await render()
    const before = counts()
    // 六个读口都真的读过一轮（门禁放行后才会有这次读）。
    expect(before).toEqual({ fearGreed: 1, fundingRate: 1, openInterest: 1, divergence: 1, capital: 1, policyPath: 1, calendar: 1 })
    const cardBefore = container.querySelector('.mi-crypto-dashboard__sentiment')
    expect(cardBefore).not.toBeNull()

    await deliverDataChanged({ panels: ['dashboard'], sources: ['alternative-fear-greed', 'binance-futures'] })

    const after = counts()
    expect(after.fearGreed).toBe(before.fearGreed + 1)
    expect(after.fundingRate).toBe(before.fundingRate + 1)
    expect(after.openInterest).toBe(before.openInterest + 1)
    expect(after.divergence).toBe(before.divergence + 1)
    expect(after.capital).toBe(before.capital + 1)
    expect(after.policyPath).toBe(before.policyPath + 1)
    // 日历月不是 `dashboard` 面板：这一条不许把它一起带走。
    expect(after.calendar).toBe(before.calendar)
    // 重读不是重挂载：同一个 DOM 节点还在原处（换掉订阅那一行就会红）。
    expect(container.querySelector('.mi-crypto-dashboard__sentiment')).toBe(cardBefore)
  })

  it('ignores a calendar write for the dashboard read points, and re-reads the month for it', async () => {
    const { counts } = await render()
    const before = counts()

    await deliverDataChanged({ panels: ['economic-calendar'], sources: ['macro-calendar-0xrouter-economic-data'] })

    const after = counts()
    expect(after.fearGreed).toBe(before.fearGreed)
    expect(after.fundingRate).toBe(before.fundingRate)
    expect(after.openInterest).toBe(before.openInterest)
    expect(after.divergence).toBe(before.divergence)
    expect(after.capital).toBe(before.capital)
    expect(after.policyPath).toBe(before.policyPath)
    // 命中自己那个面板的那一处照常重读。
    expect(after.calendar).toBe(before.calendar + 1)
  })

  it('does not re-read when the payload carries sources but not this panel', async () => {
    const { counts } = await render()
    const before = counts()

    await deliverDataChanged({ panels: ['economic-calendar'], sources: ['fred-rates-liquidity', 'twelve-data-market'] })

    // `sources` 今晚不参与判断：归属只看 `panels`。`sources` 里点了看板的源也没用，`panels` 不带
    // `dashboard` 就一个看板读口都不动（日历那一处是它自己的面板命中，另算）。
    const after = counts()
    expect({
      fearGreed: after.fearGreed,
      fundingRate: after.fundingRate,
      openInterest: after.openInterest,
      divergence: after.divergence,
      capital: after.capital,
      policyPath: after.policyPath
    }).toEqual({
      fearGreed: before.fearGreed,
      fundingRate: before.fundingRate,
      openInterest: before.openInterest,
      divergence: before.divergence,
      capital: before.capital,
      policyPath: before.policyPath
    })
  })

  it('coalesces a repeated delivery into one round instead of two concurrent reads', async () => {
    const { counts } = await render()
    const before = counts()

    await deliverDataChanged({ panels: ['dashboard'], sources: ['fred-rates-liquidity'] })
    const once = counts()
    expect(once.openInterest).toBe(before.openInterest + 1)

    // 同一次投递发两遍：读口只重读一轮（两遍算同一个 revision），不发起两路并发。
    await act(async () => {
      delivered.forEach(listener => listener({ panels: ['dashboard'], sources: ['fred-rates-liquidity'] }))
      delivered.forEach(listener => listener({ panels: ['dashboard'], sources: ['fred-rates-liquidity'] }))
    })
    await flush()

    expect(counts().openInterest).toBe(once.openInterest + 1)
    expect(counts().fearGreed).toBe(once.fearGreed + 1)
  })

  it('leaves the last reading on screen while the re-read is in flight', async () => {
    vi.useFakeTimers()
    installProductEventChannel()
    policyPathRead.mockResolvedValue({ state: 'unavailable', failureCode: 'query-failed' })
    let resolveFunding: ((value: unknown) => void) | undefined
    let resolveFearGreed: ((value: unknown) => void) | undefined
    const funding = vi.fn()
      .mockResolvedValueOnce({ state: 'empty' as const, asOf })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFunding = resolve }))
    const query = {
      fearGreed: vi.fn()
        .mockResolvedValueOnce({ state: 'empty' as const, asOf })
        .mockImplementationOnce(() => new Promise((resolve) => { resolveFearGreed = resolve })),
      openInterest: vi.fn(async () => ({ state: 'empty' as const, asOf, window: '7d' as const })),
      divergence: vi.fn(async () => ({ state: 'unavailable' as const, reason: 'query-failed' as const, missing: [] })),
      capital: vi.fn(async () => { throw new Error('no snapshot') }),
      calendar: vi.fn(async () => ({ state: 'available' as const, asOf, events: [] }))
    }
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(
        createElement(ShellTimeZoneProvider, {
          timeZone: 'UTC',
          children: createElement(CryptoIntelligenceDashboard, {
            client: { queryMonth: query.calendar },
            fearGreedClient: { querySnapshot: query.fearGreed },
            fundingRateClient: { query: funding },
            openInterestClient: { query: query.openInterest },
            divergenceClient: { query: query.divergence },
            capitalConditionsClient: { querySnapshot: query.capital },
            dashboardFeedStatusClient: {
              query: async () => ({
                state: 'available' as const,
                sources: dashboardFeedStatusPublicPolicy.sourceIds.map(sourceId => ({ sourceId, enabled: true, hasCredential: true }))
              })
            },
            cellEnabledIo: { read: async () => ({}), readSelection: async () => ({}) },
            now: () => new Date(asOf),
            onConfigureSources: () => undefined,
            onManageSource: () => undefined,
            onOpenCalendar: () => undefined,
            text
          } as never)
        })
      )
    })
    await flush()

    await act(async () => { delivered.forEach(listener => listener({ panels: ['dashboard'], sources: ['binance-futures'] })) })
    // 重读在飞：行/卡不许退回「加载中」（这一条正是「不清空、不置 loading」的判据）。
    expect(funding).toHaveBeenCalledTimes(2)
    expect(query.fearGreed).toHaveBeenCalledTimes(2)
    expect(host.textContent).not.toContain(text.positioning.loading)
    expect(host.textContent).not.toContain(text.fearGreed.loading)

    await act(async () => {
      resolveFunding?.({ state: 'empty' as const, asOf })
      resolveFearGreed?.({ state: 'empty' as const, asOf })
    })
    await flush()
    expect(funding).toHaveBeenCalledTimes(2)
    expect(query.fearGreed).toHaveBeenCalledTimes(2)
  })

  it('stops subscribing once the page is gone', async () => {
    await render()
    expect(delivered.length).toBeGreaterThan(0)

    await act(async () => root?.unmount())
    root = undefined

    expect(delivered).toHaveLength(0)
    expect(unsubscribed).toBeGreaterThan(0)
  })
})
