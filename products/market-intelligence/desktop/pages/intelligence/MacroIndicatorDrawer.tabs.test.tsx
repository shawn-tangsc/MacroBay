// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { productText } from '../../shared/i18n/productText'
import type { MarketCalendarEvent } from '../../../contracts/macro/marketCalendarQueryContracts'

/**
 * 两个来源的 tab：**挂在抽屉的真实 DOM 里**断，不在列表组件的独立渲染里断。
 *
 * 这条判据是补一次教训：`72d40dd` 加国家列时，`.mk-col-r` 里一条 11-13 的 `display: none`
 * 把整格藏了，而所有断言都跑在不带 `.mk-col-r` 的独立渲染里、全绿——「能编译、单测绿、
 * 一打开就没有」。所以这里渲染的是 `MacroIndicatorDrawer` 本身。
 *
 * 未映射那条读口用 `vi.mock` 给出，三档各一例：有数据 / 确实为空 / 读不到。
 */
const unmappedView = vi.hoisted(() => ({ current: { state: 'unavailable' } as unknown as Record<string, unknown> }))
vi.mock('../../shared/ipc/marketCalendarClient', () => ({
  marketCalendarClient: {
    queryUnmappedMonth: async () => unmappedView.current
  },
  // 其它导出保持原样（类型擦除后不需要实现）。
  unmappedMonthViewOf: () => unmappedView.current
}))

const { MacroIndicatorDrawer } = await import('./MacroIndicatorDrawer')
const drawerText = (await import('./macroIndicatorDrawerText')).macroIndicatorDrawerText['zh-CN']
const policyText = productText['zh-CN'].pages.intelligence.portal.dashboard.policyPath

let root: Root | undefined
let host: HTMLDivElement | undefined
const originalRect = Element.prototype.getBoundingClientRect

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 490 })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 192 })
  Element.prototype.getBoundingClientRect = () => ({
    x: 0, y: 0, top: 0, left: 0, right: 490, bottom: 192, width: 490, height: 192, toJSON: () => ({})
  }) as DOMRect
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
  document.body.innerHTML = ''
  for (const key of ['clientWidth', 'clientHeight']) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key]
  Element.prototype.getBoundingClientRect = originalRect
})

const event = (key: string, title: string): MarketCalendarEvent => ({
  eventKey: key, title, countryCode: 'US', countryName: '美国', eventType: 'economic-indicator',
  importance: 'high', scheduledAt: '2026-11-12T06:00:00.000Z', consensus: null, providerPrevious: null,
  providerActual: null, source: '0xRouter', sourceObservedAt: '2026-11-12T05:00:00.000Z',
  coverage: 'observed-unverified'
} as MarketCalendarEvent)

const unmapped = (key: string, title: string) => ({
  key: `0xrouter:${key}`, providerId: '0xrouter', sourceKey: key, reason: 'missing-country',
  scheduledDate: '2026-11-12', timePrecision: 'date', title, eventType: 'unknown',
  detectedAt: '2026-11-12T00:00:00.000Z'
})

async function mount(): Promise<HTMLElement> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(<ShellLanguageProvider language="zh-CN"><ShellTimeZoneProvider timeZone="Asia/Shanghai">
      <MacroIndicatorDrawer locale="zh-CN" now="2026-11-12T04:00:00.000Z" onClose={() => undefined}
        onRetryPolicy={() => undefined} policyText={policyText}
        readMarketEvents={async () => [event('a', 'CPI 年率'), event('b', '零售销售')]} />
    </ShellTimeZoneProvider></ShellLanguageProvider>)
  })
  // 抽屉是 portal 到 body 的（平台 Drawer 的行为）：查 host 会什么也查不到。
  return document.body
}

describe('the day list splits its two sources into tabs, inside the real drawer', () => {
  it('mounts with two tabs, counts on both, standard selected by default', async () => {
    unmappedView.current = { state: 'available', items: [unmapped('x', '未映射的 X'), unmapped('y', '未映射的 Y')], undated: 0, superseded: 0 }
    const view = await mount()
    const tabs = [...view.querySelectorAll('[role="tab"]')]
    expect(tabs).toHaveLength(2)
    // 计数各算各的：标准表这一天 2 条，未映射 2 条。
    expect(tabs.map((tab) => tab.textContent)).toEqual([drawerText.mkDay.tabStandard.replace('{count}', '2'), drawerText.mkDay.tabUnmapped.replace('{count}', '2')])
    // 默认选中「标准表」。
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true')
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('false')
  })

  it('shows the country in the drawer column, not only in an isolated render', async () => {
    unmappedView.current = { state: 'available', items: [], undated: 0, superseded: 0 }
    const view = await mount()
    // 这一格就是被 `.mk-col-r` 藏过的那一格：它在抽屉 DOM 里且在右列之内，文本是「美国」。
    const cells = [...view.querySelectorAll('.mk-col-r [data-event-country]')]
    expect(cells.length).toBeGreaterThan(0)
    expect(cells[0]?.textContent).toBe('美国')
  })

  it('says "could not be read" without a number, and never "0"', async () => {
    unmappedView.current = { state: 'unavailable' }
    const view = await mount()
    const tabs = [...view.querySelectorAll('[role="tab"]')]
    // 读不到：tab 上**不带数字**（数量未知写 0 就是把「读不到」画成「没有」）。
    expect(tabs[1]!.textContent).toBe(drawerText.mkDay.tabUnmappedUnknown)
    await act(async () => { (tabs[1] as HTMLElement).click() })
    const panel = view.querySelector('[data-unmapped-unavailable]')
    expect(panel?.textContent).toContain(drawerText.mkDay.unmappedUnavailable)
    // 原因句收进 ⓘ：正文只剩状态词，按钮在同一块里（正文说明句门禁）。
    expect(panel?.textContent).not.toContain(drawerText.mkDay.unmappedUnavailableNote)
    expect(panel?.querySelector('button[aria-label="查看说明"]')).not.toBeNull()
  })

  it('says the day has none when the answer really is zero', async () => {
    unmappedView.current = { state: 'available', items: [], undated: 0, superseded: 0 }
    const view = await mount()
    const tabs = [...view.querySelectorAll('[role="tab"]')]
    // 确实为空：`(0)` 照显示（tab 是框架，不随数据变形）。
    expect(tabs[1]!.textContent).toBe(drawerText.mkDay.tabUnmapped.replace('{count}', '0'))
    await act(async () => { (tabs[1] as HTMLElement).click() })
    const panel = view.querySelector('[data-unmapped-empty]')
    expect(panel?.textContent).toContain(drawerText.mkDay.unmappedEmpty)
    // 两句不许串：这里说「没有」，不是「读不到」。
    expect(panel?.textContent).not.toContain(drawerText.mkDay.unmappedUnavailable)
  })
})
