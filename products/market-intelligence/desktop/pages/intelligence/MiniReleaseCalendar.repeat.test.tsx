// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'

import type { MarketCalendarEvent } from '../../../contracts/macro/marketCalendarQueryContracts'
import { MiniReleaseCalendar } from './MiniReleaseCalendar'
import { macroIndicatorDrawerText } from './macroIndicatorDrawerText'

/**
 * 格子里也要看出发过几次：合并之后同一期可能来自多次发布（GDP 二读/三读），
 * 只在当日列表标、格子里不标，读者看图就会把二读当初值——这就是「一处有一处没有」。
 *
 * 格内用紧凑记号 `×2`；整句「本期 2 次」在当日列表那一行里（114px 的格子塞句子会挤掉名字）。
 */
const text = macroIndicatorDrawerText['zh-CN']
const event = (releaseCount?: number): MarketCalendarEvent => ({
  eventKey: 'US.CORE_CPI.NSA.YOY', title: '核心 CPI 年率', eventNameKey: 'US.CORE_CPI.NSA.YOY', countryCode: 'US', countryName: '美国',
  eventType: 'economic-indicator', importance: 'high', scheduledAt: '2026-11-25T13:30:00.000Z',
  consensus: null, providerPrevious: null, providerActual: null,
  source: '0xRouter', sourceObservedAt: '2026-11-24T00:00:00.000Z', coverage: 'observed-unverified',
  ...(releaseCount === undefined ? {} : { releaseCount })
} as MarketCalendarEvent)

const render = async (events: readonly MarketCalendarEvent[]) => {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<MiniReleaseCalendar text={text} month="2026-11" today="2026-11-16"
    events={events} timeZone="UTC" now="2026-11-16T00:00:00.000Z" state="ready" refreshing={false}
    onSelectDay={() => undefined} onMonthChange={() => undefined} onRefresh={() => undefined} />))
  return { host, done: async () => { await act(async () => root.unmount()); host.remove() } }
}

it('marks a cell whose period was released more than once', async () => {
  const view = await render([event(2)])
  try {
    expect(view.host.querySelector('[data-release-count]')?.textContent).toBe('×2')
  } finally { await view.done() }
})

it('leaves a once-released event unmarked', async () => {
  const view = await render([event(undefined)])
  try {
    expect(view.host.querySelector('[data-release-count]')).toBeNull()
  } finally { await view.done() }
})
