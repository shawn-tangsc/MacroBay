// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CrossAssetObservationPanel } from './CrossAssetObservationPanel'
import { productText } from '../../../shared/i18n/productText'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'

/**
 * 事件竖线（设计 140 §3.4/§3.5/§6）。
 *
 * 三条验收：实线/虚线分得清「坑是不是这次发布造成的」；取数失败只丢竖线、绝不牵连面板；
 * 点击把「哪条线 + 它是从哪个月读到的」交给页面。第三条是本文件与页面接线的契约，
 * 所以断言月份来自**取回它的那个月份页**，而不是从发布时间反推。
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const crossAssetText = productText['zh-CN'].pages.intelligence.portal.dashboard.crossAsset
const ScopedPanel = (props: Parameters<typeof CrossAssetObservationPanel>[0]): React.ReactElement =>
  createElement(ShellTimeZoneProvider, { timeZone: 'UTC' }, createElement(CrossAssetObservationPanel, props))

const windowStart = '2026-09-30T12:00:00.000Z'
const windowEnd = '2026-10-01T12:00:00.000Z'
const curves = [
  { at: windowStart, returnPercent: 0 },
  { at: '2026-10-01T00:00:00.000Z', returnPercent: 1 },
  { at: windowEnd, returnPercent: 2 }
]
/** The window the panel reads the calendar for: it reaches into September, the events were filed there. */
const snapshot = {
  schemaVersion: 1, mode: 'current', servedAt: windowEnd, asOf: windowEnd, range: '24h',
  analysisEnd: windowEnd, windowStart,
  historyCoverage: { index: { count: 3, expectedCount: 3 }, btc: { count: 3, expectedCount: 3 }, eth: { count: 3, expectedCount: 3 } },
  curves: { index: curves, btc: curves, eth: curves },
  closedReturns: { index: {}, btc: {}, eth: {} },
  correlations: { indexBtc: { sampleCount: 3 }, indexEth: { sampleCount: 3 } },
  relativeReturns: {}, observationKey: { indexBtc: 'unavailable', ethBtc: 'unavailable' },
  indexSource: 'proxy'
}
/** A calendar page for one month, shaped the way the panel's own mapping reads it. */
const calendarEvent = (overrides: Record<string, unknown>): Record<string, unknown> => ({
  eventKey: 'US.CPI.RELEASE.2026-M09', titleKey: 'cpi', countryCode: 'US', importance: 'high',
  eventType: 'economic-indicator', lifecycleState: 'released', source: 'official', ...overrides
})
const page = (events: readonly Record<string, unknown>[]) =>
  ({ queryMonth: async (input: { month: string; asOf: string }) => ({ state: 'available', asOf: input.asOf, events }) })

async function render(panel: Partial<Parameters<typeof CrossAssetObservationPanel>[0]>, snapshots: readonly unknown[] = [snapshot]) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  let queried = 0
  const client = { acquire: async () => ({ state: 'active', leaseId: 'test-lease', expiresAt: Date.now() + 30_000 }), query: async () => snapshots[Math.min(queried++, snapshots.length - 1)], release: vi.fn(async () => ({ state: 'released' })) }
  await act(async () => root.render(createElement(ScopedPanel, { client: client as never, text: crossAssetText, ...panel })))
  await act(async () => {})
  return { host, unmount: async () => { await act(async () => root.unmount()); host.remove() } }
}

/** A 0xRouter observation, whose field names the market route publishes. */
const marketEvent = (overrides: Record<string, unknown>): Record<string, unknown> => ({
  eventKey: 'a1b2c3d4-0000-4000-8000-000000000001', title: '9月零售销售(月率)', countryCode: 'US',
  eventType: 'economic-indicator', importance: 'high', scheduledAt: '2026-09-30T18:30:00.000Z', ...overrides
})

