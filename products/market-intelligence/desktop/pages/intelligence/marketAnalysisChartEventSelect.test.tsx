// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { productText } from '../../shared/i18n/productText'
import { createCrossAssetSnapshotQuery } from '../../../service/intelligence/cross-asset/crossAssetSnapshotQuery'
import { CryptoIntelligenceDashboard } from './CryptoIntelligenceDashboard'
import { MarketAnalysisDashboardLayout } from './MarketAnalysisDashboardLayout'
import { SelectedCalendarEventDrawer } from './SelectedCalendarEventDrawer'

/**
 * Clicking a line on the chart: the drawer opens, the event is recorded, and nothing else moves.
 *
 * The line is a question about an event, not a request for a conversation. So this walks the real
 * path — the panel draws the line from the calendar's own month query, the dashboard hands the
 * click up, the layout opens the page's drawer and records the selection — and then asserts the
 * Agent column was left exactly where it was. Opening the conversation afterwards is the reader's
 * own move, and it is already bound to the event they clicked.
 */
const portal = productText['zh-CN'].pages.intelligence.portal
const asOf = '2026-10-13T12:00:00.000Z'
const nowMs = Date.parse(asOf)
const STEP = 300_000
const eventAt = '2026-10-13T08:30:00.000Z'
const calendarEvent = {
  eventKey: 'US.CPI.RELEASE.2026-M10', titleKey: 'cpi', countryCode: 'US', importance: 'high',
  eventType: 'economic-indicator', lifecycleState: 'released', publishedAt: eventAt, scheduledDate: '2026-10-13'
}
let root: Root | undefined
globalThis.IS_REACT_ACT_ENVIRONMENT = true

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

const bar = (symbol: string, barOpenMs: number, close: number) => ({
  symbol, barOpenMs, barEndMs: barOpenMs + STEP, open: String(close), high: String(close + 1), low: String(close - 1), close: String(close), volume: '1'
})
const bars = (symbol: string, endMs: number) => Array.from({ length: 289 }, (_, index) => bar(symbol, endMs - (289 - index) * STEP, 100 + index / 100))
const snapshot = createCrossAssetSnapshotQuery({
  now: () => nowMs,
  store: {
    revision: 1,
    queryAt: (request: { symbol: string; fromMs: number; toMs: number; asOfMs: number }) =>
      bars(request.symbol, nowMs).filter(entry => entry.barOpenMs >= request.fromMs && entry.barOpenMs <= request.toMs && entry.barEndMs <= request.asOfMs)
  } as never,
  live: () => ({ state: 'live' as const, quotes: {
    index: { state: 'live' as const, price: '710.55', tradedAtMs: nowMs, receivedAtMs: nowMs },
    btc: { state: 'missing' as const }, eth: { state: 'missing' as const }
  } }),
  indexFeed: () => ({ state: 'ready' as const })
}).query({ range: '24h' })

/** The calendar's month route, as the dashboard was already handed it in the page. */
const monthPage = (events: readonly unknown[]) => ({ state: 'available' as const, asOf, events })
const calendar = { queryMonth: vi.fn(async () => monthPage([calendarEvent])) }
const never = async () => ({ state: 'unavailable' })
const dashboardProps = {
  text: portal.dashboard,
    client: calendar,
  fearGreedClient: { querySnapshot: never } as never,
  fundingRateClient: { query: never } as never,
  now: () => new Date(asOf),
  onBack: () => undefined,
  onConfigureSources: () => undefined,
  onManageSource: () => undefined,
  onOpenCalendar: () => undefined,
  crossAssetClient: {
    acquire: async () => ({ state: 'active', leaseId: 'test-lease', expiresAt: nowMs + 30_000 }),
    query: async () => snapshot,
    release: async () => ({ state: 'released' })
  }
}

