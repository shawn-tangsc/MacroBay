import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

import {
  createFundingRateHistorySqliteStore,
  fundingRateHistoryStoragePolicy
} from './fundingRateHistoryStore'

const collectedAt = '2026-09-03T00:00:00.000Z'
const first = point('btc', 1, 0.01)

describe('funding rate history SQLite store', () => {
  it('persists, reloads, de-duplicates, and updates a revised asset-time row', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'funding-rate-history-'))
    const path = join(directory, fundingRateHistoryStoragePolicy.fileName)
    const firstStore = createFundingRateHistorySqliteStore(path)

    await expect(firstStore.upsert({ btc: [first], eth: [point('eth', 1, -0.02)], collectedAt })).resolves.toEqual({ state: 'updated' })
    await expect(firstStore.upsert({ btc: [first], eth: [point('eth', 1, -0.02)], collectedAt })).resolves.toEqual({ state: 'unchanged' })
    await expect(firstStore.upsert({ btc: [point('btc', 1, 0.03)], eth: [point('eth', 1, -0.02)], collectedAt })).resolves.toEqual({ state: 'updated' })

    const reloaded = createFundingRateHistorySqliteStore(path)
    await expect(reloaded.read({ asOf: '2026-09-03T01:00:00.000Z' })).resolves.toEqual({
      state: 'available',
      btc: [{ observedAt: '2026-09-03T00:00:00.001Z', ratePercent: 0.03 }],
      eth: [{ observedAt: '2026-09-03T00:00:00.001Z', ratePercent: -0.02 }]
    })
  })

  it('returns each asset in ascending as-of order with at most the named maximum and preserves prior rows on a transaction failure', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'funding-rate-history-failure-'))
    const path = join(directory, fundingRateHistoryStoragePolicy.fileName)
    const store = createFundingRateHistorySqliteStore(path)
    const btc = Array.from({ length: fundingRateHistoryStoragePolicy.maximumPointsPerAsset + 1 }, (_, index) => point('btc', index, index / 100))
    await store.upsert({ btc: btc.slice(0, fundingRateHistoryStoragePolicy.maximumPointsPerAsset), eth: [point('eth', 0, 0)], collectedAt })
    await store.upsert({ btc: [btc.at(-1)!], eth: [], collectedAt })

    await expect(store.read({ asOf: '2026-09-03T00:00:00.021Z' })).resolves.toEqual({
      state: 'available',
      btc: btc.slice(0, fundingRateHistoryStoragePolicy.maximumPointsPerAsset).map(({ fundingTimeMs, ratePercent }) => ({ observedAt: new Date(fundingTimeMs).toISOString(), ratePercent })),
      eth: [{ observedAt: '2026-09-03T00:00:00.000Z', ratePercent: 0 }]
    })
    await expect(store.read({ asOf: '2026-09-02T23:59:59.999Z' })).resolves.toEqual({ state: 'empty' })

    const database = new DatabaseSync(path)
    database.exec("create trigger reject_funding_rate_insert before insert on funding_rate_history begin select raise(abort, 'write failed'); end")
    await expect(store.upsert({ btc: [point('btc', 50, 0.5)], eth: [point('eth', 50, -0.5)], collectedAt })).resolves.toEqual({ state: 'unavailable' })
    database.close()
    await expect(createFundingRateHistorySqliteStore(path).read({ asOf: '2026-09-03T01:00:00.000Z' })).resolves.toMatchObject({ state: 'available', btc: expect.arrayContaining([{ observedAt: '2026-09-03T00:00:00.021Z', ratePercent: 0.21 }]) })
  })
})

function point(asset: 'btc' | 'eth', offsetMs: number, ratePercent: number) {
  return { asset, fundingTimeMs: Date.parse('2026-09-03T00:00:00.000Z') + offsetMs, ratePercent }
}
