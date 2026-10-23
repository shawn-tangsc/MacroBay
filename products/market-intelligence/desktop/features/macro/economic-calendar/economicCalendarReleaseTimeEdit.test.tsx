// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { productText } from '../../../shared/i18n/productText'
import { EconomicCalendar } from './index'

// Real antd `DatePicker` would paint its panel; this stand-in keeps the two things these tests are
// about — the value the control was handed, and the fact that it is only mounted once opened.
vi.mock('antd', async () => {
  const actual = await vi.importActual<typeof import('antd')>('antd')
  return {
    ...actual,
    DatePicker: (props: { 'aria-label'?: string; className?: string; format?: string; value?: { format: (format: string) => string } }) =>
      <input aria-label={props['aria-label']} className={props.className} data-format={props.format}
        data-value={props.value?.format(props.format ?? '')} readOnly type="text" />
  }
})

const asOf = '2026-08-12T00:00:00.000Z'
const queryAsOf = new Date(asOf).toISOString()
const text = productText['zh-CN'].pages.intelligence.portal.calendar
let container: HTMLDivElement | undefined
let root: ReturnType<typeof createRoot> | undefined

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  container = undefined
  root = undefined
})

function event(overrides: Record<string, unknown> = {}) {
  return {
    eventKey: 'US.CORE_CPI.RELEASE.2026-M09', releaseGroupKey: 'US.CORE_CPI.RELEASE.2026-M09',
    eventFamily: 'consumer-price-index', titleKey: 'core-cpi', countryCode: 'US' as const, importance: 'high' as const,
    periodKey: '2026-M09', lifecycleState: 'scheduled' as const, coverage: 'available' as const,
    scheduledDate: '2026-10-14', scheduledAt: '2026-10-14T12:30:00.000Z', releaseTimeSource: 'convention-default' as const,
    conventionScheduledAt: '2026-10-14T12:30:00.000Z', detectedAt: asOf,
    consensus: null, consensusState: 'unavailable' as const, surprise: 'consensus-unavailable' as const,
    providerIds: ['macro-calendar-bls'], caveats: ['official-time-not-published', 'official-timezone-not-published', 'bls-python-schedule'],
    ...overrides
  }
}

async function renderInspector(subject: Record<string, unknown>) {
  container = document.createElement('div')
  document.body.append(container)
  const localRoot = createRoot(container)
  root = localRoot
  const input = {
    queryMonth: vi.fn(async () => ({ state: 'available' as const, asOf: queryAsOf, events: [subject] })),
    getEventDetail: vi.fn(async () => ({ state: 'available' as const, asOf: queryAsOf, event: subject })),
    setReleaseTime: vi.fn(async () => ({ state: 'saved' as const, scheduledAt: '2026-10-15T13:30:00.000Z', scheduledDate: '2026-10-15' })),
    clearReleaseTime: vi.fn(async () => ({ state: 'cleared' as const })),
    previewManualBlsIcs: vi.fn(async () => ({ state: 'failed' as const, failureCode: 'invalid-file' as const })),
    importManualBlsIcs: vi.fn(async () => ({ state: 'failed' as const, failureCode: 'invalid-file' as const })),
    refreshBlsEmploymentRelease: vi.fn(async () => ({ state: 'unavailable' as const })),
    refreshFedFomcDecision: vi.fn(async () => ({ state: 'unavailable' as const })),
    syncBlsEmploymentSchedule: vi.fn(async () => ({ state: 'unavailable' as const }))
  }
  const calendar = <ShellTimeZoneProvider timeZone="Asia/Shanghai"><EconomicCalendar client={input as never} now={() => new Date(asOf)} onBack={() => undefined} openTarget={{ month: '2026-10', eventKey: String(subject.eventKey) }} text={text} /></ShellTimeZoneProvider>
  await act(async () => localRoot.render(calendar))
  for (let attempt = 0; attempt < 12; attempt += 1) await act(async () => { await Promise.resolve() })
  return { host: container, input }
}

async function click(host: HTMLElement, label: string): Promise<void> {
  await act(async () => {
    const control = host.querySelector<HTMLElement>(`button[aria-label="${label}"]`)
      ?? [...host.querySelectorAll('button')].find((candidate) => candidate.textContent === label)
    if (!control) throw new Error(`no control labelled ${label}`)
    control.click()
  })
}

describe('the release time is edited where it is shown', () => {
  it('shows the displayed instant as the row value and only reveals the picker when asked', async () => {
    const { host } = await renderInspector(event())
    const row = host.querySelector('[data-release-time-row]')
    expect(row?.getAttribute('data-release-time-row')).toBe('convention-default')
    // 12:30Z is 20:30 in the workspace's Asia/Shanghai zone.
    expect(row?.textContent).toContain('10-14 20:30')
    // The control is not the default state: nothing to fill in until the reader opens it.
    expect(host.querySelector('.mi-economic-calendar__release-time-picker')).toBeNull()
    await click(host, text.details.time)
    expect(host.querySelector('.mi-economic-calendar__release-time-picker')).not.toBeNull()
  })

  it('labels a convention, and offers to restore once the reader has edited the row', async () => {
    const first = await renderInspector(event())
    expect(first.host.querySelector('[data-release-time-row]')?.textContent).toContain(text.details.conventionTime)
    act(() => root?.unmount())
    container?.remove()
    root = undefined

    const edited = await renderInspector(event({ releaseTimeSource: 'user-edited', scheduledDate: '2026-10-15', scheduledAt: '2026-10-15T13:30:00.000Z' }))
    expect(edited.host.querySelector('[data-release-time-row]')?.textContent).toContain(text.details.editedTime)
    await click(edited.host, text.details.editTime.restore)
    expect(edited.input.clearReleaseTime).toHaveBeenCalledWith({ eventKey: 'US.CORE_CPI.RELEASE.2026-M09' })
  })
})

describe('a release that has already happened cannot be moved', () => {
  it('renders the time as fixed text once the row carries an actual value', async () => {
    const { host } = await renderInspector(event({
      lifecycleState: 'released',
      actual: { numericValue: 2.6, displayValue: '2.6%', unit: 'percent' }
    }))
    const value = host.querySelector<HTMLElement>('.mi-economic-calendar__release-time-value')
    expect(value, 'the time is still shown').not.toBeNull()
    // History, not a setting: no control to open, and no restore action either.
    expect(value?.getAttribute('data-release-time-fixed')).toBe('true')
    expect(value?.tagName).toBe('SPAN')
    expect(host.querySelector('button[aria-label="' + text.details.time + '"]')).toBeNull()
    expect(host.textContent).not.toContain(text.details.editTime.restore)
  })

  it('still lets a scheduled row without an actual value be edited', async () => {
    const { host } = await renderInspector(event())
    const value = host.querySelector<HTMLElement>('.mi-economic-calendar__release-time-value')
    expect(value?.tagName).toBe('BUTTON')
    expect(value?.getAttribute('data-release-time-fixed')).toBeNull()
  })
})

describe('a payload without the provenance field still opens its detail', () => {
  it('renders the row and treats a missing source as the published time', async () => {
    // Regression: making `releaseTimeSource` required in this file's own field list blanked the whole
    // detail pane for any payload from a main process that predated it.
    const { releaseTimeSource, ...legacy } = event()
    void releaseTimeSource
    const { host } = await renderInspector(legacy as Record<string, unknown>)
    const row = host.querySelector('[data-release-time-row]')
    expect(row, 'the detail pane must render, not go blank').not.toBeNull()
    expect(row?.getAttribute('data-release-time-row')).toBe('official')
  })
})
