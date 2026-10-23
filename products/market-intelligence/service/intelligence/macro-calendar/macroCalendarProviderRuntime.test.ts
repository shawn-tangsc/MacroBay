import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import { macroCalendarHealthHistoryPolicy } from './macroCalendarPolicy'
import { createMacroCalendarProviderHealthStore } from './macroCalendarProviderHealthStore'
import { createMacroCalendarProviderProfileStore, createInMemoryMacroCalendarProviderProfileStorage, macroCalendarProviderDefinitions } from './macroCalendarProviderProfileStore'
import { createMacroCalendarProviderRuntime } from './macroCalendarProviderRuntime'

describe('macro calendar provider state', () => {
  it('exposes exactly the three approved providers and only changes enablement', async () => {
    const store = createMacroCalendarProviderProfileStore(createInMemoryMacroCalendarProviderProfileStorage([{
      providerId: 'macro-calendar-bea', enabled: false, credentialRef: 'opaque-vault-ref', updatedAt: '2026-08-01T00:00:00.000Z'
    }]))
    expect(macroCalendarProviderDefinitions.map((provider) => provider.providerId)).toEqual(['macro-calendar-fed', 'macro-calendar-bls', 'macro-calendar-bea'])
    const saved = await store.save({ providerId: 'macro-calendar-bea', enabled: true })
    expect(saved).toMatchObject({ providerId: 'macro-calendar-bea', enabled: true, credentialRef: 'opaque-vault-ref' })
    expectTypeOf(store.save).parameter(0).toEqualTypeOf<{ providerId: 'macro-calendar-fed' | 'macro-calendar-bls' | 'macro-calendar-bea'; enabled: boolean }>()
    expect(JSON.stringify(await store.list())).not.toContain('credential-value')
  })

  it('keeps material-change health history bounded and never uses current state for expired historical queries', () => {
    const health = createMacroCalendarProviderHealthStore()
    for (let index = 0; index <= macroCalendarHealthHistoryPolicy.providerHealthHistoryMaxEntriesPerProvider; index += 1) {
      health.appendMaterialChange({ providerId: 'macro-calendar-fed', status: index % 2 === 0 ? 'healthy' : 'degraded', updatedAt: `2026-08-01T00:${String(index % 60).padStart(2, '0')}:00.000Z`, consecutiveFailures: index, checkpoint: { successfulEventKeys: Array.from({ length: 60 }, (_, key) => `event-${key}`) }, safeSummary: 'x'.repeat(macroCalendarHealthHistoryPolicy.providerHealthSafeSummaryMaxChars + 1) })
    }
    const old = health.getAsOf('macro-calendar-fed', '2026-07-01T00:00:00.000Z')
    const current = health.getCurrent('macro-calendar-fed')
    expect(old).toEqual({ state: undefined, caveat: 'source-health-history-truncated' })
    expect(current?.checkpoint.successfulEventKeys).toHaveLength(macroCalendarHealthHistoryPolicy.providerHealthCheckpointEventKeyLimit)
    expect(current?.safeSummary).toHaveLength(macroCalendarHealthHistoryPolicy.providerHealthSafeSummaryMaxChars)
  })

  it('coordinates only the dedicated schedule and provider-scoped manual work', async () => {
    const profiles = createMacroCalendarProviderProfileStore(createInMemoryMacroCalendarProviderProfileStorage())
    const upsertSchedule = vi.fn()
    const removeSchedule = vi.fn()
    const enqueueManual = vi.fn()
    const runtime = createMacroCalendarProviderRuntime({ profiles, upsertSchedule, removeSchedule, enqueueManual })

    await runtime.reconcile()
    expect(removeSchedule).toHaveBeenCalledOnce()
    await profiles.save({ providerId: 'macro-calendar-fed', enabled: true })
    await runtime.reconcile()
    expect(upsertSchedule).toHaveBeenCalledOnce()
    await profiles.save({ providerId: 'macro-calendar-fed', enabled: false })
    await runtime.reconcile()
    expect(removeSchedule).toHaveBeenCalledTimes(2)
    await runtime.runNow('macro-calendar-fed')
    expect(enqueueManual).toHaveBeenCalledWith('macro-calendar-fed')
  })
})
