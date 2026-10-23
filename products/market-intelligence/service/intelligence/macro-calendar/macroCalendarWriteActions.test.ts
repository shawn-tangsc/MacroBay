import { describe, expect, it, vi } from 'vitest'

import { createMacroCalendarWriteActions } from './macroCalendarWriteActions'

const manualBlsIcs = {
  preview: () => ({ state: 'failed', failureCode: 'invalid-file' }),
  import: () => ({ state: 'failed', failureCode: 'invalid-file' })
} as never

function actions(overrides: Parameters<typeof createMacroCalendarWriteActions>[0] = { manualBlsIcs }) {
  return createMacroCalendarWriteActions(overrides)
}

describe('macro calendar release time actions', () => {
  it('applies a saved release time to the synchronous cache', async () => {
    const saved = {
      eventKey: 'US.CPI.RELEASE.2026-M09',
      scheduledAt: '2026-09-10T12:30:00.000Z',
      scheduledDate: '2026-09-10',
      updatedAt: '2026-09-01T00:00:00.000Z'
    }
    const apply = vi.fn()
    const write = actions({
      manualBlsIcs,
      connection: {
        releaseTimeOverrideStore: { set: async () => saved, clear: async () => true } as never,
        releaseTimeOverrides: { apply, remove: vi.fn() } as never
      }
    })

    await expect(
      write.setReleaseTime({
        eventKey: saved.eventKey,
        scheduledAt: saved.scheduledAt,
        scheduledDate: saved.scheduledDate
      })
    ).resolves.toEqual({
      state: 'saved',
      scheduledAt: saved.scheduledAt,
      scheduledDate: saved.scheduledDate
    })
    expect(apply).toHaveBeenCalledWith(saved)
  })

  it('reports a rejected pair instead of throwing', async () => {
    const write = actions({
      manualBlsIcs,
      connection: {
        releaseTimeOverrideStore: { set: async () => undefined, clear: async () => true } as never
      }
    })

    await expect(
      write.setReleaseTime({
        eventKey: 'US.CPI.RELEASE.2026-M09',
        scheduledAt: '2026-09-10T12:30:00.000Z',
        scheduledDate: '2026-09-10'
      })
    ).resolves.toEqual({ state: 'rejected' })

    await expect(
      write.setReleaseTime({ eventKey: 'x', scheduledAt: 'not-an-instant', scheduledDate: '2026-09-10' })
    ).resolves.toEqual({ state: 'rejected' })
  })

  it('removes the cache entry only when the store actually cleared one', async () => {
    const remove = vi.fn()
    const clear = vi.fn(async () => false)
    const write = actions({
      manualBlsIcs,
      connection: {
        releaseTimeOverrideStore: { set: async () => undefined, clear } as never,
        releaseTimeOverrides: { apply: vi.fn(), remove } as never
      }
    })

    await expect(write.clearReleaseTime({ eventKey: 'US.CPI.RELEASE.2026-M09' })).resolves.toEqual({
      state: 'cleared'
    })
    expect(clear).toHaveBeenCalledWith('US.CPI.RELEASE.2026-M09')
    expect(remove).not.toHaveBeenCalled()

    clear.mockResolvedValueOnce(true)
    await write.clearReleaseTime({ eventKey: 'US.CPI.RELEASE.2026-M09' })
    expect(remove).toHaveBeenCalledWith('US.CPI.RELEASE.2026-M09')
  })
})

describe('macro calendar provider actions', () => {
  const provider = {
    providerId: 'macro-calendar-fed' as const,
    enabled: true,
    scheduleHealth: 'healthy' as const,
    consecutiveFailures: 0
  }

  it('returns the sanitized saved provider result', async () => {
    const write = actions({
      manualBlsIcs,
      providerSettings: { saveProfile: async () => ({ state: 'saved', provider }) } as never
    })

    await expect(
      write.saveProviderProfile({ providerId: 'macro-calendar-fed', enabled: true })
    ).resolves.toEqual({ state: 'saved', provider })
  })

  it('turns a throwing provider service into its failure shape instead of raising', async () => {
    const write = actions({
      manualBlsIcs,
      providerSettings: {
        saveProfile: async () => {
          throw new Error('boom')
        },
        runProviderNow: async () => {
          throw new Error('boom')
        }
      } as never,
      connection: {
        testProviderConnection: async () => {
          throw new Error('boom')
        }
      }
    })

    await expect(
      write.saveProviderProfile({ providerId: 'macro-calendar-fed', enabled: true })
    ).resolves.toEqual({ state: 'failed', failureCode: 'provider-settings-unavailable' })
    await expect(write.runProviderNow({ providerId: 'macro-calendar-fed' })).resolves.toEqual({
      state: 'failed',
      failureCode: 'provider-settings-unavailable'
    })
    await expect(write.testProviderConnection({ providerId: 'macro-calendar-fed' })).resolves.toEqual({
      state: 'failed',
      failureCode: 'response-unavailable'
    })
  })

  it('rejects a provider id outside the settings contract', async () => {
    const write = actions({ manualBlsIcs })

    await expect(write.runProviderNow({ providerId: 'macro-calendar-bls' })).resolves.toEqual({
      state: 'failed',
      failureCode: 'provider-settings-unavailable'
    })
  })
})

describe('macro calendar refresh actions', () => {
  it('seals a throwing refresh into the unavailable state', async () => {
    const write = actions({
      manualBlsIcs,
      blsEmploymentRefresh: {
        refresh: async () => {
          throw new Error('boom')
        }
      } as never,
      fedFomcRefresh: {
        refresh: async () => {
          throw new Error('boom')
        }
      } as never,
      blsEmploymentSchedule: {
        sync: async () => {
          throw new Error('boom')
        }
      } as never
    })

    await expect(
      write.refreshBlsEmployment({ eventKey: 'US.NONFARM_PAYROLLS.RELEASE.2026-M09', confirmed: true })
    ).resolves.toEqual({ state: 'unavailable' })
    await expect(
      write.refreshFedFomc({ eventKey: 'US.FOMC.2026-09-16', confirmed: true })
    ).resolves.toEqual({ state: 'unavailable' })
    await expect(write.syncBlsSchedule({ year: '2026' })).resolves.toEqual({ state: 'unavailable' })
  })

  it('rejects a model-supplied confirmation that is not the typed literal', async () => {
    const refresh = vi.fn(async () => ({ state: 'updated' }))
    const write = actions({ manualBlsIcs, blsEmploymentRefresh: { refresh } as never })

    await expect(
      write.refreshBlsEmployment({ eventKey: 'US.NONFARM_PAYROLLS.RELEASE.2026-M09', confirmed: false })
    ).resolves.toEqual({ state: 'unavailable' })
    expect(refresh).not.toHaveBeenCalled()
  })
})
