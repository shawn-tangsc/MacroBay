import { describe, expect, it } from 'vitest'

import { createInMemoryMacroCalendarProviderHealthStorage, createMacroCalendarProviderHealthStore } from './macroCalendarProviderHealthStore'

describe('macroCalendarProviderHealthStore', () => {
  it('persists current state and material history through store recreation', async () => {
    const storage = createInMemoryMacroCalendarProviderHealthStorage()
    const first = createMacroCalendarProviderHealthStore(storage)
    await first.appendMaterialChange({ providerId: 'macro-calendar-bls', status: 'healthy', updatedAt: '2026-08-01T00:00:00.000Z', lastSuccessAt: '2026-08-01T00:00:00.000Z', consecutiveFailures: 0, checkpoint: { parserVersion: 'fixture-v1' } })

    const reloaded = createMacroCalendarProviderHealthStore(storage)
    expect((await reloaded.getCurrent('macro-calendar-bls'))?.status).toBe('healthy')
    expect((await reloaded.getAsOf('macro-calendar-bls', '2026-08-01T00:00:00.000Z')).state?.checkpoint.parserVersion).toBe('fixture-v1')
  })

  it('never returns current health for invalid as-of values and compares equivalent offsets semantically', () => {
    const health = createMacroCalendarProviderHealthStore()
    health.appendMaterialChange({ providerId: 'macro-calendar-bls', status: 'healthy', updatedAt: '2026-08-01T08:00:00.000Z', consecutiveFailures: 0, checkpoint: {} })
    health.appendMaterialChange({ providerId: 'macro-calendar-bls', status: 'degraded', updatedAt: '2026-08-01T09:00:00+02:00', consecutiveFailures: 1, checkpoint: {} })

    expect(health.getAsOf('macro-calendar-bls', 'not-a-date')).toEqual({ state: undefined, caveat: 'source-health-history-truncated' })
    expect(health.getAsOf('macro-calendar-bls', '2026-08-01T16:00:00+08:00').state?.status).toBe('healthy')
    expect(health.getAsOf('macro-calendar-bls', '2026-08-01T09:30:00+02:00').state?.status).toBe('degraded')
  })
})
