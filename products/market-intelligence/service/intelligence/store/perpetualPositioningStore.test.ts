import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  createPerpetualPositioningSqliteStore,
  perpetualPositioningStoragePolicy
} from './perpetualPositioningStore'

const collectedAt = '2026-10-29T00:00:00.000Z'
const bucket = (minutesAgo: number) => Date.UTC(2026, 9, 29, 0, 0) - minutesAgo * 60_000

async function open() {
  const directory = await mkdtemp(join(tmpdir(), 'perpetual-positioning-'))
  const path = join(directory, perpetualPositioningStoragePolicy.fileName)
  return { path, store: createPerpetualPositioningSqliteStore(path) }
}

describe('perpetual positioning store', () => {
  it('writes open interest, reports unchanged when nothing moved, and updates a revised bucket', async () => {
    const { store } = await open()
    const row = { observedMs: bucket(15), notionalUsd: 8_000_000_000 }
    expect(await store.upsert({ asset: 'btc', rows: [row], collectedAt })).toEqual({ state: 'updated' })
    expect(await store.upsert({ asset: 'btc', rows: [row], collectedAt })).toEqual({ state: 'unchanged' })
    expect(await store.upsert({ asset: 'btc', rows: [{ ...row, notionalUsd: 8_100_000_000 }], collectedAt })).toEqual({ state: 'updated' })

    const read = await store.read({ asOf: collectedAt, bars: 10 })
    expect(read.state).toBe('available')
    if (read.state !== 'available') return
    expect(read.btc).toEqual([{ observedAt: new Date(bucket(15)).toISOString(), notionalUsd: 8_100_000_000, volumeBase: null, closePrice: null }])
  })

  it('lets the K-line leg decorate an existing bucket without creating one', async () => {
    const { store } = await open()
    await store.upsert({ asset: 'btc', rows: [{ observedMs: bucket(30), notionalUsd: 8e9 }], collectedAt })

    expect(await store.upsertVolume({ asset: 'btc', rows: [{ observedMs: bucket(30), volumeBase: 1_200, closePrice: 79_500 }], collectedAt })).toEqual({ state: 'updated' })
    expect(await store.upsertVolume({ asset: 'btc', rows: [{ observedMs: bucket(30), volumeBase: 1_200, closePrice: 79_500 }], collectedAt })).toEqual({ state: 'unchanged' })
    // A bucket the open-interest leg never saw stays absent rather than half-existing.
    expect(await store.upsertVolume({ asset: 'btc', rows: [{ observedMs: bucket(45), volumeBase: 1, closePrice: 1 }], collectedAt })).toEqual({ state: 'unchanged' })

    const read = await store.read({ asOf: collectedAt, bars: 10 })
    if (read.state !== 'available') throw new Error('expected rows')
    expect(read.btc).toHaveLength(1)
    expect(read.btc[0]).toMatchObject({ volumeBase: 1_200, closePrice: 79_500 })
  })

  it('decides the incremental limit from the newest stored bucket', async () => {
    const { store } = await open()
    await store.upsert({ asset: 'btc', rows: [{ observedMs: bucket(30), notionalUsd: 8e9 }, { observedMs: bucket(15), notionalUsd: 8.1e9 }], collectedAt })
    expect(await store.readNewestMs({ asset: 'btc', asOf: Date.parse(collectedAt) })).toBe(bucket(15))
    expect(await store.readNewestMs({ asset: 'eth', asOf: Date.parse(collectedAt) })).toBeUndefined()
    expect(await store.readNewestMs({ asset: 'btc', asOf: bucket(20) })).toBe(bucket(30))
  })

  it('truncates by asOf and returns the newest bars ascending', async () => {
    const { store } = await open()
    await store.upsert({
      asset: 'btc',
      rows: [1, 2, 3].map(index => ({ observedMs: bucket(index * 15), notionalUsd: 8e9 + index })),
      collectedAt
    })
    const read = await store.read({ asOf: new Date(bucket(30)).toISOString(), bars: 10 })
    if (read.state !== 'available') throw new Error('expected rows')
    expect(read.btc.map(row => row.notionalUsd)).toEqual([8e9 + 3, 8e9 + 2])
    expect(read.eth).toEqual([])
  })

  it('reports empty for an empty window and unavailable for a bad instant', async () => {
    const { store } = await open()
    expect(await store.read({ asOf: collectedAt, bars: 10 })).toEqual({ state: 'empty' })
    expect(await store.read({ asOf: '2026-10-29T00:00:00Z', bars: 10 })).toEqual({ state: 'unavailable' })
    expect(await store.read({ asOf: collectedAt, bars: 0 })).toEqual({ state: 'unavailable' })
  })

  it('rejects rows it could not have written', async () => {
    const { store } = await open()
    expect(await store.upsert({ asset: 'btc', rows: [{ observedMs: 1, notionalUsd: Number.NaN }], collectedAt })).toEqual({ state: 'unavailable' })
    expect(await store.upsert({ asset: 'btc', rows: [{ observedMs: 1, notionalUsd: -1 }], collectedAt })).toEqual({ state: 'unavailable' })
    expect(await store.upsert({ asset: 'btc', rows: [{ observedMs: 1, notionalUsd: 1 }, { observedMs: 1, notionalUsd: 2 }], collectedAt })).toEqual({ state: 'unavailable' })
    expect(await store.upsert({ asset: 'btc', rows: [], collectedAt: 'yesterday' })).toEqual({ state: 'unavailable' })
    expect(await store.upsertVolume({ asset: 'btc', rows: [{ observedMs: 1, volumeBase: -1, closePrice: 1 }], collectedAt })).toEqual({ state: 'unavailable' })
    expect(await store.upsertVolume({ asset: 'btc', rows: [{ observedMs: 1, volumeBase: 1, closePrice: 0 }], collectedAt })).toEqual({ state: 'unavailable' })
  })

  it('prunes buckets older than the retention window', async () => {
    const { store } = await open()
    const ancient = Date.parse(collectedAt) - (perpetualPositioningStoragePolicy.retentionDays + 1) * 86_400_000
    await store.upsert({ asset: 'btc', rows: [{ observedMs: ancient, notionalUsd: 1 }], collectedAt })
    store.prune(Date.parse(collectedAt) - perpetualPositioningStoragePolicy.retentionDays * 86_400_000)
    expect(await store.read({ asOf: collectedAt, bars: 10 })).toEqual({ state: 'empty' })
  })
})
