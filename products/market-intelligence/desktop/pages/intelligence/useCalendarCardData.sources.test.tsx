// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

import { useCalendarCardData, type CalendarCardDataState } from './useCalendarCardData'

/**
 * 日历卡按**来源启停**过滤（2026-11-11 三态规范）。
 *
 * 判据三条：停掉一条来源 → 它的事件不再出现、其余仍在；全停 → 整卡落 `disabled`；
 * 把过滤改回「不过滤」必须红——所以夹具里两条事件来自不同来源，且都落在同一窗口。
 */
const asOf = '2026-10-14T12:00:00.000Z'
const at = '2026-10-14T01:30:00.000Z'
let root: ReturnType<typeof createRoot> | undefined
let latest: CalendarCardDataState | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  latest = undefined
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

function event(sourceId: string, eventKey: string, titleKey: string) {
  // 与 `useCalendarCardData.state.test.tsx` 同一份合法夹具（改 key 与来源），不另造一份会违反契约的形状。
  return {
    eventKey, releaseGroupKey: eventKey, eventFamily: 'consumer-price-index', titleKey,
    countryCode: 'US', importance: 'high', periodKey: '2026-M10', lifecycleState: 'released',
    coverage: 'available', scheduledDate: '2026-10-14', scheduledAt: at, releaseTimeSource: 'official', detectedAt: asOf,
    actual: { displayValue: '3.2%' }, previous: { displayValue: '3.1%' }, consensus: { displayValue: '3.0%' },
    consensusState: 'available', surprise: 'beat', providerIds: [sourceId], caveats: []
  }
}

function stubPlatform(enabled: Readonly<Record<string, boolean>> | 'unreadable'): void {
  const invoke = vi.fn(async (_product: string, method: string) => {
    if (method === 'intelligence.macro.economicCalendar.queryMonth') {
      return {
        state: 'available', asOf,
        events: [event('macro-calendar-bls', 'US.CPI.BLS', 'cpi'), event('macro-calendar-fed', 'US.CPI.FED', 'core-cpi')]
      }
    }
    if (method === 'intelligenceSources.getPanelView') {
      if (enabled === 'unreadable') throw new Error('config read failed')
      return { providers: [{ sources: Object.entries(enabled).map(([sourceId, on]) => ({ sourceId, enabled: on })) }] }
    }
    return { state: 'unavailable', failureCode: 'calendar-query-unavailable' }
  })
  vi.stubGlobal('platform', { products: { invoke } })
}

async function mount(enabled: Readonly<Record<string, boolean>> | 'unreadable'): Promise<void> {
  stubPlatform(enabled)
  function Probe(): null {
    latest = useCalendarCardData({ asOf, locale: 'zh' })
    return null
  }
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(<Probe />))
  for (let attempt = 0; attempt < 10; attempt += 1) await act(async () => { await Promise.resolve() })
}

it('drops the events of a disabled source and keeps the rest', async () => {
  await mount({ 'macro-calendar-bls': false, 'macro-calendar-fed': true })
  expect(latest?.state).toBe('ready')
  expect(latest?.sourcesState).toBe('available')
  const keys = [...latest!.projection.today, ...latest!.projection.upcoming].map(row => row.eventKey)
  expect(keys).toContain('US.CPI.FED')
  // 反向判据：把过滤改回「不过滤」，这条立刻红。
  expect(keys).not.toContain('US.CPI.BLS')
})

it('falls to the whole-card disabled state when no calendar source is enabled', async () => {
  await mount({ 'macro-calendar-bls': false, 'macro-calendar-fed': false })
  expect(latest?.sourcesState).toBe('disabled')
})

it('does not filter when the source configuration itself cannot be read', async () => {
  // 配置读不到不是「都关了」：宁可照画，也不把读者的卡片降级。
  await mount('unreadable')
  expect(latest?.sourcesState).toBe('available')
  const keys = [...latest!.projection.today, ...latest!.projection.upcoming].map(row => row.eventKey)
  expect(keys).toContain('US.CPI.BLS')
  expect(keys).toContain('US.CPI.FED')
})
