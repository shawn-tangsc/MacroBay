// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'

import { macroCalendarProviderClient } from './macroCalendarProviderClient'

describe('macroCalendarProviderClient', () => {
  it('rebuilds the fixed provider page state and redacts runtime extension fields', async () => {
    window.platform = {
      products: {
        invoke: vi.fn(async () => ({
          state: 'available',
          providers: [
            { providerId: 'macro-calendar-fed', enabled: false, scheduleHealth: 'never-run', consecutiveFailures: 0 },
            { providerId: 'macro-calendar-bea', enabled: true, scheduleHealth: 'healthy', lastCompletedAt: '2026-08-05T00:00:00.000Z', consecutiveFailures: 0 }
          ], sourceUrl: 'https://secret.example.test', credential: 'secret'
        }))
      }
    } as never

    await expect(macroCalendarProviderClient.getPageState()).resolves.toEqual({ state: 'unavailable', failureCode: 'provider-settings-unavailable' })
  })

  it('returns exact safe provider state when every fixed card is coherent', async () => {
    window.platform = {
      products: {
        invoke: vi.fn(async () => ({
          state: 'available',
          providers: [
            { providerId: 'macro-calendar-fed', enabled: false, scheduleHealth: 'never-run', consecutiveFailures: 0 },
            { providerId: 'macro-calendar-bea', enabled: true, scheduleHealth: 'healthy', lastCompletedAt: '2026-08-05T00:00:00.000Z', consecutiveFailures: 0 }
          ]
        }))
      }
    } as never

    await expect(macroCalendarProviderClient.getPageState()).resolves.toEqual({
      state: 'available',
      providers: [
        { providerId: 'macro-calendar-fed', enabled: false, scheduleHealth: 'never-run', consecutiveFailures: 0 },
        { providerId: 'macro-calendar-bea', enabled: true, scheduleHealth: 'healthy', lastCompletedAt: '2026-08-05T00:00:00.000Z', consecutiveFailures: 0 }
      ]
    })
  })

  it('rejects an invalid save input before invoking IPC', async () => {
    const invoke = vi.fn()
    window.platform = { products: { invoke } } as never

    await expect(macroCalendarProviderClient.saveProfile({ providerId: 'macro-calendar-bls' as never, enabled: true })).resolves.toEqual({ state: 'failed', failureCode: 'provider-settings-unavailable' })
    expect(invoke).not.toHaveBeenCalled()
  })

  it.each([
    [{ state: 'completed', providerId: 'macro-calendar-fed', outcome: 'succeeded' }, { state: 'completed', providerId: 'macro-calendar-fed', outcome: 'succeeded' }],
    [{ state: 'completed', providerId: 'macro-calendar-fed', outcome: 'failed' }, { state: 'completed', providerId: 'macro-calendar-fed', outcome: 'failed' }],
    [{ state: 'completed', providerId: 'macro-calendar-bea', outcome: 'succeeded', extra: 'secret' }, { state: 'failed', failureCode: 'provider-settings-unavailable' }]
  ])('rebuilds only the compact completion outcome %o', async (response, expected) => {
    window.platform = { products: { invoke: vi.fn(async () => response) } } as never
    await expect(macroCalendarProviderClient.runProviderNow('macro-calendar-fed')).resolves.toEqual(expected)
  })

  it('resolves unavailable for a Proxy result whose reflection trap throws', async () => {
    const result = new Proxy({}, { getPrototypeOf() { throw new Error('secret') } })
    window.platform = { products: { invoke: vi.fn(async () => result) } } as never

    await expect(macroCalendarProviderClient.runProviderNow('macro-calendar-fed')).resolves.toEqual({ state: 'failed', failureCode: 'provider-settings-unavailable' })
  })

  it('uses only the provider-scoped connection method and rebuilds its compact result', async () => {
    const invoke = vi.fn(async () => ({ state: 'succeeded' }))
    window.platform = { products: { invoke } } as never
    const client = macroCalendarProviderClient as unknown as {
      testProviderConnection: (providerId: 'macro-calendar-fed' | 'macro-calendar-bea') => Promise<unknown>
    }

    await expect(client.testProviderConnection('macro-calendar-fed')).resolves.toEqual({ state: 'succeeded' })
    expect(invoke).toHaveBeenCalledWith('market-intelligence', 'intelligence.macro.economicCalendar.testProviderConnection', { providerId: 'macro-calendar-fed' })
    expect(invoke).not.toHaveBeenCalledWith('market-intelligence', 'intelligence.macro.economicCalendar.testProviderCredential', expect.anything())
  })

  it.each([
    [{ state: 'failed', failureCode: 'transport-unavailable' }, { state: 'failed', failureCode: 'transport-unavailable' }],
    [{ state: 'failed', failureCode: 'credential-not-configured' }, { state: 'failed', failureCode: 'response-unavailable' }],
    [{ state: 'succeeded', sourceUrl: 'https://secret.example.test' }, { state: 'failed', failureCode: 'response-unavailable' }]
  ])('fails closed for hostile provider connection result %o', async (response, expected) => {
    window.platform = { products: { invoke: vi.fn(async () => response) } } as never
    const client = macroCalendarProviderClient as unknown as {
      testProviderConnection: (providerId: 'macro-calendar-fed' | 'macro-calendar-bea') => Promise<unknown>
    }

    await expect(client.testProviderConnection('macro-calendar-fed')).resolves.toEqual(expected)
  })

  it('fails closed for a throwing provider connection proxy', async () => {
    const response = new Proxy({}, { getPrototypeOf: () => { throw new Error('untrusted') } })
    window.platform = { products: { invoke: vi.fn(async () => response) } } as never
    const client = macroCalendarProviderClient as unknown as { testProviderConnection: (providerId: 'macro-calendar-fed') => Promise<unknown> }
    await expect(client.testProviderConnection('macro-calendar-fed')).resolves.toEqual({ state: 'failed', failureCode: 'response-unavailable' })
  })

  it('rebuilds the provider-scoped shared schedule without local defaults', async () => {
    const invoke = vi.fn(async () => ({
      state: 'available', providerId: 'macro-calendar-fed',
      schedule: { mode: 'interval', intervalSeconds: 21600, anchor: 'last-complete', startupCatchUp: true, runNowAvailable: true }
    }))
    window.platform = { products: { invoke } } as never
    const client = macroCalendarProviderClient as unknown as {
      getProviderSchedule: (providerId: 'macro-calendar-fed' | 'macro-calendar-bea') => Promise<unknown>
    }

    await expect(client.getProviderSchedule('macro-calendar-fed')).resolves.toEqual({
      state: 'available', providerId: 'macro-calendar-fed',
      schedule: { mode: 'interval', intervalSeconds: 21600, anchor: 'last-complete', startupCatchUp: true, runNowAvailable: true }
    })
    expect(invoke).toHaveBeenCalledWith('market-intelligence', 'intelligence.macro.economicCalendar.getProviderSchedule', { providerId: 'macro-calendar-fed' })
  })

  it('rejects a hostile schedule response without recreating a renderer default', async () => {
    const invoke = vi.fn(async () => ({
      state: 'available', providerId: 'macro-calendar-fed',
      schedule: { mode: 'interval', intervalSeconds: 21600, anchor: 'last-complete', startupCatchUp: true, runNowAvailable: true, extension: true }
    }))
    window.platform = { products: { invoke } } as never

    await expect(macroCalendarProviderClient.getProviderSchedule('macro-calendar-fed')).resolves.toEqual({ state: 'unavailable', failureCode: 'provider-settings-unavailable' })
  })
})
