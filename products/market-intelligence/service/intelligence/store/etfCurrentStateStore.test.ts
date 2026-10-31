import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it, vi } from 'vitest'

import { buildEtfCurrentStateWindow, type EtfDailyFlow } from '../etf/etfCurrentStateWindow'
import { createEtfCurrentStateSqliteStorage, createEtfCurrentStateStore, createInMemoryEtfCurrentStateStorage, etfCurrentStateStorePolicy } from './etfCurrentStateStore'

const firstWindow = windowFor(1)
const revisedWindow = windowFor(10)

describe('ETF current-state store', () => {
  it('atomically replaces a valid whole window and preserves a prior snapshot when storage rejects the next one', async () => {
    const storage = createInMemoryEtfCurrentStateStorage()
    const store = createEtfCurrentStateStore({ storage })
    await expect(store.replace({ window: firstWindow, verifiedAt: '2026-08-31T00:00:00.000Z' })).resolves.toEqual({ state: 'updated' })
    const before = await storage.read()
    const failingStore = createEtfCurrentStateStore({
      storage: { read: storage.read, write: vi.fn(async () => { throw new Error('disk unavailable') }) }
    })

    await expect(failingStore.replace({ window: revisedWindow, verifiedAt: '2026-08-31T01:00:00.000Z' }))
      .resolves.toEqual({ state: 'unavailable' })
    await expect(storage.read()).resolves.toEqual(before)
  })

  it('allows a revision replacement only when both windows carry an explicit provider current-state identity', async () => {
    const storage = createInMemoryEtfCurrentStateStorage()
    const store = createEtfCurrentStateStore({ storage })
    await store.replace({ window: firstWindow, verifiedAt: '2026-08-31T00:00:00.000Z' })

    await expect(store.replace({ window: revisedWindow, verifiedAt: '2026-08-31T01:00:00.000Z' }))
      .resolves.toEqual({ state: 'unavailable' })
    expect((await store.read())?.snapshot?.window).toEqual(firstWindow)

    const identifiedStore = createEtfCurrentStateStore({ storage: createInMemoryEtfCurrentStateStorage() })
    await identifiedStore.replace({ window: identifiedWindow(firstWindow, 'revision-1'), verifiedAt: '2026-08-31T00:00:00.000Z' })
    await expect(identifiedStore.replace({ window: identifiedWindow(revisedWindow, 'revision-2'), verifiedAt: '2026-08-31T01:00:00.000Z' }))
      .resolves.toEqual({ state: 'updated' })
  })

  it('keeps a snapshot visible at the product-owned 48-hour boundary and hides it strictly beyond that age', async () => {
    const store = createEtfCurrentStateStore({ storage: createInMemoryEtfCurrentStateStorage() })
    await expect(store.readAvailable({ asOf: '2026-08-31T00:00:00.000Z' })).resolves.toEqual({ state: 'unavailable' })
    await store.replace({ window: firstWindow, verifiedAt: '2026-08-29T00:00:00.000Z' })
    await expect(store.readAvailable({ asOf: '2026-08-31T00:00:00.000Z' })).resolves.toMatchObject({ state: 'available', window: firstWindow })
    await expect(store.readAvailable({ asOf: '2026-08-31T00:00:00.001Z' })).resolves.toEqual({ state: 'unavailable' })
  })

  it('refuses to answer a cutoff with rows the provider observed after it', async () => {
    const store = createEtfCurrentStateStore({ storage: createInMemoryEtfCurrentStateStorage() })
    // The window closed on 08-30, but the provider only published the flows at 05:00Z on 08-31 — after
    // the 08:00 Beijing (00:00Z) cutoff the edition asks about. The window is not a 08:00 reading.
    await store.replace({
      window: windowWithObservedAt(firstWindow, '2026-08-31T05:00:00.000Z'),
      verifiedAt: '2026-08-31T05:00:00.000Z'
    })

    await expect(store.readAvailable({ asOf: '2026-08-31T00:00:00.000Z' })).resolves.toEqual({ state: 'unavailable' })
    // Once the cutoff is after the observation, the same window is a legitimate as-of answer.
    await expect(store.readAvailable({ asOf: '2026-08-31T05:00:00.000Z' })).resolves.toMatchObject({ state: 'available' })
  })

  it('renews verifiedAt without replacing material state when only fetchedAt changes', async () => {
    const store = createEtfCurrentStateStore({ storage: createInMemoryEtfCurrentStateStorage() })
    const initial = identifiedWindow(windowWithFetchedAt(firstWindow, '2026-08-29T00:00:00.000Z'), 'revision-1')
    const refetched = identifiedWindow(windowWithFetchedAt(firstWindow, '2026-08-31T12:00:00.000Z'), 'revision-1')

    await expect(store.replace({ window: initial, verifiedAt: '2026-08-29T00:00:00.000Z' })).resolves.toEqual({ state: 'updated' })
    await expect(store.replace({ window: refetched, verifiedAt: '2026-08-31T12:00:00.000Z' })).resolves.toEqual({ state: 'unchanged' })
    await expect(store.readAvailable({ asOf: '2026-09-02T12:00:00.000Z' })).resolves.toMatchObject({
      state: 'available',
      verifiedAt: '2026-08-31T12:00:00.000Z'
    })
  })

  it('fails closed without caching or exposing a malformed persisted state', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'etf-current-state-'))
    const filePath = join(directory, 'etf-current-state.sqlite')
    const database = new DatabaseSync(filePath)
    database.exec('create table etf_current_state (id integer primary key, schema_version integer not null, window_json text, verified_at text, last_attempt_at text not null, last_success_at text, snapshot_replace_count integer not null, snapshot_no_write_count integer not null, rejection_count integer not null)')
    database.exec("insert into etf_current_state values (1, 1, '{bad-json', '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z', null, 0, 0, 0)")
    database.close()
    const store = createEtfCurrentStateStore({ storage: createEtfCurrentStateSqliteStorage(filePath) })

    await expect(store.read()).resolves.toBeNull()
    await expect(store.readAvailable({ asOf: '2026-08-31T00:00:00.000Z' })).resolves.toEqual({ state: 'unavailable' })
  })

  it('fails closed without caching or exposing an illegal parsed state', async () => {
    const invalidWindow = { ...firstWindow, windowEnd: '2026-08-31' }
    const storage = {
      read: vi.fn(async () => ({
        schemaVersion: 1,
        snapshot: { window: invalidWindow, verifiedAt: '2026-08-31T00:00:00.000Z' },
        health: { lastAttemptAt: '2026-08-31T00:00:00.000Z', lastSuccessAt: '2026-08-31T00:00:00.000Z', snapshotReplaceCount: 1, snapshotNoWriteCount: 0, rejectionCount: 0 }
      })),
      write: vi.fn()
    }
    const store = createEtfCurrentStateStore({ storage })

    await expect(store.read()).rejects.toThrow('ETF current state is unreadable')
    await expect(store.readAvailable({ asOf: '2026-08-31T00:00:00.000Z' })).resolves.toEqual({ state: 'unavailable' })
    expect(storage.write).not.toHaveBeenCalled()
    expect(storage.read).toHaveBeenCalledTimes(2)
  })

  it('fails closed for an otherwise valid state with an unknown persisted field', async () => {
    const storage = {
      read: vi.fn(async () => ({
        schemaVersion: 1,
        snapshot: { window: firstWindow, verifiedAt: '2026-08-31T00:00:00.000Z' },
        health: { lastAttemptAt: '2026-08-31T00:00:00.000Z', lastSuccessAt: '2026-08-31T00:00:00.000Z', snapshotReplaceCount: 1, snapshotNoWriteCount: 0, rejectionCount: 0 },
        unexpected: true
      })),
      write: vi.fn()
    }
    const store = createEtfCurrentStateStore({ storage })

    await expect(store.read()).rejects.toThrow('ETF current state is unreadable')
    await expect(store.readAvailable({ asOf: '2026-08-31T00:00:00.000Z' })).resolves.toEqual({ state: 'unavailable' })
  })

  it('persists and reloads a valid snapshot through the product SQLite storage', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'etf-current-state-sqlite-'))
    const filePath = join(directory, 'etf-current-state.sqlite')
    const first = createEtfCurrentStateStore({ storage: createEtfCurrentStateSqliteStorage(filePath) })
    await expect(first.replace({ window: firstWindow, verifiedAt: '2026-08-31T00:00:00.000Z' })).resolves.toEqual({ state: 'updated' })
    const reloaded = createEtfCurrentStateStore({ storage: createEtfCurrentStateSqliteStorage(filePath) })
    await expect(reloaded.readAvailable({ asOf: '2026-08-31T00:00:00.000Z' })).resolves.toMatchObject({ state: 'available', window: firstWindow })
  })

  it('retains the prior SQLite snapshot when a replacement write fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'etf-current-state-sqlite-failure-'))
    const filePath = join(directory, 'etf-current-state.sqlite')
    const storage = createEtfCurrentStateSqliteStorage(filePath)
    const store = createEtfCurrentStateStore({ storage })
    await expect(store.replace({ window: identifiedWindow(firstWindow, 'one'), verifiedAt: '2026-08-31T00:00:00.000Z' })).resolves.toEqual({ state: 'updated' })
    const database = new DatabaseSync(filePath)
    database.exec("create trigger reject_etf_update before update on etf_current_state begin select raise(abort, 'write failed'); end")
    await expect(store.replace({ window: identifiedWindow(revisedWindow, 'two'), verifiedAt: '2026-08-31T01:00:00.000Z' })).resolves.toEqual({ state: 'unavailable' })
    database.close()
    const reloaded = createEtfCurrentStateStore({ storage: createEtfCurrentStateSqliteStorage(filePath) })
    await expect(reloaded.readAvailable({ asOf: '2026-08-31T00:00:00.000Z' })).resolves.toMatchObject({ state: 'available', window: firstWindow })
  })

  it('answers an instant from the archived rows after the window was refreshed past it', async () => {
    const storage = createInMemoryEtfCurrentStateStorage()
    const store = createEtfCurrentStateStore({ storage })
    const start = Date.parse('2026-10-30T00:00:00.000Z')

    for (let hour = 0; hour <= 38; hour += 1) {
      const at = new Date(start + hour * 60 * 60 * 1_000).toISOString()
      await expect(store.replace({ window: identifiedWindow(windowAt(at, hour), `revision-${hour}`), verifiedAt: at })).resolves.toEqual({ state: 'updated' })
    }

    // The newest refresh observed every row at 14:00Z, after the 00:00Z cutoff, so the current
    // window cannot answer the cutoff at all; the archived rows from the cutoff can.
    const current = await storage.read()
    expect(current?.snapshot?.window.btc[0]?.observedAt).toBe('2026-10-31T14:00:00.000Z')
    const cutoff = '2026-10-31T00:00:00.000Z'
    const result = await store.readAvailable({ asOf: cutoff })
    expect(result).toMatchObject({ state: 'available', verifiedAt: cutoff })
    expect(result.state === 'available' ? result.window.btc[0]?.netFlowUsd : undefined).toBe(24)
    expect(result.state === 'available' ? result.window.btc.map((row) => row.observedAt) : [])
      .toEqual(Array.from({ length: 5 }, () => cutoff))
  })

  it('keeps thirty hours of archived rows and drops anything older', async () => {
    const storage = createInMemoryEtfCurrentStateStorage()
    const store = createEtfCurrentStateStore({ storage })
    const end = Date.parse('2026-10-31T13:00:00.000Z')

    for (let hour = 0; hour <= 40; hour += 1) {
      const at = new Date(end - (40 - hour) * 60 * 60 * 1_000).toISOString()
      await store.replace({ window: identifiedWindow(windowAt(at, hour), `revision-${hour}`), verifiedAt: at })
    }

    const history = (await storage.read())?.history ?? []
    expect(history.length).toBeGreaterThan(0)
    const first = Date.parse(history[0]!.at)
    // A point at the thirty-hour mark is answerable; the physical horizon adds one thinning bucket.
    expect(end - first).toBeGreaterThanOrEqual(30 * 60 * 60 * 1_000)
    expect(end - first).toBeLessThanOrEqual(31 * 60 * 60 * 1_000)
    await expect(store.readAvailable({ asOf: new Date(end - 30 * 60 * 60 * 1_000).toISOString() }))
      .resolves.toMatchObject({ state: 'available', verifiedAt: new Date(end - 30 * 60 * 60 * 1_000).toISOString() })
    // Beyond the horizon the archive is empty and the rows observed later cannot stand in.
    await expect(store.readAvailable({ asOf: new Date(end - 34 * 60 * 60 * 1_000).toISOString() }))
      .resolves.toEqual({ state: 'unavailable' })
  })

  it('keeps a maximum-size window archive inside the state byte budget', async () => {
    const storage = createInMemoryEtfCurrentStateStorage()
    const store = createEtfCurrentStateStore({ storage })
    const end = Date.parse('2026-10-31T13:00:00.000Z')

    for (let half = 0; half <= 96; half += 1) {
      const at = new Date(end - (96 - half) * 30 * 60 * 1_000).toISOString()
      await expect(store.replace({ window: identifiedWindow(windowAt(at, half, 30), `revision-${half}`), verifiedAt: at })).resolves.toEqual({ state: 'updated' })
    }

    const state = await storage.read()
    const bytes = Buffer.byteLength(JSON.stringify(state), 'utf8')
    expect(bytes).toBeLessThanOrEqual(etfCurrentStateStorePolicy.maximumStateBytes)
    expect(bytes * 2).toBeLessThanOrEqual(etfCurrentStateStorePolicy.maximumAtomicDiskBytes)
    expect(state?.history?.length ?? 0).toBeLessThanOrEqual(etfCurrentStateStorePolicy.maximumHistoryEntries)
    // The budget is met without losing the thirty-hour window.
    expect(end - Date.parse(state!.history![0]!.at)).toBeGreaterThanOrEqual(30 * 60 * 60 * 1_000)
  })

  it('upgrades a SQLite state written before the archive existed without losing its window', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'etf-current-state-legacy-'))
    const filePath = join(directory, 'etf-current-state.sqlite')
    const database = new DatabaseSync(filePath)
    database.exec('create table etf_current_state (id integer primary key, schema_version integer not null, window_json text, verified_at text, last_attempt_at text not null, last_success_at text, snapshot_replace_count integer not null, snapshot_no_write_count integer not null, rejection_count integer not null)')
    database.prepare('insert into etf_current_state values (1, 1, ?, ?, ?, ?, 1, 0, 0)')
      .run(JSON.stringify(identifiedWindow(firstWindow, 'revision-legacy')), '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z')
    database.close()

    const store = createEtfCurrentStateStore({ storage: createEtfCurrentStateSqliteStorage(filePath) })
    await expect(store.readAvailable({ asOf: '2026-08-31T00:00:00.000Z' })).resolves.toMatchObject({ state: 'available', window: firstWindow })
    await expect(store.replace({ window: identifiedWindow(firstWindow, 'revision-new'), verifiedAt: '2026-08-31T01:00:00.000Z' }))
      .resolves.toEqual({ state: 'updated' })

    // The upgrade adds the archive column in place and seeds the window the old file already held.
    const reloaded = createEtfCurrentStateStore({ storage: createEtfCurrentStateSqliteStorage(filePath) })
    const persisted = await reloaded.read()
    expect(persisted?.snapshot?.verifiedAt).toBe('2026-08-31T01:00:00.000Z')
    expect(persisted?.history?.map((entry) => entry.at)).toEqual(['2026-08-31T00:00:00.000Z', '2026-08-31T01:00:00.000Z'])
    await expect(reloaded.readAvailable({ asOf: '2026-08-31T00:00:00.000Z' }))
      .resolves.toMatchObject({ state: 'available', verifiedAt: '2026-08-31T00:00:00.000Z' })
    await rm(directory, { recursive: true, force: true })
  })
})

