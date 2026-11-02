// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

import { useCalendarCardData } from './useCalendarCardData'
import type { CalendarCardReaction } from './calendarCardReaction'

/**
 * 卡片取数的接线：日历两条路线 + 「±30 分」那一次跨资产读。
 *
 * 这一条测的是**胶水**：读回来的反应要贴到对应的行上，读失败不能让卡片少一行别的数据，也不该把
 * 「没读到」画成 0。反应本身的算法在 `calendarCardReaction.test.ts` 里单独测。
 */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const asOf = '2026-10-14T12:00:00.000Z'
const eventAt = '2026-10-14T01:30:00.000Z'
let root: ReturnType<typeof createRoot> | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

/**
 * 一条官方发布，字段照渲染层那条 IPC 的消毒器（`sanitizeEvent`）要求的形状写全：它按**精确字段集**
 * 验收，少了 `releaseTimeSource`/`consensusState`/`surprise` 之类就会被整条丢掉。
 */
const officialEvent = {
  eventKey: 'US.CPI.RELEASE.2026-M09', releaseGroupKey: 'US.CPI.RELEASE.2026-M09', eventFamily: 'consumer-price-index',
  titleKey: 'cpi', countryCode: 'US', importance: 'high', periodKey: '2026-M09', lifecycleState: 'released',
  coverage: 'available', scheduledDate: '2026-10-14', scheduledAt: eventAt, releaseTimeSource: 'official', detectedAt: asOf,
  actual: { displayValue: '3.2%' }, previous: { displayValue: '3.1%' }, consensus: { displayValue: '3.0%' },
  consensusState: 'available', surprise: 'beat', providerIds: ['macro-calendar-bls'], caveats: []
}

function stubPlatform(): void {
  const invoke = vi.fn(async (_product: string, method: string, payload: unknown) => {
    const month = (payload as { month?: string } | null)?.month
    if (method === 'intelligence.macro.economicCalendar.queryMonth' && month === '2026-10') {
      return { state: 'available', asOf, events: [officialEvent] }
    }
    // 别的月份与市场路线都读不到：只丢它们自己的行，官方的行与反应都照旧。
    return { state: 'unavailable', failureCode: 'calendar-query-unavailable' }
  })
  vi.stubGlobal('platform', { products: { invoke } })
}

async function readProjection(readReaction?: (instant: string) => Promise<CalendarCardReaction | undefined>) {
  stubPlatform()
  let latest: ReturnType<typeof useCalendarCardData> | undefined
  function Probe(): null {
    latest = useCalendarCardData({ asOf, locale: 'zh', ...(readReaction ? { readReaction } : {}) })
    return null
  }
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(<Probe />))
  for (let attempt = 0; attempt < 8; attempt += 1) await act(async () => { await Promise.resolve() })
  return latest!.projection
}

it('reads the window for the released row and shows it on that row', async () => {
  const readReaction = vi.fn(async () => ({ index: -0.12, btc: -0.18, eth: -0.21 }))
  const projection = await readProjection(readReaction)
  expect(projection.today).toHaveLength(1)
  expect(readReaction).toHaveBeenCalledWith(eventAt)
  expect(projection.today[0]?.reaction).toEqual({ index: -0.12, btc: -0.18, eth: -0.21 })
})

it('keeps the row (without a reaction) when the read says nothing', async () => {
  const projection = await readProjection(async () => undefined)
  // 少一次跨资产读不该让日历少一行：行还在，只是没有那一行反应。
  expect(projection.today).toHaveLength(1)
  expect(projection.today[0]).not.toHaveProperty('reaction')
  // 没有注入读取器时也一样（跨资产未接线）。
  const without = await readProjection()
  expect(without.today).toHaveLength(1)
  expect(without.today[0]).not.toHaveProperty('reaction')
})

it('still shows the row when the read throws', async () => {
  const projection = await readProjection(async () => { throw new Error('ipc down') })
  expect(projection.today).toHaveLength(1)
  expect(projection.today[0]).not.toHaveProperty('reaction')
})
