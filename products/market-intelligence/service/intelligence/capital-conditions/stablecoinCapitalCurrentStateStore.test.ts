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
  it('keeps the current snapshot and bounded history while same content retains observedAt', async () => {
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
      history: [
        { ...snapshot, observedAt: '2026-08-17T00:00:00.000Z', verifiedAt: '2026-08-17T00:00:00.000Z' },
        { ...snapshot, observedAt: '2026-08-17T00:00:00.000Z', verifiedAt: '2026-08-17T00:10:00.000Z' }
      ],
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

  it('keeps thirty hours of points by age and drops anything older', async () => {
    const storage = createInMemoryCapitalConditionsStateStorage()
    const store = createCapitalConditionsCurrentStateStore({ storage })
    const end = Date.parse('2026-10-31T13:00:00.000Z')
    const start = end - 40 * 60 * 60 * 1_000

    for (let at = start; at <= end; at += tenMinutesMs) {
      await store.recordSuccess({ snapshot: { ...snapshot, coreCurrentUsd: at / 1_000 }, verifiedAt: new Date(at).toISOString() })
    }

    const history = await store.readHistory()
    const first = Date.parse(history[0]!.verifiedAt)
    // A point at or before the thirty-hour mark is still there; the physical horizon adds one
    // thinning bucket so bucket thinning cannot shorten the promised coverage.
    expect(history.some((entry) => Date.parse(entry.verifiedAt) <= end - 30 * 60 * 60 * 1_000)).toBe(true)
    expect(end - first).toBeGreaterThanOrEqual(30 * 60 * 60 * 1_000)
    expect(end - first).toBeLessThanOrEqual(31 * 60 * 60 * 1_000)
    // Nothing older than the physical horizon survives.
    expect(history.every((entry) => end - Date.parse(entry.verifiedAt) <= 31 * 60 * 60 * 1_000)).toBe(true)
  })

  it('thins the span older than the dense window to one point per hour', async () => {
    const storage = createInMemoryCapitalConditionsStateStorage()
    const store = createCapitalConditionsCurrentStateStore({ storage })
    const end = Date.parse('2026-10-31T13:00:00.000Z')

    for (let at = end - 40 * 60 * 60 * 1_000; at <= end; at += tenMinutesMs) {
      await store.recordSuccess({ snapshot, verifiedAt: new Date(at).toISOString() })
    }

    const history = await store.readHistory()
    const denseFloor = end - stablecoinCapitalCurrentStatePolicy.historyDenseMs
    const older = history.filter((entry) => Date.parse(entry.verifiedAt) < denseFloor)
    const buckets = new Map<number, number>()
    for (const entry of older) {
      const bucket = Math.floor(Date.parse(entry.verifiedAt) / (60 * 60 * 1_000))
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1)
    }
    // 31h physical horizon minus the 8h dense span leaves 23 hourly buckets.
    expect(older.length).toBe(23)
    expect([...buckets.values()].every((count) => count === 1)).toBe(true)
  })

  it('keeps a maximum-size snapshot history inside the state byte budget', async () => {
    const storage = createInMemoryCapitalConditionsStateStorage()
    const store = createCapitalConditionsCurrentStateStore({ storage })
    const end = Date.parse('2026-10-31T13:00:00.000Z')
    const heavy = { ...snapshot, coreCurrentUsd: 123456789012.345, usdStablecoinSupplyUsd: 123456789012.345, dailyFlows: maximalDailyFlows() }

    for (let at = end - 40 * 60 * 60 * 1_000; at <= end; at += tenMinutesMs) {
      await store.recordSuccess({ snapshot: heavy, verifiedAt: new Date(at).toISOString() })
    }

    const state = await storage.read()
    const bytes = Buffer.byteLength(JSON.stringify(state), 'utf8')
    expect(bytes).toBeLessThanOrEqual(stablecoinCapitalCurrentStatePolicy.maximumStateBytes)
    expect(bytes * 2).toBeLessThanOrEqual(stablecoinCapitalCurrentStatePolicy.maximumAtomicDiskBytes)
    // The budget is met by thinning and trimming, not by losing the thirty-hour window.
    const history = await store.readHistory()
    expect(end - Date.parse(history[0]!.verifiedAt)).toBeGreaterThanOrEqual(30 * 60 * 60 * 1_000)
  })

  it('reads a state file written before history existed and keeps its snapshot', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'capital-conditions-legacy-'))
    const filePath = join(directory, 'capital-conditions-state.json')
    const legacySnapshot = { ...snapshot, observedAt: '2026-10-30T23:50:00.000Z', verifiedAt: '2026-10-30T23:50:00.000Z' }
    await writeFile(filePath, JSON.stringify({
      schemaVersion: 1,
      snapshot: legacySnapshot,
      health: {
        status: 'healthy', lastAttemptAt: '2026-10-30T23:50:00.000Z', lastSuccessAt: '2026-10-30T23:50:00.000Z',
        consecutiveFailures: 0, snapshotReplaceCount: 1, snapshotNoWriteCount: 0, rejectionCount: 0, responseBodyTooLargeCount: 0
      }
    }), 'utf8')

    // The old shape is read as the old behaviour: the current snapshot is present and queryable.
    await expect(createCapitalConditionsCurrentStateStore({ storage: createCapitalConditionsStateJsonStorage(filePath) }).read())
      .resolves.toHaveProperty('snapshot', legacySnapshot)
    const upgraded = createCapitalConditionsCurrentStateStore({ storage: createCapitalConditionsStateJsonStorage(filePath) })
    await expect(upgraded.recordSuccess({ snapshot: { ...snapshot, coreCurrentUsd: 320 }, verifiedAt: '2026-10-31T13:00:00.000Z' }))
      .resolves.toEqual({ state: 'updated' })

    // The first write after the upgrade seeds the legacy point into history so a cutoff can still
    // read it, and the file stays readable on the next cold load.
    const history = await upgraded.readHistory()
    expect(history.map((entry) => entry.verifiedAt)).toEqual(['2026-10-30T23:50:00.000Z', '2026-10-31T13:00:00.000Z'])
    await expect(createCapitalConditionsCurrentStateStore({ storage: createCapitalConditionsStateJsonStorage(filePath) }).read())
      .resolves.toHaveProperty('snapshot.verifiedAt', '2026-10-31T13:00:00.000Z')
    await rm(directory, { recursive: true, force: true })
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

const tenMinutesMs = 10 * 60 * 1_000

/** The largest daily-flow series the contract accepts, so a history point is at its byte ceiling. */
function maximalDailyFlows(): readonly { tradingDate: string; netFlowUsd: number }[] {
  const firstDay = Date.parse('2026-09-01T00:00:00.000Z')
  return Array.from({ length: 30 }, (_, index) => ({
    tradingDate: new Date(firstDay + index * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10),
    netFlowUsd: -1234567890.123456
  }))
}