function windowAt(observedAt: string, offset: number, rowCount = 5) {
  // The window ends on the instant's UTC trading date, so every generated as-of is admissible.
  const lastDay = Date.parse(`${observedAt.slice(0, 10)}T00:00:00.000Z`)
  const dates = Array.from({ length: rowCount }, (_, index) =>
    new Date(lastDay - (rowCount - 1 - index) * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10))
  const rows = (asset: 'BTC' | 'ETH') => dates.map((tradingDate, index) => ({
    asset, tradingDate, netFlowUsd: (asset === 'BTC' ? 1 : -1) * (offset + index),
    observedAt, fetchedAt: observedAt, source: '0xrouter' as const
  }))
  const built = buildEtfCurrentStateWindow({
    asOf: observedAt, completeThrough: dates.at(-1)!, completeDates: dates,
    btc: rows('BTC'), eth: rows('ETH')
  })
  if (built.state !== 'available') throw new Error('test window must be available')
  return built.window
}

function windowFor(offset: number) {
  const result = buildEtfCurrentStateWindow({
    asOf: '2026-08-31T00:00:00.000Z',
    completeThrough: '2026-08-30',
    completeDates: flows('BTC', offset).map((flow) => flow.tradingDate),
    btc: flows('BTC', offset),
    eth: flows('ETH', offset)
  })
  if (result.state !== 'available') throw new Error('test window must be available')
  return result.window
}

function identifiedWindow(window: ReturnType<typeof windowFor>, revision: string) {
  return { ...window, revision: { providerCurrentStateId: revision } }
}

function windowWithFetchedAt(window: ReturnType<typeof windowFor>, fetchedAt: string) {
  return {
    ...window,
    btc: window.btc.map((flow) => ({ ...flow, fetchedAt })),
    eth: window.eth.map((flow) => ({ ...flow, fetchedAt }))
  }
}

function windowWithObservedAt(window: ReturnType<typeof windowFor>, observedAt: string) {
  return {
    ...window,
    btc: window.btc.map((flow) => ({ ...flow, observedAt })),
    eth: window.eth.map((flow) => ({ ...flow, observedAt }))
  }
}

function flows(asset: 'BTC' | 'ETH', offset: number): readonly EtfDailyFlow[] {
  return Array.from({ length: 5 }, (_, index) => ({
    asset,
    tradingDate: new Date(Date.parse('2026-08-26T00:00:00.000Z') + index * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10),
    netFlowUsd: (asset === 'BTC' ? 1 : -1) * (offset + index),
    observedAt: '2026-08-31T00:00:00.000Z',
    fetchedAt: '2026-08-31T00:00:00.000Z',
    source: '0xrouter'
  }))
}