async function renderSurface(extra: Record<string, unknown> = {}, monthEvents?: readonly unknown[], cardEvents?: readonly Record<string, unknown>[]): Promise<HTMLDivElement> {
  const invoke = vi.fn(async (_product: string, method: string, payload?: unknown) => {
    if (method === 'intelligence.macro.economicCalendar.queryMonth') {
      const request = payload as { month?: string; asOf?: string }
      return { state: 'available' as const, asOf: request.asOf,
        events: (cardEvents ?? []).filter(event => String(event.scheduledDate ?? '').startsWith(request.month ?? '')) }
    }
    if (method === 'marketAnalysis.listTimeline') return { schemaVersion: 1, nextCursor: null, items: [] }
    if (method === 'marketAnalysis.getLatestAttempt') return null
    return []
  })
  vi.stubGlobal('platform', { products: { invoke }, agents: { getState: async () => ({ agents: [], sessions: [], messagesBySessionId: {} }), onStateChanged: () => () => {} } })
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  // Mirrors index.tsx: the page's title vocabulary, its drawer and its one selected event.
  const dashboard = monthEvents
    ? { ...dashboardProps, client: { queryMonth: vi.fn(async () => monthPage(monthEvents)) } }
    : dashboardProps
  await act(async () => root?.render(createElement(ShellTimeZoneProvider, { timeZone: 'UTC' },
    createElement(MarketAnalysisDashboardLayout, {
      text: portal,
      calendarEventTitles: portal.analysisWorkspace.readableNames.eventName,
      renderEventDetailDrawer: (selection: { eventKey: string; label: string }, onClose: () => void) =>
        createElement('div', { 'data-test-event-drawer': selection.eventKey, onClick: onClose }, selection.label),
      ...extra
    }, createElement(CryptoIntelligenceDashboard, { ...dashboard } as never)))))
  for (let attempt = 0; attempt < 12; attempt += 1) await act(async () => { await Promise.resolve() })
  return host
}

/** Let the drawer's own read settle: mount, ask for the detail, paint it. */
async function flush(): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt += 1) await act(async () => { await Promise.resolve() })
}

