import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it, vi } from 'vitest'

import { buildEtfCurrentStateWindow, type EtfDailyFlow } from '../etf/etfCurrentStateWindow'
import { createEtfCurrentStateSqliteStorage, createEtfCurrentStateStore, createInMemoryEtfCurrentStateStorage } from './etfCurrentStateStore'

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
})

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
