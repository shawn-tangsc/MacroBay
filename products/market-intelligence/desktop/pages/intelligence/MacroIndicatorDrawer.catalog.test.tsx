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
  queryCodeTable: async () => ({
    state: 'available' as const,
    rows: [
      { code: 'US.CPI.NSA.YOY', kind: 'metric' as const, countryCode: 'US', countryName: '美国',
        names: { zhFull: 'CPI 年率', zhShort: 'CPI', enFull: 'Consumer Price Index (YoY)', enShort: 'CPI' },
        tier: 1 as const, measure: 'YOY', seasonality: 'NSA', status: 'active' as const, reason: null,
        officialSource: { agency: 'BLS', url: 'https://www.bls.gov/x', pageKind: 'release' as const,
          verifiedAt: '2026-11-17', basis: '发布目录' }, sourceIdCount: 2, releaseRowCount: 12 },
      { code: 'US.X.NONE.LEVEL', kind: 'metric' as const, countryCode: 'US', countryName: '美国',
        names: { zhFull: '某指标', zhShort: '某', enFull: 'Something', enShort: 'S' },
        tier: null, measure: 'LEVEL', seasonality: 'NONE', status: 'pending' as const, reason: 'official-source-todo',
        officialSource: { pending: true as const, reason: 'official-source-todo' as const }, sourceIdCount: 0, releaseRowCount: 0 }
    ],
    counts: { total: 2, metric: 2, event: 0, withOfficialSource: 1, pendingOfficialSource: 1 }
  }),
  queryMappingRules: async () => ({
    state: 'available' as const,
    mapped: [
      { sourceIds: ['214790'], metricKey: 'US.CPI.NSA.YOY', periodRule: 'same-month', basis: 'BLS · 发布页', officialUrl: 'https://www.bls.gov/news.release/cpi.nr0.htm', names: { zh: 'CPI 年率', en: 'Consumer Price Index (CPI), YoY' }, tier: 1, rowCount: 12 },
      { sourceIds: [], metricKey: 'US.MICHIGAN.NONE.LEVEL', periodRule: null, basis: null, officialUrl: null, names: { zh: '密歇根现况', en: 'Michigan Current Conditions' }, tier: null, rowCount: 0 }
    ],
    unmapped: [{ sourceId: '10113', rowCount: 8, sampleLabel: '密歇根现况' }],
    counts: { mapped: 85, unmapped: 249, unmappedRows: 833, eventIdentities: 99 }
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
  const trigger = document.body.querySelector('[aria-label="打开映射规则表"]')
  expect(trigger, '日历头部那颗按钮没渲染出来').not.toBeNull()
  await act(async () => { (trigger as HTMLElement).click() })
  // 点完之后：弹框标题 + 表里的两行（含那条只有源原文名的）。
  expect(document.body.textContent).toContain('映射规则')
  await act(async () => { await Promise.resolve() })
  // 第一页是**码表**（一个码一行），第二页是未映射；「已映射」整块已经删掉。
  expect(document.body.querySelector('[data-mapping-section="codes"]')?.textContent).toContain('US.CPI.NSA.YOY')
  expect(document.body.querySelector('[data-mapping-section="unmapped"]')?.textContent).toContain('10113')
  const tabs = [...document.body.querySelectorAll('[role="tab"]')]
    .map((tab) => tab.textContent ?? '')
    .filter((label) => label.includes('码表') || (label.includes('未映射') && !label.includes('未入')))
  expect(tabs).toHaveLength(2)
  expect(tabs[0]).toContain('2')
  expect(tabs[1]).toContain('249')
  // 官网页三态：有页是 `查看` 真链接；待补是纯文字，没有 href。
  const links = [...document.body.querySelectorAll('[data-official]')]
  expect(links).toHaveLength(1)
  expect(links[0]!.textContent).toBe('查看')
  expect(links[0]!.getAttribute('href')).toBe('https://www.bls.gov/x')
  expect(document.body.querySelector('[data-official-pending]')?.textContent).toBe('待核')
  expect(document.body.querySelector('[data-official-pending]')?.getAttribute('href')).toBeNull()
  // 名称格：中文名 + 小字灰字英文名（同一格）。
  expect(document.body.textContent).toContain('CPI 年率')
  expect(document.body.querySelector('.mi-name__en')?.textContent).toBe('Consumer Price Index (YoY)')
  // 源 id 数 0 显示 0（不是空）。
  const cells = [...document.body.querySelectorAll('[data-mapping-section="codes"] tbody tr.ant-table-row')]
  expect(cells).toHaveLength(2)
  // 国家列插在名称前（第 2 列）；**源 id 数是第 8 列、数据量是第 9 列**（分级/口径拆开之后整体后移一位）。
  expect(cells[0]!.querySelectorAll('td')[1]?.textContent).toContain('美国')
  expect(cells[1]!.querySelectorAll('td')[7]?.textContent).toBe('0')
  expect(cells[1]!.querySelectorAll('td')[8]?.textContent).toBe('0')
})
