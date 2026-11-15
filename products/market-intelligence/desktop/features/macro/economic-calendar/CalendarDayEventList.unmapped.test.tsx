// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'

import { productText } from '../../../shared/i18n/productText'
import type { UnmappedCalendarObservation } from '../../../../service/intelligence/macro-calendar/rendering/marketCalendarUnmappedMonthRead'
import { CalendarDayEventList } from './CalendarDayEventList'

/**
 * 「未入标准表」那一组：与标准表行**长得像但语义不同**（用户 2026-11-16 拍板）。
 *
 * 三条断在 DOM 上：① 2 条未映射 → 2 行、都带 `data-unmapped="true"`；② 读不到 → 一句「读不到」，
 * **不出现「0 条」**；③ 没有未映射数据时整组不出现（而不是画一个空组）。
 */
const text = productText['zh-CN'].pages.intelligence.portal.calendar
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
  return {
    host,
    done: async () => { await act(async () => root.unmount()) }
  }
}

const list = (extra: Readonly<Record<string, unknown>>) => <CalendarDayEventList
  label="这一天的发布" title="11 月 5 日的事件" groups={[]} marketSources={[]} text={text}
  statusNow="2026-11-05T00:00:00.000Z" selectedEventKey={undefined} selectedMarketKey={undefined}
  {...extra} />

it('draws one marked row per unmapped observation', async () => {
  const view = await render(list({
    unmapped: {
      title: '未入标准表 · 2 条', aria: '未入标准表', timeZone: 'UTC',
      observations: [observation('a', '未映射的 A'), observation('b', '未映射的 B', { countryCode: undefined })]
    }
  }))
  try {
    const rows = view.host.querySelectorAll('[data-unmapped="true"]')
    expect(rows).toHaveLength(2)
    // 竖标是 CSS 画的（`::before`），DOM 只钉这两样：行带标记、组标题只说一次。
    expect(view.host.querySelector('[data-unmapped-group] h3')?.textContent).toBe('未入标准表 · 2 条')
    expect(rows[0]!.textContent).toContain('未映射的 A')
    // 国家原值照显示：`USA` 不改名；没有国家码 → 「未知国家」。
    expect(rows[0]!.querySelector('[data-event-country]')?.textContent).toBe('USA')
    expect(rows[1]!.querySelector('[data-event-country]')?.textContent).toBe('未知国家')
    // 读屏补一句，视觉上不在行内重复。
    expect(rows[0]!.getAttribute('aria-label')).toContain('未入标准表')
    expect(rows[0]!.textContent).not.toContain('未入标准表')
  } finally { await view.done() }
})

it('says it could not be read instead of claiming zero', async () => {
  const view = await render(list({ unmappedUnavailable: '未入标准表：这次读不到' }))
  try {
    expect(view.host.querySelector('[data-unmapped-unavailable]')?.textContent).toBe('未入标准表：这次读不到')
    // 读不到时**不出现**那个组，也不许写「0 条」。
    expect(view.host.querySelector('[data-unmapped-group]')).toBeNull()
    expect(view.host.textContent).not.toContain('· 0')
  } finally { await view.done() }
})

it('draws no unmapped section when there is nothing to show', async () => {
  const view = await render(list({ unmapped: { title: '未入标准表 · 0 条', aria: '未入标准表', timeZone: 'UTC', observations: [] } }))
  try {
    expect(view.host.querySelector('[data-unmapped-group]')).toBeNull()
  } finally { await view.done() }
})
