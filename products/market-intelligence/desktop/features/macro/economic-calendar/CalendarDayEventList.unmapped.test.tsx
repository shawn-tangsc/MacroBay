// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'

import { productText } from '../../../shared/i18n/productText'
import type { UnmappedCalendarObservation } from '../../../../service/intelligence/macro-calendar/rendering/marketCalendarUnmappedMonthRead'
import { CalendarDayEventList } from './CalendarDayEventList'

/**
 * 「未入标准表」那一栏：与标准表**分在两个 tab 里**（用户 2026-11-16）。
 *
 * 三条断在 DOM 上：① 2 条未映射 → 2 行带 `data-unmapped`；② 读不到 → 两句「读不到」，
 * **不出 0 条、也不出现「没有」那句**；③ 确实为空 → 「这一天没有…」+「标准表 N 条在另一个 tab」，
 * **两句互不串**。
 */
const text = productText['zh-CN'].pages.intelligence.portal.calendar
const copy: Record<string, string> = {
  tabStandard: '标准表 ({count})',
  tabUnmapped: '未入标准表 ({count})',
  tabsAria: '按来源切换当天事件'
}
const observation = (key: string, title: string, over: Partial<UnmappedCalendarObservation> = {}): UnmappedCalendarObservation => ({
  key: `0xrouter:${key}`,
  providerId: '0xrouter',
  sourceKey: key,
  reason: 'bad-identity',
  scheduledDate: '2026-11-05',
  scheduledAt: '2026-11-05T06:00:00.000Z',
  timePrecision: 'minute',
  title,
  countryCode: 'USA',
  eventType: 'unknown',
  detectedAt: '2026-11-05T00:00:00.000Z',
  ...over
})

const render = async (node: React.ReactElement) => {
  const host = document.createElement('div')
  const root = createRoot(host)
  await act(async () => root.render(node))
  return { host, done: async () => { await act(async () => root.unmount()) } }
}

const list = (unmapped: Readonly<Record<string, unknown>>, over: Readonly<Record<string, unknown>> = {}) => <CalendarDayEventList
  label="这一天的发布" title="11 月 5 日的事件" groups={[]} marketSources={[]} text={text}
  statusNow="2026-11-05T00:00:00.000Z" selectedEventKey={undefined} selectedMarketKey={undefined}
  sourceTabs={{
    value: 'unmapped', onChange: () => undefined, ariaLabelKey: 'tabsAria', resolveText: (key) => copy[key] ?? key,
    items: [
      { value: 'standard', labelKey: 'tabStandard', labelParams: { count: '0' } },
      { value: 'unmapped', labelKey: 'tabUnmapped', labelParams: { count: '2' } }
    ],
    unmapped: {
      observations: [], timeZone: 'UTC', aria: '未入标准表',
      emptyText: '这一天没有未入标准表的事件', emptyNote: '标准表 0 条照常在左边那个 tab 里。',
      unavailableText: '未入标准表：这次读不到', unavailableNote: '不是没有，是这次没读到。',
      unavailable: false, ...unmapped
    }
  }}
  {...over} />

it('draws one marked row per unmapped observation', async () => {
  const view = await render(list({
    observations: [observation('a', '未映射的 A'), observation('b', '未映射的 B', { countryCode: undefined })]
  }))
  try {
    const rows = view.host.querySelectorAll('[data-unmapped="true"]')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.textContent).toContain('未映射的 A')
    // 国家照常：原值 `USA` 不改名；没有国家码 → 「未知国家」。
    expect(rows[0]!.querySelector('[data-event-country]')?.textContent).toBe('USA')
    expect(rows[1]!.querySelector('[data-event-country]')?.textContent).toBe('未知国家')
    // 读屏补一句，视觉上不在行内重复（分 tab 之后行里不该再写「未入标准表」）。
    expect(rows[0]!.getAttribute('aria-label')).toContain('未入标准表')
    expect(rows[0]!.textContent).not.toContain('未入标准表')
  } finally { await view.done() }
})

it('says it could not be read instead of claiming zero', async () => {
  const view = await render(list({ unavailable: true }))
  try {
    const panel = view.host.querySelector('[data-unmapped-unavailable]')
    expect(panel?.textContent).toContain('未入标准表：这次读不到')
    expect(panel?.textContent).toContain('不是没有，是这次没读到。')
    // 读不到时**不出现**「这一天没有…」那句，也不出 0 条。
    expect(view.host.querySelector('[data-unmapped-empty]')).toBeNull()
    expect(view.host.querySelectorAll('[data-unmapped="true"]')).toHaveLength(0)
  } finally { await view.done() }
})

it('says the day has none only when the answer really is zero', async () => {
  const view = await render(list({}))
  try {
    const panel = view.host.querySelector('[data-unmapped-empty]')
    expect(panel?.textContent).toContain('这一天没有未入标准表的事件')
    // 空与读不到是两件事：这里不许出现「读不到」那句。
    expect(panel?.textContent).not.toContain('这次读不到')
    expect(view.host.querySelector('[data-unmapped-unavailable]')).toBeNull()
  } finally { await view.done() }
})
