// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { productText } from '../../shared/i18n/productText'
import type { MacroEconomicCalendarClient } from '../../shared/ipc/macroEconomicCalendarClient'
import { SelectedCalendarEventDrawer } from './SelectedCalendarEventDrawer'

/**
 * The dashboard's event detail.
 *
 * Clicking a chart line means "what is this?" — so this surface must show the calendar's own
 * detail, in the calendar's own unmasked left drawer. It is read from the calendar's month and
 * detail routes only; nothing here is a second copy of the event, and a query that fails says so
 * instead of leaving a blank pane.
 */
const asOf = '2026-08-12T00:00:00.000Z'
const portal = productText['zh-CN'].pages.intelligence.portal
const text = portal.calendar
// The label the reader was looking at when they clicked: the chart line's own, which is named from
// the analysis vocabulary (设计 145 §8 D) — not the calendar's former second wording.
const selection = { eventKey: 'US.CORE_CPI.RELEASE.2026-M09', month: '2026-10', label: portal.analysisWorkspace.readableNames.eventName['core-cpi'] }

/** 市场月读数的**真实签名**（从组件 prop 取），不另写一份形状：测试夹具按它收窄。 */
type ReadMarketMonth = NonNullable<Parameters<typeof SelectedCalendarEventDrawer>[0]['readMarketMonth']>
type MarketMonthRead = NonNullable<Awaited<ReturnType<ReadMarketMonth>>>
type MarketEventRead = MarketMonthRead['events'][number]
let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
})

function officialEvent(overrides: Record<string, unknown> = {}) {
  return {
    eventKey: selection.eventKey, releaseGroupKey: selection.eventKey,
    eventFamily: 'consumer-price-index', titleKey: 'core-cpi', countryCode: 'US' as const, importance: 'high' as const,
    periodKey: '2026-M09', lifecycleState: 'scheduled' as const, coverage: 'available' as const,
    scheduledDate: '2026-10-14', scheduledAt: '2026-10-14T12:30:00.000Z', releaseTimeSource: 'convention-default' as const,
    conventionScheduledAt: '2026-10-14T12:30:00.000Z', detectedAt: asOf,
    consensus: null, consensusState: 'unavailable' as const, surprise: 'consensus-unavailable' as const,
    providerIds: ['macro-calendar-bls'], caveats: ['official-time-not-published', 'official-timezone-not-published', 'bls-python-schedule'],
    ...overrides
  }
}

function clientWith(result: unknown, overrides: Partial<MacroEconomicCalendarClient> = {}): MacroEconomicCalendarClient {
  return {
    queryMonth: vi.fn(async () => ({ state: 'unavailable' as const, failureCode: 'calendar-query-unavailable' as const })),
    getEventDetail: vi.fn(async () => result),
    previewManualBlsIcs: vi.fn(), importManualBlsIcs: vi.fn(), refreshBlsEmploymentRelease: vi.fn(), refreshFedFomcDecision: vi.fn(),
    syncBlsEmploymentSchedule: vi.fn(), setReleaseTime: vi.fn(), clearReleaseTime: vi.fn(),
    ...overrides
  } as unknown as MacroEconomicCalendarClient
}

async function render(client: MacroEconomicCalendarClient, onClose = vi.fn(), readMarketMonth?: Parameters<typeof SelectedCalendarEventDrawer>[0]['readMarketMonth']): Promise<HTMLDivElement> {
  host = document.createElement('div')
  document.body.append(host)
  const localRoot = createRoot(host)
  root = localRoot
  const drawer = createElement(SelectedCalendarEventDrawer, { client, selection, now: () => new Date(asOf), text, onClose, ...(readMarketMonth ? { readMarketMonth } : {}) })
  await act(async () => localRoot.render(createElement(ShellTimeZoneProvider, { timeZone: 'UTC', children: drawer })))
  for (let attempt = 0; attempt < 8; attempt += 1) await act(async () => { await Promise.resolve() })
  return host
}

