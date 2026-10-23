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
let root: Root | undefined
let host: HTMLDivElement | undefined
globalThis.IS_REACT_ACT_ENVIRONMENT = true

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
  await act(async () => localRoot.render(createElement(ShellTimeZoneProvider, { timeZone: 'UTC' },
    createElement(SelectedCalendarEventDrawer, { client, selection, now: () => new Date(asOf), text, onClose, ...(readMarketMonth ? { readMarketMonth } : {}) }))))
  for (let attempt = 0; attempt < 8; attempt += 1) await act(async () => { await Promise.resolve() })
  return host
}

describe('the selected calendar event, as a drawer over the dashboard', () => {
  it('opens the calendar\'s own unmasked left drawer with the event\'s full detail', async () => {
    const detail = officialEvent({ actual: { displayValue: '0.3%' }, previous: { displayValue: '0.2%' }, lifecycleState: 'released' as const })
    const host = await render(clientWith({ state: 'available', asOf, event: detail }))

    expect(host.querySelectorAll('[data-calendar-detail-container]')).toHaveLength(1)
    // The calendar's drawer component, not a lookalike: left, unmasked, one way out in the corner.
    expect(host.querySelector('.ant-drawer-left')).not.toBeNull()
    expect(host.querySelector('.ant-drawer-mask')).toBeNull()
    expect(host.querySelector('.ant-drawer-close')).not.toBeNull()
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
  })

  it('carries the drawer\'s one visible way out', async () => {
    const onClose = vi.fn()
    const host = await render(clientWith({ state: 'available', asOf, event: officialEvent() }), onClose)
    await act(async () => host.querySelector<HTMLButtonElement>('.ant-drawer-close')!.click())
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('says why it is empty when the detail cannot be read, and never invents a value', async () => {
    const host = await render(clientWith({ state: 'unavailable', asOf: undefined, failureCode: 'event-not-found' } as never))
    const body = host.querySelector('[data-calendar-detail-container]')
    expect(body?.textContent).toContain(text.failures['event-not-found'])
    expect(host.querySelector('.mi-economic-calendar__values')).toBeNull()

    const rejected = await render(clientWith(undefined, { getEventDetail: vi.fn(async () => { throw new Error('ipc down') }) } as never))
    expect(rejected.querySelector('[data-calendar-detail-container]')?.textContent).toContain(text.failures['calendar-query-unavailable'])
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
