// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MacroMarketViewState } from '../../features/industry/cross-asset/useMacroMarketSnapshot'
import type { MacroRatesViewState } from '../../features/industry/cross-asset/useMacroRatesSnapshot'
import { useCrossAssetObservation } from '../../features/industry/cross-asset/useCrossAssetObservation'
import { useMacroMarketSnapshot } from '../../features/industry/cross-asset/useMacroMarketSnapshot'
import { useMacroRatesSnapshot } from '../../features/industry/cross-asset/useMacroRatesSnapshot'
import { queryReadDeadlineMs } from '../../shared/ipc/queryDeadline'
import { useDashboardDivergence } from './useDashboardDivergence'
import { useDashboardEconomicCalendar } from './useDashboardEconomicCalendar'
import { useDashboardFearGreed } from './useDashboardFearGreed'
import { useDashboardFundingRateHistory } from './useDashboardFundingRateHistory'
import { useDashboardOpenInterest } from './useDashboardOpenInterest'
import { useCalendarCardData } from './useCalendarCardData'

/**
 * 每个读口一条：**桩永不返回**（模拟 IPC 挂起）时，过了同一 deadline 必须落终态，
 * 不许停在「加载中」。一次只驱动假时钟，零 sleep。
 *
 * 这是 `queryDeadline.ts` 清单的守卫：新增读口没接 deadline 时，把它加进这个文件就会红。
 */
const asOf = '2026-08-18T08:00:00.000Z'
const never = (): Promise<never> => new Promise<never>(() => undefined)
const hang = (): Promise<nevers> => never()
type nevers = never

let root: Root | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  vi.useRealTimers()
})

function mount(render: () => void): void {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(render)
}

/** 推进到 deadline 之后（含各 hook 自己的退避/轮询），让失败分支落地。 */
async function passDeadline(multiplier = 4): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(queryReadDeadlineMs * multiplier) })
}

describe('every read point gives up when its read never settles', () => {
  it('fear and greed', async () => {
    let state: { state: string } | undefined
    function Probe(): null { state = useDashboardFearGreed({ client: { querySnapshot: hang }, now: () => new Date(asOf) }).state; return null }
    vi.useFakeTimers()
    mount(() => root!.render(createElement(Probe)))
    await passDeadline()
    expect(state!.state).toBe('unavailable')
  })

  it('funding rate history', async () => {
    let state: { state: string } | undefined
    function Probe(): null { state = useDashboardFundingRateHistory({ client: { query: hang }, now: () => new Date(asOf) }); return null }
    vi.useFakeTimers()
    mount(() => root!.render(createElement(Probe)))
    await passDeadline()
    expect(state!.state).toBe('unavailable')
  })

  it('open interest', async () => {
    let state: { state: string } | undefined
    function Probe(): null { state = useDashboardOpenInterest({ client: { query: hang }, now: () => new Date(asOf), window: '7d' }); return null }
    vi.useFakeTimers()
    mount(() => root!.render(createElement(Probe)))
    await passDeadline()
    expect(state!.state).toBe('unavailable')
  })

  it('divergence', async () => {
    let state: { state?: string } | undefined
    function Probe(): null { state = useDashboardDivergence({ client: { query: hang }, now: () => new Date(asOf) }).state; return null }
    vi.useFakeTimers()
    mount(() => root!.render(createElement(Probe)))
    await passDeadline()
    expect(state!.state).toBe('unavailable')
  })

  it('economic calendar row', async () => {
    let state: { state: string } | undefined
    function Probe(): null { state = useDashboardEconomicCalendar({ client: { queryMonth: hang }, now: () => new Date(asOf) }); return null }
    vi.useFakeTimers()
    mount(() => root!.render(createElement(Probe)))
    await passDeadline()
    expect(state!.state).toBe('unavailable')
  })

  it('macro market snapshot', async () => {
    let state: MacroMarketViewState | undefined
    function Probe(): null { state = useMacroMarketSnapshot({ client: { query: hang } as never }).state; return null }
    vi.useFakeTimers()
    mount(() => root!.render(createElement(Probe)))
    await passDeadline(40)
    expect(state).toBe('unavailable')
  })

  it('macro rates snapshot', async () => {
    let state: MacroRatesViewState | undefined
    function Probe(): null { state = useMacroRatesSnapshot({ client: { query: hang } as never }).state; return null }
    vi.useFakeTimers()
    mount(() => root!.render(createElement(Probe)))
    // 这张卡的轮询间隔是 5 分钟：要跨过 3 轮「读挂 10 秒 + 轮询」才落终态。
    await passDeadline(2000)
    expect(state).toBe('unavailable')
  })

  it('calendar card (module-level clients)', async () => {
    // 这张卡的读口是模块级 client（走 platform.invoke）：用永不返回的桩模拟挂起。
    let state: string | undefined
    Object.defineProperty(window, 'platform', {
      configurable: true,
      value: { products: { invoke: () => new Promise(() => undefined) } }
    })
    try {
      function Probe(): null { state = useCalendarCardData({ asOf, locale: 'zh' }).state; return null }
      vi.useFakeTimers()
      mount(() => root!.render(createElement(Probe)))
      await passDeadline()
      expect(state).toBe('error')
    } finally {
      Reflect.deleteProperty(window, 'platform')
    }
  })

  it('cross-asset observation', async () => {
    let state: string | undefined
    const client = { acquire: async () => ({ state: 'active' as const, leaseId: 'lease' }), renew: async () => ({ state: 'active' as const }), release: async () => undefined, refresh: async () => ({ state: 'accepted' as const }), query: hang }
    function Probe(): null { state = useCrossAssetObservation({ client: client as never }).state; return null }
    vi.useFakeTimers()
    mount(() => root!.render(createElement(Probe)))
    await passDeadline(20)
    expect(state).toBe('error')
  })
})