describe('the selected calendar event, as a drawer over the dashboard', () => {
  it('opens the calendar\'s own panel with the event\'s full detail', async () => {
    const detail = officialEvent({ actual: { displayValue: '0.3%' }, previous: { displayValue: '0.2%' }, lifecycleState: 'released' as const })
    const host = await render(clientWith({ state: 'available', asOf, event: detail }))

    expect(host.querySelectorAll('[data-calendar-detail-container]')).toHaveLength(1)
    // 与日历页同一只抽屉（R38）：`inline`、无遮罩，出口是平台抽屉自己那颗关闭键。
    expect(host.querySelector('.mi-calendar-detail')).not.toBeNull()
    expect(host.querySelector('.ant-drawer')?.classList.contains('drawer--inline')).toBe(true)
    expect(host.querySelector('.ant-drawer-mask')).toBeNull()
    expect(host.querySelector('.ant-drawer-header button[aria-label]')).not.toBeNull()
    const body = host.querySelector('[data-calendar-detail-container]')!
    // 同一个发布，竖线与抽屉同名：抽屉读的是分析侧那份词表（设计 145 §8 D）。
    expect(body.textContent).toContain(portal.analysisWorkspace.readableNames.eventName['core-cpi'])
    expect(body.textContent).toContain(text.details.importance)
    expect(body.textContent).toContain(text.importance.high)
    expect(body.textContent).toContain(text.details.state)
    expect(body.textContent).toContain(text.states.released)
    expect(body.textContent).toContain(text.sources.blsAutomaticSchedule)
    // The figures the reader came for, in the same rows the calendar page prints them in.
    expect(body.querySelector('.mi-economic-calendar__values')?.textContent).toContain('0.3%')
    expect(body.querySelector('.mi-economic-calendar__values')?.textContent).toContain('0.2%')
    // Neither side has an expectation here: the row says so, and prints no number and no dash —
    // "we don't know the expectation" must not read as a verdict.
    const consensus = body.querySelector('[data-consensus="missing"]')
    expect(consensus?.textContent).toBe(`${text.market.consensus}${text.details.consensusMissing}`)
    expect(consensus?.textContent).not.toMatch(/[\d—−]/)
  })

  it('carries the drawer\'s one visible way out', async () => {
    const onClose = vi.fn()
    const host = await render(clientWith({ state: 'available', asOf, event: officialEvent() }), onClose)
    await act(async () => host.querySelector<HTMLButtonElement>('.ant-drawer-header button[aria-label]')!.click())
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('says why it is empty when the detail cannot be read, and never invents a value', async () => {
    const host = await render(clientWith({ state: 'unavailable', asOf: undefined, failureCode: 'event-not-found' } as never))
    const body = host.querySelector('[data-calendar-detail-container]')
    expect(body?.textContent).toContain(text.failures['event-not-found'])
    expect(host.querySelector('.mi-economic-calendar__values')).toBeNull()

    const rejected = await render(clientWith(undefined, { getEventDetail: vi.fn(async () => { throw new Error('ipc down') }) } as never))
    // A read failure is the shared state now: the sentence and the retry both come from the platform,
    // because the product's own line promised nothing the reader could act on.
    const failed = rejected.querySelector('[data-calendar-detail-container]')
    expect(failed?.querySelector('.state-view')).not.toBeNull()
    expect(failed?.querySelector('.state-view__action')).not.toBeNull()
    expect(failed?.textContent).not.toContain(text.failures['calendar-query-unavailable'])
  })

  it('opens a provider release the official route does not hold, in the provider\'s own body', async () => {
    // The chart draws the 0xRouter data releases beside the official ones. One of those has no
    // official row, so the official read says 未找到 — and that must not be the last word on what
    // the reader just clicked.
    const provider = {
      eventKey: selection.eventKey, title: '9月零售销售(月率)', countryCode: 'US', countryName: '美国',
      eventType: 'economic-indicator' as const, importance: 'high' as const, scheduledAt: '2026-10-14T12:30:00.000Z',
      consensus: { displayValue: '0.3%' }, providerPrevious: { displayValue: '1.2%' }, providerActual: { displayValue: '0.8%' },
      source: '0xRouter' as const, sourceObservedAt: '2026-10-14T12:31:00.000Z', coverage: 'observed-unverified' as const
    }
    const host = await render(clientWith({ state: 'unavailable', asOf: undefined, failureCode: 'event-not-found' } as never), vi.fn(), async () => ({ events: [provider], sources: [] }))
    const body = host.querySelector('[data-calendar-detail-container]')
    expect(body?.textContent).toContain('9月零售销售(月率)')
    expect(body?.textContent).toContain('0.8%')
    expect(body?.textContent).toContain(text.market.importance.high)
    expect(body?.textContent).toContain(text.market.source)
    // The provider's own rows, not the official body's: a provider observation has no release-time
    // row, no period and no official/previous columns — those belong to the official surface.
    expect(body?.querySelector('[data-market-value="providerActual"]')?.textContent).toContain('0.8%')
    expect(body?.querySelector('[data-release-time-row]')).toBeNull()
    expect(body?.textContent).not.toContain(text.details.period)
  })

  it('still says 未找到 when neither route carries the event', async () => {
    const host = await render(clientWith({ state: 'unavailable', asOf: undefined, failureCode: 'event-not-found' } as never), vi.fn(), async () => ({ events: [], sources: [] }))
    expect(host.querySelector('[data-calendar-detail-container]')?.textContent).toContain(text.failures['event-not-found'])
  })

  it('prints the provider route\'s own refresh state, not a made-up 尚未刷新', async () => {
    // The reused body can only speak about the source it is given. Without one it falls back to the
    // observation's own time and says 本次尚未刷新 — which is why the calendar page hands its source
    // over, and why this drawer now does too: otherwise the same event reads differently depending on
    // which surface opened it.
    const provider = {
      eventKey: selection.eventKey, title: '9月零售销售(月率)', countryCode: 'US', eventType: 'economic-indicator' as const,
      importance: 'high' as const, scheduledAt: '2026-10-14T12:30:00.000Z',
      consensus: null, providerPrevious: null, providerActual: { displayValue: '0.8%' },
      source: '0xRouter' as const, sourceObservedAt: '2026-10-14T12:31:00.000Z', coverage: 'observed-unverified' as const
    }
    const source = {
      eventType: 'economic-indicator' as const, status: 'partial' as const, sourceObservedAt: provider.sourceObservedAt,
      latestAttempt: { state: 'failed' as const, attemptedAt: '2026-10-14T13:00:00.000Z', failureCode: 'parse-unavailable' as const, trigger: 'automatic' as const }
    }
    const host = await render(clientWith({ state: 'unavailable', asOf: undefined, failureCode: 'event-not-found' } as never), vi.fn(),
      async () => ({ events: [provider], sources: [source] }))
    const status = host.querySelector('[data-market-source-status="economic-indicator"]')
    expect(status?.textContent).toContain(text.market.refreshOutcome.failed)
    expect(status?.textContent).toContain(text.market.refreshTrigger.automatic)
    expect(status?.textContent).toContain(text.market.attemptFailure['parse-unavailable'])
    expect(status?.textContent).toContain(text.market.statuses.partial)
    // The source agrees with the observation, so nothing claims it moved past it.
    expect(host.querySelector('[data-source-advanced]')).toBeNull()
  })

  it('says which observation the values belong to when the live source has moved past it', async () => {
    const provider = {
      eventKey: selection.eventKey, title: '9月零售销售(月率)', countryCode: 'US', eventType: 'economic-indicator' as const,
      importance: 'high' as const, scheduledAt: '2026-10-14T12:30:00.000Z',
      consensus: null, providerPrevious: null, providerActual: { displayValue: '0.8%' },
      source: '0xRouter' as const, sourceObservedAt: '2026-10-14T12:31:00.000Z', coverage: 'observed-unverified' as const
    }
    const source = { eventType: 'economic-indicator' as const, status: 'success' as const, sourceObservedAt: '2026-10-15T14:00:00.000Z' }
    const host = await render(clientWith({ state: 'unavailable', asOf: undefined, failureCode: 'event-not-found' } as never), vi.fn(),
      async () => ({ events: [provider], sources: [source] }))
    expect(host.querySelector('[data-source-advanced]')?.textContent).toBe(text.market.sourceAdvanced)
    // The values are still the observation's own, with its own time.
    expect(host.querySelector('[data-market-value="providerActual"]')?.textContent).toContain('0.8%')
  })
})

describe('the drawer pairs an official event with its admitted market observation', () => {
  const linkedMarket = (consensus: MarketEventRead['consensus']): MarketMonthRead => ({
    sources: [],
    events: [{
      eventKey: 'market:core-cpi', title: '美国核心CPI', countryCode: 'US', eventType: 'economic-indicator',
      importance: 'high', scheduledAt: '2026-10-14T12:30:00.000Z', consensus, providerPrevious: null, providerActual: null,
      source: '0xRouter', sourceObservedAt: asOf, coverage: 'observed-unverified',
      officialLink: {
        officialEventKey: selection.eventKey, officialPeriodKey: '2026-M09', officialScheduledDate: '2026-10-14',
        officialScheduledAt: '2026-10-14T12:30:00.000Z', officialDetectedAt: asOf,
        timeDisplaySource: 'official-scheduled', displayScheduledAt: '2026-10-14T12:30:00.000Z',
        officialActual: null, officialPrevious: null
      }
    }]
  })

  it('reads the market month once and shows the market expectation with its source', async () => {
    const readMarketMonth = vi.fn(async () => linkedMarket({ displayValue: '0.3%' }))
    const host = await render(clientWith({ state: 'available', asOf, event: officialEvent() }), vi.fn(), readMarketMonth)
    expect(readMarketMonth).toHaveBeenCalledTimes(1)
    const row = host.querySelector('[data-consensus]')!
    expect(row.getAttribute('data-consensus')).toBe('market')
    expect(row.textContent).toContain('0.3%')
    expect(row.textContent).toContain(text.details.consensusFromMarket)
  })

  it('says the expectation is missing when the paired observation has none either', async () => {
    const readMarketMonth = vi.fn(async () => linkedMarket(null))
    const host = await render(clientWith({ state: 'available', asOf, event: officialEvent() }), vi.fn(), readMarketMonth)
    expect(host.querySelector('[data-consensus="missing"]')?.textContent).toContain(text.details.consensusMissing)
  })

  it('says the market read failed, which is not the same as no expectation', async () => {
    const readMarketMonth = vi.fn(async () => { throw new Error('ipc down') })
    const host = await render(clientWith({ state: 'available', asOf, event: officialEvent() }), vi.fn(), readMarketMonth)
    const row = host.querySelector('[data-consensus]')!
    expect(row.getAttribute('data-consensus')).toBe('unreadable')
    expect(host.querySelector('[data-consensus-gap]')?.textContent).toBe(text.details.consensusReadFailedReason)
  })

  it('does not pair a different indicator that happens to share the release minute', async () => {
    // 非农、失业率、时薪常常同一分钟发布。市场侧那条同一时刻的观测没有准入映射，
    // 就不许被当成「这条官方事件的预期」——那是凭空造的一对。
    const otherAtSameInstant: MarketMonthRead = {
      sources: [],
      events: [{
        eventKey: 'market:unemployment', title: '美国失业率', countryCode: 'US', eventType: 'economic-indicator',
        importance: 'high', scheduledAt: '2026-10-14T12:30:00.000Z', consensus: { displayValue: '4.1%' },
        providerPrevious: null, providerActual: null, source: '0xRouter', sourceObservedAt: asOf,
        coverage: 'observed-unverified'
      }]
    }
    const readMarketMonth = vi.fn(async () => otherAtSameInstant)
    const host = await render(clientWith({ state: 'available', asOf, event: officialEvent() }), vi.fn(), readMarketMonth)
    // 没有映射 → 不配对：既不用那条 4.1%，也不说「未对上」（那同样是在断言两行同一件事）。
    const row = host.querySelector('[data-consensus]')!
    expect(row.getAttribute('data-consensus')).toBe('missing')
    expect(row.textContent).not.toContain('4.1%')
    expect(host.textContent).not.toContain('未对上')
  })

  it('never pairs by timestamp: the source compares no scheduled time', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const source = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/SelectedCalendarEventDrawer.tsx'), 'utf8')
    // B 的延伸：认成对只能走准入映射，时间比较一出现就是越界。
    expect(source).not.toMatch(/scheduledAt\s*(===|!==|==|!=)/)
  })
})
