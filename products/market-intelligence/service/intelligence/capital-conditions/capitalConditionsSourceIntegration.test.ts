import { describe, expect, it, vi } from 'vitest'

import { createCapitalConditionsSourceIntegration } from './capitalConditionsSourceIntegration'

describe('capital conditions source integration', () => {
  it('delegates the special source refresh and probe without exposing a generic pipeline path', async () => {
    const refresh = vi.fn(async () => ({ state: 'updated' as const }))
    const probe = vi.fn(async () => ({ state: 'available' as const }))
    const integration = createCapitalConditionsSourceIntegration({ refreshService: { refresh, probe } })

    await expect(integration.refresh()).resolves.toEqual({ state: 'updated' })
    await expect(integration.probe()).resolves.toEqual({ ok: true })
    expect(refresh).toHaveBeenCalledOnce()
    expect(probe).toHaveBeenCalledOnce()
  })

  it('redacts a failed refresh and a throwing probe', async () => {
    const integration = createCapitalConditionsSourceIntegration({
      refreshService: {
        refresh: async () => ({ state: 'unavailable' }),
        probe: async () => { throw new Error('transport detail') }
      }
    })

    await expect(integration.refresh()).resolves.toEqual({ state: 'unavailable' })
    await expect(integration.probe()).resolves.toEqual({ ok: false })
  })

  it('projects only bounded current health for the source settings service', async () => {
    const integration = createCapitalConditionsSourceIntegration({
      refreshService: { refresh: async () => ({ state: 'unavailable' }), probe: async () => ({ state: 'unavailable' }) },
      readHealth: async () => ({ status: 'degraded', lastSuccessAt: '2026-08-18T10:00:00.000Z', consecutiveFailures: 2 })
    })

    await expect(integration.getHealth(true)).resolves.toEqual({
      runtimeStatus: 'degraded', lastSuccessAt: '2026-08-18T10:00:00.000Z', consecutiveFailures: 2
    })
    await expect(integration.getHealth(false)).resolves.toEqual({ runtimeStatus: 'paused', consecutiveFailures: 0 })
  })
})
