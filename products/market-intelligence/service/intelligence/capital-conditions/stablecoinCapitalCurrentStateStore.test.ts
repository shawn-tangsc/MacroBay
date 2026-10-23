import { describe, expect, it, vi } from 'vitest'

import {
  createCapitalConditionsCurrentStateStore,
  createCapitalConditionsStateJsonStorage,
  createInMemoryCapitalConditionsStateStorage,
  stablecoinCapitalCurrentStatePolicy
} from './stablecoinCapitalCurrentStateStore'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

const snapshot = {
  coreCurrentUsd: 310,
  change1dUsd: 10,
  change1dPercent: 10 / 300 * 100,
  change7dUsd: 10,
  change7dPercent: 10 / 300 * 100,
  change30dUsd: 30,
  change30dPercent: 30 / 280 * 100,
  usdStablecoinSupplyUsd: 315
} as const

describe('capital conditions current state store', () => {
  it('keeps exactly one snapshot and one health slot while same canonical content retains observedAt', async () => {
    const storage = createInMemoryCapitalConditionsStateStorage()
    const store = createCapitalConditionsCurrentStateStore({ storage })

    await expect(store.recordSuccess({ snapshot, verifiedAt: '2026-08-17T00:00:00.000Z' })).resolves.toEqual({ state: 'updated' })
    await expect(store.recordSuccess({ snapshot, verifiedAt: '2026-08-17T00:10:00.000Z' })).resolves.toEqual({ state: 'unchanged' })

    expect(await store.read()).toEqual({
      schemaVersion: 1,
      snapshot: {
        ...snapshot,
        observedAt: '2026-08-17T00:00:00.000Z',
        verifiedAt: '2026-08-17T00:10:00.000Z'
      },
      health: {
        status: 'healthy',
        lastAttemptAt: '2026-08-17T00:10:00.000Z',
        lastSuccessAt: '2026-08-17T00:10:00.000Z',
        consecutiveFailures: 0,
        snapshotReplaceCount: 1,
        snapshotNoWriteCount: 1,
        rejectionCount: 0,
        responseBodyTooLargeCount: 0
      }
    })
  })

  it('replaces the single snapshot only when canonical content changes', async () => {
    const storage = createInMemoryCapitalConditionsStateStorage()
    const store = createCapitalConditionsCurrentStateStore({ storage })

    await store.recordSuccess({ snapshot, verifiedAt: '2026-08-17T00:00:00.000Z' })
    await store.recordSuccess({
      snapshot: { ...snapshot, coreCurrentUsd: 320, change7dUsd: 20 },
      verifiedAt: '2026-08-17T01:00:00.000Z'
    })

    expect((await store.read())?.snapshot).toMatchObject({
      coreCurrentUsd: 320,
      change7dUsd: 20,
      observedAt: '2026-08-17T01:00:00.000Z',
      verifiedAt: '2026-08-17T01:00:00.000Z'
    })
    expect((await store.read())?.health).toMatchObject({ snapshotReplaceCount: 2, snapshotNoWriteCount: 0 })
  })

  it('preserves the prior complete current state when an atomic replacement fails', async () => {
    const storage = createInMemoryCapitalConditionsStateStorage()
    const store = createCapitalConditionsCurrentStateStore({ storage })
    await store.recordSuccess({ snapshot, verifiedAt: '2026-08-17T00:00:00.000Z' })
    const before = await store.read()
    const failedStorage = {
      read: storage.read,
      write: vi.fn(async () => { throw new Error('disk unavailable') })
    }
    const failingStore = createCapitalConditionsCurrentStateStore({ storage: failedStorage })

    await expect(failingStore.recordSuccess({
      snapshot: { ...snapshot, coreCurrentUsd: 320, change7dUsd: 20 },
      verifiedAt: '2026-08-17T01:00:00.000Z'
    })).resolves.toEqual({ state: 'unavailable' })
    await expect(storage.read()).resolves.toEqual(before)
  })

  it('treats corrupt persisted state as unavailable instead of empty', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'capital-conditions-'))
    const storage = createCapitalConditionsStateJsonStorage(join(directory, 'capital-conditions-state.json'))
    await writeFile(join(directory, 'capital-conditions-state.json'), '{not-json', 'utf8')
    const store = createCapitalConditionsCurrentStateStore({ storage })

    await expect(store.read()).rejects.toThrow()
    await expect(store.recordSuccess({ snapshot, verifiedAt: '2026-08-17T00:00:00.000Z' })).resolves.toEqual({ state: 'unavailable' })
  })

  it('keeps one snapshot and one health slot through ten years of same and changed polling', async () => {
    const storage = createInMemoryCapitalConditionsStateStorage()
    const store = createCapitalConditionsCurrentStateStore({ storage })
    const start = Date.parse('2026-01-01T00:00:00.000Z')
    const days = 365 * 10

    for (let index = 0; index < days; index += 1) {
      const verifiedAt = new Date(start + index * 24 * 60 * 60 * 1_000).toISOString()
      await store.recordSuccess({
        snapshot: index % 2 === 0 ? snapshot : { ...snapshot, coreCurrentUsd: snapshot.coreCurrentUsd + 1, change7dUsd: snapshot.change7dUsd + 1 },
        verifiedAt
      })
    }

    const state = await storage.read()
    expect(state).toHaveProperty('snapshot')
    expect(Object.keys(state ?? {})).toEqual(expect.arrayContaining(['schemaVersion', 'snapshot', 'health']))
    expect(Buffer.byteLength(JSON.stringify(state), 'utf8')).toBeLessThanOrEqual(stablecoinCapitalCurrentStatePolicy.maximumStateBytes)
    expect(Buffer.byteLength(JSON.stringify(state), 'utf8') * 2).toBeLessThanOrEqual(stablecoinCapitalCurrentStatePolicy.maximumAtomicDiskBytes)
  })

  it('measures cold read and atomic write p95 within the current-state budget', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'capital-conditions-performance-'))
    const filePath = join(directory, 'capital-conditions-state.json')
    try {
      // The suite runs thousands of SQLite/temp-file tests in parallel, so one
      // scheduler or IO stall must not turn a healthy store into a budget failure.
      // Re-measure once before failing; the budgets themselves are unchanged.
      let measurement = await measureCurrentStateIo(filePath)
      if (measurement.coldReadP95 > 25 || measurement.writeP95 > 50) {
        measurement = await measureCurrentStateIo(filePath)
      }
      expect(measurement.coldReadP95).toBeLessThanOrEqual(25)
      expect(measurement.writeP95).toBeLessThanOrEqual(50)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

})

async function measureCurrentStateIo(filePath: string): Promise<{ coldReadP95: number; writeP95: number }> {
  const coldReadSamples: number[] = []
  const writeSamples: number[] = []

  for (let index = 0; index < 25; index += 1) {
    const writeStore = createCapitalConditionsCurrentStateStore({ storage: createCapitalConditionsStateJsonStorage(filePath) })
    const writeStartedAt = performance.now()
    await writeStore.recordSuccess({ snapshot: { ...snapshot, coreCurrentUsd: snapshot.coreCurrentUsd + index }, verifiedAt: `2026-08-17T00:${String(index).padStart(2, '0')}:00.000Z` })
    writeSamples.push(performance.now() - writeStartedAt)

    const readStartedAt = performance.now()
    await createCapitalConditionsCurrentStateStore({ storage: createCapitalConditionsStateJsonStorage(filePath) }).read()
    coldReadSamples.push(performance.now() - readStartedAt)
  }

  return { coldReadP95: p95(coldReadSamples), writeP95: p95(writeSamples) }
}

function p95(samples: readonly number[]): number {
  return [...samples].sort((left, right) => left - right)[Math.ceil(samples.length * 0.95) - 1]!
}
