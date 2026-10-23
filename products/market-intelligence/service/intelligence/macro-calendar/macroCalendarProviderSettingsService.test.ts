import { describe, expect, it, vi } from 'vitest'

import { createMacroCalendarProviderSettingsService } from './macroCalendarProviderSettingsService'

describe('macroCalendarProviderSettingsService', () => {
  it('returns fixed default-disabled Fed and BEA cards in product order', async () => {
    const service = createMacroCalendarProviderSettingsService({
      profiles: { list: vi.fn(async () => []) },
      health: { getCurrent: vi.fn(() => undefined) },
      jobs: { initialize: vi.fn(async () => undefined), runProviderNow: vi.fn(async () => ({ state: 'queued' })) }
    })

    await expect(service.getPageState()).resolves.toEqual({
      state: 'available',
      providers: [
        { providerId: 'macro-calendar-fed', enabled: false, scheduleHealth: 'never-run', consecutiveFailures: 0 },
        { providerId: 'macro-calendar-bea', enabled: false, scheduleHealth: 'never-run', consecutiveFailures: 0 }
      ]
    })
  })

  it.each([
    { sourceUrl: 'https://secret.example.test/?credential=raw' },
    'not-a-profile-list',
    null
  ])('rejects a malformed profile list without leaking its runtime fields', async (profiles) => {
    const service = createMacroCalendarProviderSettingsService({
      profiles: { list: vi.fn(async () => profiles as never) },
      health: { getCurrent: vi.fn(() => undefined) },
      jobs: { initialize: vi.fn(async () => undefined), runProviderNow: vi.fn(async () => ({ state: 'queued' })) }
    })

    const result = await service.getPageState()

    expect(result).toEqual({ state: 'unavailable', failureCode: 'provider-settings-unavailable' })
    expect(JSON.stringify(result)).not.toMatch(/https?:|credential|raw/i)
  })

  it('saves a fixed enabled provider, reconciles jobs, and rejects a disabled run without enqueueing', async () => {
    let enabled = false
    const save = vi.fn(async (input: { providerId: string; enabled: boolean }) => ({ ...input, updatedAt: '2026-08-05T00:00:00.000Z' }))
    const initialize = vi.fn(async () => undefined)
    const runProviderNow = vi.fn(async () => ({ state: 'queued' as const }))
    const service = createMacroCalendarProviderSettingsService({
      profiles: { list: vi.fn(async () => enabled ? [{ providerId: 'macro-calendar-bea', enabled: true }] : []), save: vi.fn(async (input) => { enabled = input.enabled; return save(input) }) },
      health: { getCurrent: vi.fn(() => undefined) },
      jobs: { initialize, runProviderNow }
    })

    await expect(service.saveProfile({ providerId: 'macro-calendar-bea', enabled: true })).resolves.toEqual({
      state: 'saved',
      provider: { providerId: 'macro-calendar-bea', enabled: true, scheduleHealth: 'never-run', consecutiveFailures: 0 }
    })
    await expect(service.runProviderNow('macro-calendar-fed')).resolves.toEqual({ state: 'skipped', failureCode: 'provider-disabled' })
    expect(save).toHaveBeenCalledWith({ providerId: 'macro-calendar-bea', enabled: true })
    expect(initialize).toHaveBeenCalledOnce()
    expect(runProviderNow).not.toHaveBeenCalled()
  })

  it('reconstructs safe health only and returns unavailable on secret-bearing dependency state', async () => {
    const service = createMacroCalendarProviderSettingsService({
      profiles: { list: vi.fn(async () => [{ providerId: 'macro-calendar-fed', enabled: true, updatedAt: '2026-08-05T00:00:00.000Z' }]) },
      health: { getCurrent: vi.fn(() => ({ status: 'healthy', lastSuccessAt: '2026-08-05T00:00:00.000Z', consecutiveFailures: 0, sourceUrl: 'https://secret.example.test' })) },
      jobs: { initialize: vi.fn(async () => undefined), runProviderNow: vi.fn(async () => ({ state: 'queued' })) }
    })

    await expect(service.getPageState()).resolves.toEqual({ state: 'unavailable', failureCode: 'provider-settings-unavailable' })
  })

  it('fails closed for a non-plain provider health dependency value', async () => {
    const foreignHealth = Object.assign(Object.create({ inherited: 'foreign' }), {
      providerId: 'macro-calendar-fed', status: 'healthy', updatedAt: '2026-08-05T00:00:00.000Z',
      consecutiveFailures: 0, lastSuccessAt: '2026-08-05T00:00:00.000Z', lastFailureAt: undefined,
      checkpoint: {}, safeSummary: undefined
    })
    const service = createMacroCalendarProviderSettingsService({
      profiles: { list: vi.fn(async () => [{ providerId: 'macro-calendar-fed', enabled: true }]) },
      health: { getCurrent: vi.fn((providerId) => providerId === 'macro-calendar-fed' ? foreignHealth : undefined) },
      jobs: { initialize: vi.fn(async () => undefined), runProviderNow: vi.fn(async () => ({ state: 'queued' })) }
    })

    await expect(service.getPageState()).resolves.toEqual({ state: 'unavailable', failureCode: 'provider-settings-unavailable' })
  })

  it.each([
    [{ state: 'completed', outcome: 'succeeded' }, { state: 'completed', providerId: 'macro-calendar-fed', outcome: 'succeeded' }],
    [{ state: 'completed', outcome: 'failed' }, { state: 'completed', providerId: 'macro-calendar-fed', outcome: 'failed' }]
  ])('maps an exact runtime completion outcome %j', async (runtimeResult, expected) => {
    const service = createMacroCalendarProviderSettingsService({
      profiles: { list: vi.fn(async () => [{ providerId: 'macro-calendar-fed', enabled: true }]) },
      health: { getCurrent: vi.fn(() => undefined) },
      jobs: { initialize: vi.fn(async () => undefined), runProviderNow: vi.fn(async () => runtimeResult as never) }
    })

    await expect(service.runProviderNow('macro-calendar-fed')).resolves.toEqual(expected)
  })

  it('fails closed for an invalid accepted runtime result and a disabled profile after completion', async () => {
    const profiles = vi.fn()
      .mockResolvedValueOnce([{ providerId: 'macro-calendar-fed', enabled: true }])
      .mockResolvedValueOnce([{ providerId: 'macro-calendar-fed', enabled: false }])
    const service = createMacroCalendarProviderSettingsService({
      profiles: { list: profiles },
      health: { getCurrent: vi.fn(() => undefined) },
      jobs: { initialize: vi.fn(async () => undefined), runProviderNow: vi.fn(async () => ({ state: 'completed', outcome: 'succeeded' } as never)) }
    })

    await expect(service.runProviderNow('macro-calendar-fed')).resolves.toEqual({ state: 'failed', failureCode: 'provider-settings-unavailable' })

    profiles.mockResolvedValueOnce([{ providerId: 'macro-calendar-fed', enabled: true }])
    const invalid = createMacroCalendarProviderSettingsService({
      profiles: { list: vi.fn(async () => [{ providerId: 'macro-calendar-fed', enabled: true }]) },
      health: { getCurrent: vi.fn(() => undefined) },
      jobs: { initialize: vi.fn(async () => undefined), runProviderNow: vi.fn(async () => ({ state: 'completed', providerId: 'macro-calendar-fed', outcome: 'succeeded', extra: 'secret' } as never)) }
    })
    await expect(invalid.runProviderNow('macro-calendar-fed')).resolves.toEqual({ state: 'failed', failureCode: 'provider-settings-unavailable' })
  })

  it('derives the compact shared macro schedule rule from the runtime policy', async () => {
    const service = createMacroCalendarProviderSettingsService({
      profiles: { list: vi.fn(async () => []) },
      health: { getCurrent: vi.fn(() => undefined) },
      jobs: { initialize: vi.fn(async () => undefined), runProviderNow: vi.fn(async () => ({ state: 'queued' })) }
    }) as unknown as { getProviderSchedule: (providerId: unknown) => Promise<unknown> }

    await expect(service.getProviderSchedule('macro-calendar-fed')).resolves.toEqual({
      state: 'available', providerId: 'macro-calendar-fed', schedule: {
        mode: 'interval', intervalSeconds: 21_600, anchor: 'last-complete', startupCatchUp: true, runNowAvailable: true
      }
    })
  })
})
