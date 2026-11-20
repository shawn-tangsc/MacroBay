// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { CalendarEventRow } from '../../features/macro/economic-calendar/CalendarEventRow'
import type { CalendarDayItem } from '../../features/macro/economic-calendar/economicCalendarDayModel'
import { marketEventOf } from './useCalendarMonthReleases'
import { dayGroups } from './macroIndicatorDrawerModel'

/**
 * 从「路由读回来的那一页」到「行上的国家」，整条链一次走完。
 *
 * 为什么要这一条：之前所有国家判据都把 `readCalendarMonth` 或 `MarketCalendarEvent` **桩掉**了，
 * 于是链路中段（`marketEventOf` 的字段白名单、`dayGroups` 造行）掉一个字段也全绿——
 * 用户屏幕上一个国家都没有，用例却是 199 例通过。这一条从**页事件的形状**开始，不用桩。
 *
 * 三档一次断完：名字命中 / 只有原码 / 两者都没有。
 */
const text = productText['zh-CN'].pages.intelligence.portal.calendar
const calendarText = text

const pageEvent = (over: Readonly<Record<string, unknown>> = {}) => ({
  eventKey: 'evt-1', title: 'CPI 年率', countryCode: 'US', countryName: '美国',
  eventType: 'economic-indicator', importance: 'high',
  scheduledAt: '2026-11-12T06:00:00.000Z', sourceObservedAt: '2026-11-12T05:00:00.000Z',
  source: '0xRouter', coverage: 'observed-unverified', consensus: null, providerPrevious: null, providerActual: null,
  ...over
})

/** 页事件 → `marketEventOf` → `dayGroups`（抽屉真实的那一步）→ 第一行。 */
const firstRowOf = (event: Record<string, unknown>): CalendarDayItem => {
  const mapped = marketEventOf(event)
  expect(mapped, 'marketEventOf 把这一行丢了，后面的国家断言就没有意义').toHaveLength(1)
  const groups = dayGroups(mapped, '2026-11-12', 'Asia/Shanghai', '{name} · {index}/{total}',
    (count) => `其余 ${count}`, (tier, count) => `${tier} ${count}`)
  const item = groups.flatMap((group) => group.items)[0]
  expect(item, '这一天没有任何一行').toBeDefined()
  return item!
}

const render = async (item: CalendarDayItem) => {
  const host = document.createElement('div')
  const root = createRoot(host)
  await act(async () => root.render(<CalendarEventRow item={item} text={calendarText} statusNow="2026-11-12T07:00:00.000Z" onSelect={() => undefined} />))
  return { host, done: async () => { await act(async () => root.unmount()) } }
}

it('shows the mapped name when the read carried one', async () => {
  const view = await render(firstRowOf(pageEvent()))
  try {
    expect(view.host.querySelector('[data-event-country]')?.textContent).toBe('美国')
  } finally { await view.done() }
})

it('shows the raw code when only the code survived the read', async () => {
  // `USA` 是归一迁移之前的历史形状：名字查不到时**原样显示**，不许空掉。
  const view = await render(firstRowOf(pageEvent({ countryName: undefined, countryCode: 'USA' })))
  try {
    expect(view.host.querySelector('[data-event-country]')?.textContent).toBe('USA')
  } finally { await view.done() }
})

it('says the country is unknown rather than leaving the cell empty', async () => {
  const view = await render(firstRowOf(pageEvent({ countryName: undefined, countryCode: null })))
  try {
    expect(view.host.querySelector('[data-event-country]')?.textContent).toBe('未知国家')
  } finally { await view.done() }
})