describe('cross-asset event lines', () => {
  it('draws a released event solid and an upcoming one dashed, named by the vocabulary the page handed down', async () => {
    const released = calendarEvent({ eventKey: 'US.CPI.RELEASE.2026-M09', publishedAt: '2026-09-30T18:00:00.000Z' })
    const upcoming = calendarEvent({ eventKey: 'US.FOMC.2026-10-01', titleKey: 'fomc', scheduledAt: '2026-09-30T21:00:00.000Z', lifecycleState: 'scheduled', publishedAt: undefined })
    const rendered = await render({
      // The page owns the vocabulary; the panel must never grow a second copy of the calendar's list.
      text: { ...crossAssetText, eventTitles: { cpi: '消费者物价指数（CPI）', fomc: '美联储议息会议' } },
      calendar: page([released, upcoming])
    })
    try {
      const lines = [...rendered.host.querySelectorAll<HTMLElement>('[data-event-line]')]
      expect(lines).toHaveLength(2)
      // Only a release explains a move that already happened, so only it is drawn solid.
      expect(lines.map(line => line.dataset.published)).toEqual(['true', 'false'])
      expect(lines.map(line => line.textContent)).toEqual(['消费者物价指数（CPI）', '美联储议息会议'])
      expect(lines[0]?.getAttribute('aria-label')).toContain('消费者物价指数（CPI）')
      // A key with no name yet is shown as the key rather than invented: the label is never a lie.
      const css = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/features/industry/cross-asset/CrossAssetObservationPanel.css'), 'utf8')
      expect(css).toMatch(/\.mi-cross-asset__event-line > i \{[^}]*border-left: 1px dashed/)
      expect(css).toMatch(/\.mi-cross-asset__event-line\[data-published="true"\] > i \{[^}]*border-left-style: solid/)
    } finally { await rendered.unmount() }
  })

  it('hands the picked line to the page together with the month it was read from', async () => {
    // Filed under September, released after midnight: a month derived from the instant would say
    // 2026-10 and the Agent's facts — read by month — would find nothing.
    const released = calendarEvent({ publishedAt: '2026-10-01T02:00:00.000Z' })
    const onSelectEvent = vi.fn()
    const rendered = await render({
      calendar: { queryMonth: async (input: { month: string }) => ({ state: 'available', asOf: input.month === '2026-09' ? '2026-09-30T12:00:00.000Z' : '2026-10-01T12:00:00.000Z', events: input.month === '2026-09' ? [released] : [] }) },
      onSelectEvent
    })
    try {
      const line = rendered.host.querySelector<HTMLButtonElement>('[data-event-line]')
      expect(line).not.toBeNull()
      await act(async () => line!.click())
      expect(onSelectEvent).toHaveBeenCalledTimes(1)
      const [picked, month] = onSelectEvent.mock.calls[0] as [ { events: readonly { eventKey: string }[] }, string ]
      expect(picked.events[0]?.eventKey).toBe('US.CPI.RELEASE.2026-M09')
      expect(month).toBe('2026-09')
    } finally { await rendered.unmount() }
  })

  it('keeps the curves when the calendar does not answer', async () => {
    const rendered = await render({ calendar: { queryMonth: async () => { throw new Error('calendar-query-unavailable') } } })
    try {
      // The calendar failing costs the lines and nothing else: the block must never become 行情暂不可用.
      expect(rendered.host.querySelectorAll('[data-event-line]')).toHaveLength(0)
      expect(rendered.host.querySelectorAll('[data-asset-line]')).toHaveLength(3)
      expect(rendered.host.textContent).not.toContain(crossAssetText.unavailable)
      expect(rendered.host.querySelector('[data-cross-asset-region="chart"]')).not.toBeNull()
    } finally { await rendered.unmount() }
  })

  // 0xRouter 路线：官方那九个 family 之外的数据发布（初请、零售销售、PPI…）以前图上一条都没有。
  const marketMonth = (events: readonly Record<string, unknown>[]) =>
    async (month: string) => month === '2026-09' ? events : []

  it('draws the provider\'s data releases beside the official ones, and no speeches or summits', async () => {
    const rendered = await render({
      readMarketEvents: marketMonth([
        marketEvent({ providerActual: { displayValue: '0.8%' } }),
        // High importance to the calendar, but not a release: it explains nothing about a step.
        marketEvent({ eventKey: 'b', title: '美联储理事鲍曼参加一场炉边谈话', eventType: 'central-bank-activity' }),
        marketEvent({ eventKey: 'c', title: '20国集团(G20)财长和央行行长会议', eventType: 'financial-event' }),
        // Another calendar's print cannot explain a US-hours move, and medium importance is the reader's own cut.
        marketEvent({ eventKey: 'd', title: '英国 8月工业产出(年率)', countryCode: 'GB' }),
        marketEvent({ eventKey: 'e', title: '10月费城联储制造业指数', importance: 'medium' })
      ])
    })
    try {
      const lines = [...rendered.host.querySelectorAll<HTMLElement>('[data-event-line]')]
      expect(lines).toHaveLength(1)
      expect(lines[0]?.textContent).toBe('9月零售销售(月率)')
      // 有值即已发布：市场路线的行只有"值有没有"这一个信号。
      expect(lines[0]?.dataset.published).toBe('true')
    } finally { await rendered.unmount() }
  })

  it('draws one release once when both routes carry it', async () => {
    // The provider's copy names its official counterpart; the official row is the one the calendar
    // page names, so the two must not become two names on one release (or two lines).
    const officialKey = 'US.CPI.RELEASE.2026-M09'
    const rendered = await render({
      text: { ...crossAssetText, eventTitles: { cpi: '消费者物价指数（CPI）' } },
      calendar: page([calendarEvent({ eventKey: officialKey, publishedAt: '2026-09-30T18:00:00.000Z' })]),
      readMarketEvents: marketMonth([marketEvent({
        eventKey: 'f', title: '9月未季调消费者物价指数(年率)', scheduledAt: '2026-09-30T18:00:00.000Z',
        officialLink: { officialEventKey: officialKey }
      })])
    })
    try {
      const lines = [...rendered.host.querySelectorAll<HTMLElement>('[data-event-line]')]
      expect(lines).toHaveLength(1)
      expect(lines[0]?.textContent).toBe('消费者物价指数（CPI）')
      expect(lines[0]?.textContent).not.toContain('未季调')
    } finally { await rendered.unmount() }
  })

  it('draws one release once when the provider title names a registered release', async () => {
    // 设计 145 §8 B：身份来自**命名映射**，不再只来自那条冻结的 officialLink。同一个发布在两条路线
    // 上措辞不同，映射命中就并成一条，并且用官方那条的名字。
    const officialKey = 'US.CPI.RELEASE.2026-M09'
    const rendered = await render({
      text: { ...crossAssetText, eventTitles: { cpi: '消费者物价指数（CPI）' } },
      calendar: page([calendarEvent({ eventKey: officialKey, publishedAt: '2026-09-30T18:00:00.000Z' })]),
      readMarketEvents: marketMonth([marketEvent({
        eventKey: 'g', title: '9月未季调消费者物价指数(年率)', scheduledAt: '2026-09-30T18:00:00.000Z'
      })])
    })
    try {
      const lines = [...rendered.host.querySelectorAll<HTMLElement>('[data-event-line]')]
      expect(lines).toHaveLength(1)
      expect(lines[0]?.textContent).toBe('消费者物价指数（CPI）')
      expect(lines[0]?.textContent).not.toContain('未季调')
      expect(lines[0]?.dataset.identity).toBe('confirmed')
    } finally { await rendered.unmount() }
  })

  it('keeps both names and says so when a provider release cannot be identified', async () => {
    // 零售销售不是九个已注册发布之一：没有身份可依，两条都留（宁可重复），并把"没确认过"留在线上。
    const rendered = await render({
      text: { ...crossAssetText, eventTitles: { cpi: '消费者物价指数（CPI）' } },
      calendar: page([calendarEvent({ eventKey: 'US.CPI.RELEASE.2026-M09', publishedAt: '2026-09-30T18:00:00.000Z' })]),
      readMarketEvents: marketMonth([marketEvent({
        eventKey: 'h', title: '9月零售销售(月率)', scheduledAt: '2026-09-30T18:00:00.000Z'
      })])
    })
    try {
      const line = rendered.host.querySelector<HTMLElement>('[data-event-line]')
      expect(line?.textContent).toContain('消费者物价指数（CPI）')
      expect(line?.textContent).toContain('9月零售销售(月率)')
      expect(line?.dataset.identity).toBe('unconfirmed')
      // 痕迹要能被读到，不是内部标志：悬停/朗读里说明为什么同一次发布有两个名字。
      expect(line?.getAttribute('title')).toContain(crossAssetText.eventLineIdentityUnconfirmed)
      expect(line?.getAttribute('aria-label')).toContain(crossAssetText.eventLineIdentityUnconfirmed)
    } finally { await rendered.unmount() }
  })

  it('re-reads the calendar when the window moves, not once per snapshot tick', async () => {
    // The snapshot's `asOf` moves every second while the window moves once per five-minute bar.
    // Depending on `asOf` re-read two months of two calendars per second; the window is what the
    // lines are about, so the window is what triggers a read.
    vi.useFakeTimers()
    const nextTick = { ...snapshot, asOf: '2026-10-01T12:00:01.000Z' }
    const queryMonth = vi.fn(async (input: { month: string; asOf: string }) => ({ state: 'available', asOf: input.asOf, events: [] }))
    const readMarketEvents = vi.fn(async () => [])
    const rendered = await render({ calendar: { queryMonth }, readMarketEvents }, [snapshot, nextTick])
    try {
      // One read per month the window touches: two, for a window that crosses midnight on the 30th.
      const queriedMonths = queryMonth.mock.calls.map(call => call[0].month)
      expect(queriedMonths).toEqual(['2026-09', '2026-10'])
      expect(readMarketEvents.mock.calls.length).toBe(2)
      // Two polls of the same window: one at +1s (the next snapshot) and one past the lease renewal.
      await act(async () => { await vi.advanceTimersByTimeAsync(1100) })
      await act(async () => { await vi.advanceTimersByTimeAsync(1100) })
      expect(queryMonth.mock.calls.map(call => call[0].month)).toEqual(queriedMonths)
      expect(readMarketEvents.mock.calls.length).toBe(2)
    } finally { await rendered.unmount(); vi.useRealTimers() }
  })
})