describe('a chart line selects a calendar event without opening the conversation', () => {
  it('opens the page\'s event drawer, records the event, and leaves the Agent column closed', async () => {
    const host = await renderSurface()
    const line = host.querySelector<HTMLButtonElement>('[data-event-line]')
    expect(line, 'the chart drew the calendar\'s released event as a line').not.toBeNull()
    expect(line?.getAttribute('data-published')).toBe('true')
    // The line is named from the vocabulary the page handed down, never from the raw key.
    expect(line?.textContent).toContain(portal.analysisWorkspace.readableNames.eventName.cpi)

    await act(async () => line!.click())

    // 1. The event's drawer is open, showing the event the line stood for.
    const drawer = host.querySelector('[data-test-event-drawer]')
    expect(drawer?.getAttribute('data-test-event-drawer')).toBe(calendarEvent.eventKey)
    expect(drawer?.textContent).toBe(portal.analysisWorkspace.readableNames.eventName.cpi)
    // 2. Nothing opened the conversation and nothing switched the workspace.
    expect(host.querySelector('.mi-agent-floating')).toBeNull()
    expect(host.querySelector('[data-agent-floating-button]')?.getAttribute('aria-expanded')).toBe('false')
    expect(host.querySelector('.mi-analysis-dashboard-layout')?.getAttribute('data-compact-view')).toBe('dashboard')

    // 3. Recorded: when the reader does open the conversation, it is already bound to that event.
    await act(async () => host.querySelector<HTMLButtonElement>('[data-agent-floating-button]')!.click())
    const binding = host.querySelector('.mi-analysis-chat__binding')?.textContent ?? ''
    expect(binding).toContain(portal.analysisWorkspace.selectedEvent)
    expect(binding).not.toContain(portal.analysisWorkspace.selectedAnalysis)
    expect(binding).toContain(portal.analysisWorkspace.readableNames.eventName.cpi)
  })

  it('closes the drawer from its own control and keeps the recorded event', async () => {
    const host = await renderSurface()
    await act(async () => host.querySelector<HTMLButtonElement>('[data-event-line]')!.click())
    expect(host.querySelector('[data-test-event-drawer]')).not.toBeNull()
    await act(async () => host.querySelector<HTMLElement>('[data-test-event-drawer]')!.click())
    expect(host.querySelector('[data-test-event-drawer]')).toBeNull()
    // Closing the drawer is not clearing the selection: the conversation is still bound to it.
    await act(async () => host.querySelector<HTMLButtonElement>('[data-agent-floating-button]')!.click())
    expect(host.querySelector('.mi-analysis-chat__binding')?.textContent).toContain(portal.analysisWorkspace.readableNames.eventName.cpi)
  })

  it('draws and opens a provider release the official route does not carry', async () => {
    // 10-13 10:00 UTC, inside the 24H window and a different minute from the official CPI: the
    // provider's own data calendar, which the official route has no row for — the case that made a
    // day full of releases show an empty chart.
    const releasedAt = '2026-10-13T10:00:00.000Z'
    const provider = {
      eventKey: 'a1b2c3d4-0000-4000-8000-000000000001', title: '9月零售销售(月率)', countryCode: 'US',
      eventType: 'economic-indicator', importance: 'high', scheduledAt: releasedAt,
      consensus: { displayValue: '0.3%' }, providerPrevious: { displayValue: '1.2%' }, providerActual: { displayValue: '0.8%' },
      source: '0xRouter', sourceObservedAt: releasedAt, coverage: 'observed-unverified'
    }
    const readMarketEvents = vi.fn(async () => [provider])
    const host = await renderSurface({ readMarketEvents })

    // Two lines now: the official CPI the calendar list holds, and the provider's release.
    const lines = [...host.querySelectorAll<HTMLElement>('[data-event-line]')]
    expect(lines.map(line => line.textContent)).toContain('9月零售销售(月率)')
    expect(readMarketEvents).toHaveBeenCalled()

    const providerLine = lines.find(line => line.textContent === '9月零售销售(月率)')!
    await act(async () => providerLine.click())
    expect(host.querySelector('[data-test-event-drawer]')?.getAttribute('data-test-event-drawer')).toBe(provider.eventKey)
    // The recorded context travels with it too, so the conversation is bound to what was clicked.
    await act(async () => host.querySelector<HTMLButtonElement>('[data-agent-floating-button]')!.click())
    expect(host.querySelector('.mi-analysis-chat__binding')?.textContent).toContain('9月零售销售(月率)')
  })

  it('opens the same left, unmasked drawer when a calendar-card row is clicked', async () => {
    // The card reads the live clock (no SampleMode provider in this test), so the fixture has to be
    // released an hour ago rather than on a fixed date.
    const now = new Date()
    const scheduledAt = new Date(now.getTime() - 60 * 60 * 1_000).toISOString()
    const detectedAt = new Date(now.getTime() - 2 * 60 * 1_000).toISOString()
    const cardEvent = {
      eventKey: 'US.CPI.CARD.2026-M10', releaseGroupKey: 'US.BLS.CPI.CARD', eventFamily: 'consumer-price-index',
      titleKey: 'cpi', countryCode: 'US', importance: 'high', periodKey: '2026-10',
      lifecycleState: 'released', coverage: 'available', scheduledDate: scheduledAt.slice(0, 10), scheduledAt,
      releaseTimeSource: 'official', officialReleaseDate: scheduledAt.slice(0, 10), publishedAt: scheduledAt,
      detectedAt, actual: { displayValue: '3.4%' }, previous: { displayValue: '3.1%' }, consensus: null,
      consensusState: 'unavailable', surprise: 'consensus-unavailable', providerIds: ['macro-calendar-bls'], caveats: []
    }
    const host = await renderSurface({}, undefined, [cardEvent])
    const row = host.querySelector<HTMLElement>('[data-calendar-card-row]')
    expect(row, 'the released value is in the card\'s today section').not.toBeNull()
    // No consensus is not a verdict: the row keeps its readings and does not add a badge for it.
    expect(row?.querySelector('[data-calendar-surprise]')).toBeNull()
    expect(row?.querySelector('.mi-calendar-card__row-value')?.textContent).toContain('实际值 3.4%')

    await act(async () => row!.click())

    // The page's own detail drawer — the chart line and the card row lead to one surface.
    expect(host.querySelector('[data-test-event-drawer]')?.getAttribute('data-test-event-drawer')).toBe(cardEvent.eventKey)
    // …and the Agent context was recorded as an additive side effect.
    await act(async () => host.querySelector<HTMLButtonElement>('[data-agent-floating-button]')!.click())
    expect(host.querySelector('.mi-analysis-chat__binding')?.textContent).toContain(portal.analysisWorkspace.readableNames.eventName.cpi)
  })
})

/**
 * 同一个发布，两个渲染面，一个名字（设计 145 §8 D）。
 *
 * 读者点开的竖线写着「核心 CPI」，它打开的抽屉却写着「Core CPI（核心消费者价格指数）」——因为
 * 竖线读分析侧词表、抽屉读日历侧那份。这一组断言走的都是**真实**路径：竖线来自面板对日历月页的
 * 归并，抽屉是页面真正注入的那个（`SelectedCalendarEventDrawer` + 日历自己的详情体），所以它不是
 * 在比较两个手抄的字符串。
 */
