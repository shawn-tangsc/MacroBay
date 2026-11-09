import { describe, expect, it, vi } from 'vitest'

import type { MacroCalendarRevision } from '../macroCalendarContracts'
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

/**
 * 形状 2：夹具从真实的 `MacroCalendarRevision` 取形状（`Partial` 只放宽用例要改的那几个字段），
 * 不再用 `Record<string, unknown>` 展开——那会把每个字段拓宽成 unknown，整个对象不满足仓储端口。
 */
function schedule(overrides: Partial<MacroCalendarRevision> = {}): MacroCalendarRevision {
  return {
    revisionId: 'revision-1',
    eventKey,
    releaseGroupKey: eventKey,
    eventFamily: 'fomc',
    eventNameKey: 'fomc',
    countryCode: 'US',
    importance: 'high',
    periodKey: '2026-M07',
    lifecycleState: 'scheduled',
    revisionKind: 'schedule',
    scheduledDate: '2026-07-29',
    detectedAt: now,
    recordedAt: now,
    providerId: 'macro-calendar-fed',
    descriptorId: 'fed-fomc',
    sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
    evidenceHash: 'evidence-hash',
    evidenceRefs: [],
    snapshotHash: 'snapshot-hash',
    parserVersion: 'v1',
    caveats: [],
    ...overrides
  }
}
