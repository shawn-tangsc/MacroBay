import { describe, expect, it, vi } from 'vitest'

import { createFedFomcManualRefreshService } from './fedFomcManualRefreshService'

const now = '2026-08-13T08:00:00.000Z'
const eventKey = 'US.FOMC.2026-07-29'

describe('Fed FOMC manual refresh', () => {
  it('refreshes only an existing confirmed past Fed FOMC date-only schedule', async () => {
    const refresh = vi.fn(async () => ({ state: 'updated' as const }))
    const service = createFedFomcManualRefreshService({
      repository: { getEffectiveEventAsOf: vi.fn(() => schedule()) },
      refresh: { refresh },
      now: () => now
    })

    await expect(service.refresh({ eventKey, confirmed: true })).resolves.toEqual({ state: 'updated' })
    expect(refresh).toHaveBeenCalledWith({
      detectedAt: now, expectedEventKey: eventKey, runId: 'manual-fomc-decision-refresh:US.FOMC.2026-07-29'
    })
  })

  it.each([
    ['unconfirmed input', { eventKey, confirmed: false }, schedule()],
    ['future FOMC schedule', { eventKey: 'US.FOMC.2026-12-09', confirmed: true }, schedule({ eventKey: 'US.FOMC.2026-12-09', scheduledDate: '2026-12-09' })],
    ['non-FOMC schedule', { eventKey, confirmed: true }, schedule({ eventFamily: 'cpi' })],
    ['non-Fed schedule', { eventKey, confirmed: true }, schedule({ providerId: 'macro-calendar-bls' })],
    ['timed schedule', { eventKey, confirmed: true }, schedule({ scheduledAt: '2026-07-29T18:00:00.000Z' })],
    ['cancelled schedule', { eventKey, confirmed: true }, schedule({ lifecycleState: 'cancelled' })]
  ])('does not refresh a %s', async (_label, input, event) => {
    const refresh = vi.fn(async () => ({ state: 'updated' as const }))
    const service = createFedFomcManualRefreshService({
      repository: { getEffectiveEventAsOf: vi.fn(() => event) },
      refresh: { refresh },
      now: () => now
    })

    await expect(service.refresh(input)).resolves.toEqual({ state: 'unavailable' })
    expect(refresh).not.toHaveBeenCalled()
  })
})

function schedule(overrides: Record<string, unknown> = {}) {
  return {
    eventKey, releaseGroupKey: eventKey, eventFamily: 'fomc', scheduledDate: '2026-07-29', scheduledAt: undefined,
    lifecycleState: 'scheduled', providerId: 'macro-calendar-fed', ...overrides
  }
}
