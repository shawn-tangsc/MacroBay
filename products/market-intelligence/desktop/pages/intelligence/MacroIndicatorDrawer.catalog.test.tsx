// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { productText } from '../../shared/i18n/productText'

/**
 * **「点一下，表真的出现」**——这条判据是为了补一次假绿：`540ad35` 那版用例全绿，
 * 而按钮根本打不开（弹框没挂进抽屉）。所以这里点的是抽屉头部那颗按钮，断的是弹框里的表。
 */
const events = vi.hoisted(() => ({
  queryEvents: async () => ({
    state: 'available' as const,
    total: 2,
    rows: [
      { key: 'US.CPI.NSA.YOY', countryCode: 'US', metricKey: 'US.CPI.NSA.YOY', zhShort: 'CPI 年率', enShort: 'CPI YoY', titleIsSourceLabel: false, period: '2026-M10', lastRelease: { date: '2026-11-12' } },
      { key: '["212058",70663]', countryCode: 'DE', metricKey: '["212058",70663]', sourceLabel: 'transmutation in seasonally adjusted unemployment', titleIsSourceLabel: true }
    ]
  })
}))
vi.mock('../../shared/ipc/marketCalendarClient', () => ({
  // 抽屉同时用着未映射月读：那个读口在这里给「读不到」，不影响这一条要验的东西。
  marketCalendarClient: { ...events, queryUnmappedMonth: async () => ({ state: 'unavailable' as const }) },
  eventIndexReadOf: (value: unknown) => value
}))

const { MacroIndicatorDrawer } = await import('./MacroIndicatorDrawer')

let root: Root | undefined
let host: HTMLDivElement | undefined

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 490 })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 192 })
  Element.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 490, bottom: 192, width: 490, height: 192, toJSON: () => ({}) }) as DOMRect
})
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined; host?.remove(); host = undefined; document.body.innerHTML = ''
})

it('opens the full event table from the calendar header button', async () => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(<ShellLanguageProvider language="zh-CN"><ShellTimeZoneProvider timeZone="Asia/Shanghai">
      <MacroIndicatorDrawer locale="zh-CN" now="2026-11-12T04:00:00.000Z" onClose={() => undefined}
        onRetryPolicy={() => undefined} policyText={productText['zh-CN'].pages.intelligence.portal.dashboard.policyPath}
        readCalendarMonth={async () => ({ events: [], sources: [] })} />
    </ShellTimeZoneProvider></ShellLanguageProvider>)
  })
  const trigger = document.body.querySelector('[aria-label="打开全部事件表"]')
  expect(trigger, '日历头部那颗按钮没渲染出来').not.toBeNull()
  await act(async () => { (trigger as HTMLElement).click() })
  // 点完之后：弹框标题 + 表里的两行（含那条只有源原文名的）。
  expect(document.body.textContent).toContain('全部事件')
  await act(async () => { await Promise.resolve() })
  const names = [...document.body.querySelectorAll('[data-catalog-name]')].map((element) => element.textContent ?? '')
  expect(names.length).toBeGreaterThan(0)
  expect(names.join('|')).toContain('CPI 年率')
})
