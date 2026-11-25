import { describe, expect, it, vi } from 'vitest'

import { buildOptionSkewChainFixture } from './optionSkewChainFixture'
import type { DeribitChainSnapshot, DeribitOptionsClient } from './deribitOptionsClient'
import type { OptionSkewPointStore } from './optionSkewPointStore'
import type { OptionSkewPoint } from './optionSkewPolicy'
import { createOptionSkewRuntime, needsStartupCatchUp } from './optionSkewRuntime'

const NOW_MS = Date.parse('2026-11-22T07:00:00.000Z')

function memoryStore() {
  const points: OptionSkewPoint[] = []
  const failures: string[] = []
  const store: OptionSkewPointStore = {
    load: async () => undefined,
    readSnapshot: () => ({ points }),
    recordPoint: async (point) => { points.push(point) },
    recordFailure: async ({ failureCode }) => { failures.push(failureCode) },
    readState: () => ({ schemaVersion: 1, points, consecutiveFailures: failures.length })
  }
  return { store, points, failures }
}

function clientReturning(snapshot: DeribitChainSnapshot): DeribitOptionsClient {
  return { fetchChain: async () => snapshot, probe: async () => ({ state: 'available' }) }
}

function jobRuntimeStub() {
  return { registerHandler: vi.fn(), setSchedule: vi.fn(), removeSchedule: vi.fn() }
}

describe('needsStartupCatchUp', () => {
  const state = (days: readonly string[]) => ({
    schemaVersion: 1 as const,
    points: days.map((day) => ({ day, observedAt: `${day}T05:00:00.000Z`, riskReversal: 1, putIv25: 60, callIv25: 59, tenorDays: 30 as const, expiries: ['a', 'b'] as const, underlyingPrice: 1 })),
    consecutiveFailures: 0
  })

  it('asks for a round when the store has no day yet', () => {
    expect(needsStartupCatchUp({ state: state([]), nowMs: NOW_MS })).toBe(true)
  })

  it('asks for a round when the newest day is older than today', () => {
    expect(needsStartupCatchUp({ state: state(['2026-11-20', '2026-11-21']), nowMs: NOW_MS })).toBe(true)
  })

  it('stays quiet once today already has a point', () => {
    expect(needsStartupCatchUp({ state: state(['2026-11-21', '2026-11-22']), nowMs: NOW_MS })).toBe(false)
  })
})

describe('option skew runtime', () => {
  it('writes one 30-day point per round', async () => {
    const { store, points } = memoryStore()
    const fixture = buildOptionSkewChainFixture()
    const runtime = createOptionSkewRuntime({
      jobRuntime: jobRuntimeStub() as never,
      store,
      client: clientReturning({ state: 'available', ...fixture, observedAt: new Date(NOW_MS).toISOString() }),
      isEnabled: async () => true
    })
    const result = await runtime.run(NOW_MS)
    expect(result).toEqual({ state: 'recorded', day: '2026-11-22', riskReversal: 6.7 })
    expect(points).toHaveLength(1)
    expect(points[0]).toMatchObject({ day: '2026-11-22', putIv25: 62.7, callIv25: 56, tenorDays: 30 })
  })

  it('does nothing while the reader has the source switched off', async () => {
    const { store, points } = memoryStore()
    const fetchChain = vi.fn()
    const runtime = createOptionSkewRuntime({
      jobRuntime: jobRuntimeStub() as never,
      store,
      client: { fetchChain, probe: async () => ({ state: 'available' }) },
      isEnabled: async () => false
    })
    expect(await runtime.run(NOW_MS)).toEqual({ state: 'disabled' })
    expect(fetchChain).not.toHaveBeenCalled()
    expect(points).toHaveLength(0)
  })

  it('records the failure cause and writes no point when the venue is unreachable', async () => {
    const { store, points, failures } = memoryStore()
    const runtime = createOptionSkewRuntime({
      jobRuntime: jobRuntimeStub() as never,
      store,
      client: clientReturning({ state: 'unavailable', failureCode: 'connection-unavailable' }),
      isEnabled: async () => true,
      now: () => new Date(NOW_MS).toISOString()
    })
    expect(await runtime.run()).toEqual({ state: 'skipped', failureCode: 'connection-unavailable' })
    expect(points).toHaveLength(0)
    expect(failures).toEqual(['connection-unavailable'])
  })

  it('writes no point when the chain has no usable 25Δ bracket', async () => {
    const { store, points, failures } = memoryStore()
    const fixture = buildOptionSkewChainFixture({ expiriesInDays: [25], baseVols: [52] })
    const runtime = createOptionSkewRuntime({
      jobRuntime: jobRuntimeStub() as never,
      store,
      client: clientReturning({ state: 'available', ...fixture, observedAt: new Date(NOW_MS).toISOString() }),
      isEnabled: async () => true
    })
    expect(await runtime.run(NOW_MS)).toEqual({ state: 'skipped', failureCode: 'no-bracketing-expiry' })
    expect(points).toHaveLength(0)
    expect(failures).toEqual(['no-bracketing-expiry'])
  })

  it('arms the hourly schedule on start and drops it when the switch goes off', async () => {
    const { store } = memoryStore()
    const jobRuntime = jobRuntimeStub()
    let enabled = true
    const runtime = createOptionSkewRuntime({
      jobRuntime: jobRuntime as never,
      store,
      client: clientReturning({ state: 'unavailable', failureCode: 'connection-unavailable' }),
      isEnabled: async () => enabled
    })
    runtime.start()
    await vi.waitFor(() => expect(jobRuntime.setSchedule).toHaveBeenCalled())
    expect(jobRuntime.registerHandler).toHaveBeenCalledWith('market-intelligence.collect-option-skew', expect.any(Function))
    const definition = jobRuntime.setSchedule.mock.calls[0]?.[0] as { trigger: { intervalMs: number } }
    expect(definition.trigger.intervalMs).toBe(60 * 60_000)

    enabled = false
    await runtime.sync()
    expect(jobRuntime.removeSchedule).toHaveBeenCalledWith('market-intelligence.collect-option-skew')
  })

  it('probes through the client without pulling a chain', async () => {
    const { store } = memoryStore()
    const probe = vi.fn(async () => ({ state: 'available' as const }))
    const runtime = createOptionSkewRuntime({
      jobRuntime: jobRuntimeStub() as never,
      store,
      client: { fetchChain: vi.fn(), probe },
      isEnabled: async () => true
    })
    expect(await runtime.probe()).toEqual({ state: 'available' })
    expect(probe).toHaveBeenCalledTimes(1)
  })
})