const coreCpiKey = 'US.CORE_CPI.RELEASE.2026-M10'
const registeredCoreCpi = portal.analysisWorkspace.readableNames.eventName['core-cpi']

/** 日历详情路由返回的官方事件：与真实投影吃同一份形状（见 economicCalendarModel.toEventView）。 */
const coreCpiDetail = {
  eventKey: coreCpiKey, releaseGroupKey: 'US.CPI.RELEASE.2026-M08', titleKey: 'core-cpi', eventFamily: 'consumer-price-index',
  periodKey: '2026-M09', lifecycleState: 'released', coverage: 'available', scheduledDate: '2026-10-13',
  scheduledAt: eventAt, releaseTimeSource: 'official', publishedAt: eventAt, detectedAt: asOf,
  actual: { displayValue: '0.3%', unit: 'percent' }, previous: { displayValue: '0.2%', unit: 'percent' },
  providerIds: ['macro-calendar-bls'], caveats: []
}

function pageClient(detail: unknown, events: readonly unknown[] = [calendarEvent]) {
  return { queryMonth: vi.fn(async () => monthPage(events)), getEventDetail: vi.fn(async () => detail), setReleaseTime: vi.fn(), clearReleaseTime: vi.fn() }
}

describe('the same release reads the same on the line and in its drawer', () => {
  it('names a registered release from the analysis vocabulary on both surfaces', async () => {
    // The line is drawn for the official row whose title key is `core-cpi`, and the drawer resolves
    // the very same release through its own route.
    const wire = { ...calendarEvent, eventKey: coreCpiKey, titleKey: 'core-cpi' }
    const client = pageClient({ state: 'available', asOf, event: coreCpiDetail }, [wire])
    const host = await renderSurface({
      renderEventDetailDrawer: (selection: { eventKey: string }, onClose: () => void) =>
        createElement(SelectedCalendarEventDrawer, { client: client as never, selection, now: () => new Date(asOf), text: portal.calendar, onClose })
    }, [wire])

    const line = host.querySelector<HTMLButtonElement>('[data-event-line]')
    expect(line?.textContent).toBe(registeredCoreCpi)

    await act(async () => line!.click())
    await flush()
    const drawerTitle = host.querySelector('[data-calendar-detail-container] h2')
    // Both surfaces, one name — and it is the analysis side's, not the calendar's former wording.
    expect(drawerTitle?.textContent).toBe(registeredCoreCpi)
    expect(drawerTitle?.textContent).toBe(line?.textContent)
    // 抽屉拿到的那份词表本身就是分析侧那一份（旧代码这里是「Core CPI（核心消费者价格指数）」）。
    expect(portal.calendar.events['core-cpi']).toBe(registeredCoreCpi)
  })

  it('leaves an unregistered provider release under its own display name on both surfaces', async () => {
    const providerTitle = '9月零售销售(月率)'
    const releasedAt = '2026-10-13T10:00:00.000Z'
    const provider = {
      eventKey: 'a1b2c3d4-0000-4000-8000-000000000001', title: providerTitle, countryCode: 'US',
      eventType: 'economic-indicator', importance: 'high', scheduledAt: releasedAt,
      consensus: { displayValue: '0.3%' }, providerPrevious: { displayValue: '1.2%' }, providerActual: { displayValue: '0.8%' },
      source: '0xRouter', sourceObservedAt: releasedAt, coverage: 'observed-unverified'
    }
    const officialOnly = pageClient({ state: 'unavailable', asOf: undefined, failureCode: 'event-not-found' })
    const host = await renderSurface({
      readMarketEvents: vi.fn(async () => [provider]),
      renderEventDetailDrawer: (selection: { eventKey: string }, onClose: () => void) =>
        createElement(SelectedCalendarEventDrawer, { client: officialOnly as never, selection, now: () => new Date(asOf), text: portal.calendar, onClose,
          readMarketMonth: async () => ({ events: [provider], sources: [] }) })
    })

    const providerLine = [...host.querySelectorAll<HTMLElement>('[data-event-line]')].find(line => line.textContent === providerTitle)
    expect(providerLine, 'the chart drew the provider release').not.toBeUndefined()

    await act(async () => providerLine!.click())
    await flush()
    // 长尾事件不起中文名：两个面都用 provider 自己的 displayName。
    expect(host.querySelector('[data-calendar-detail-container] h2')?.textContent).toBe(providerTitle)
    expect(providerLine?.textContent).toBe(providerTitle)
  })
})
