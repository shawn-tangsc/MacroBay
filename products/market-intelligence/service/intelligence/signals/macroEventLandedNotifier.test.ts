import { describe, expect, it, vi } from 'vitest'

import type { MarketCalendarEvent } from '../../../contracts/macro/marketCalendarQueryContracts'
import {
  buildMacroEventLandedRequest,
  notifyMacroEventLandings,
  selectLandedReleases
} from './macroEventLandedNotifier'

const asOf = '2026-09-10T12:00:00.000Z'
const released = '2026-09-10T10:00:00.000Z'

function event(overrides: Partial<MarketCalendarEvent> = {}): MarketCalendarEvent {
  return {
    eventKey: 'batch-hmac-1',
    observationKey: 'US.CPI.RELEASE.2026-M08',
    title: 'CPI',
    countryCode: 'US',
    eventType: 'economic-indicator',
    importance: 'high',
    scheduledAt: released,
    consensus: { displayValue: '2' },
    providerPrevious: { displayValue: '2' },
    providerActual: { displayValue: '3' },
    source: '0xRouter',
    sourceObservedAt: asOf,
    coverage: 'observed-unverified',
    ...overrides
  }
}

describe('macro event landed notifier', () => {
  it('names the release and the instant the data describes, and leaves the key to the platform', () => {
    const request = buildMacroEventLandedRequest({ eventId: 'US.CPI.RELEASE.2026-M08', releaseAt: released })
    expect(request).toMatchObject({
      eventTypeId: 'market-intelligence.macro.event-landed',
      producerId: 'market-intelligence.calendar-refresh',
      dedupeVars: { builder: 'template', vars: { eventId: 'US.CPI.RELEASE.2026-M08', releaseAt: released } },
      actions: [],
      occurredAt: released
    })
    // No deeplink and no action: the shell resolves settings sections only, so an "open" button
    // would point nowhere. A button that cannot go anywhere is worse than no button.
    expect(request).not.toHaveProperty('deeplink')
    for (const bad of [{ eventId: '', releaseAt: released }, { eventId: 'x', releaseAt: 'not-an-instant' }]) {
      expect(buildMacroEventLandedRequest(bad)).toBeUndefined()
    }
  })

  it('reports only a release that has landed inside the window, once per event', () => {
    const events = [
      event(),
      // Not yet due: the release time is still ahead, nothing has happened.
      event({ eventKey: 'batch-2', observationKey: 'US.NFP.RELEASE.2026-M09', scheduledAt: '2026-09-11T10:00:00.000Z' }),
      // Due but nothing published: the reader would open an empty detail.
      event({ eventKey: 'batch-3', observationKey: 'US.PPI.RELEASE.2026-M08', providerActual: null }),
      // Landed long ago: a first collection of a whole month must not read as news.
      event({ eventKey: 'batch-4', observationKey: 'US.GDP.RELEASE.2026-Q2', scheduledAt: '2026-08-01T10:00:00.000Z' })
    ]
    const seen = new Set(['US.CPI.RELEASE.2026-M08:2026-09-10T10:00:00.000Z'])
    expect(selectLandedReleases(events, asOf, seen)).toEqual([])
    expect(selectLandedReleases(events, asOf)).toEqual([{ eventId: 'US.CPI.RELEASE.2026-M08', releaseAt: released }])
    // `eventKey` is a per-batch HMAC: two refreshes of the same release carry different ones, so it
    // may never be the identity. `observationKey` is what stays the same across collections.
    expect(selectLandedReleases([event({ eventKey: 'a-different-hmac' })], asOf)).toEqual([
      { eventId: 'US.CPI.RELEASE.2026-M08', releaseAt: released }
    ])
  })

  it('submits once, skips a release this process already spoke about, and lets a failed submit go', async () => {
    const submit = vi.fn(async () => ({ kind: 'recorded' } as never))
    const seen = new Map<string, number>()
    const landings = [{ eventId: 'US.CPI.RELEASE.2026-M08', releaseAt: released }]
    await expect(notifyMacroEventLandings(submit, landings, seen)).resolves.toBe(1)
    await expect(notifyMacroEventLandings(submit, landings, seen)).resolves.toBe(0)
    expect(submit).toHaveBeenCalledTimes(1)
    // A notification that cannot be submitted must not fail the collection that already stored the data.
    const failing = vi.fn(async () => Promise.reject(new Error('no runtime')))
    await expect(notifyMacroEventLandings(failing, landings, new Map())).resolves.toBe(0)
    await expect(notifyMacroEventLandings(undefined, landings, new Map())).resolves.toBe(0)
  })
})
