import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  createDailyBriefFactEnsureJsonCache,
  createInMemoryDailyBriefFactEnsureCache,
  dailyBriefFactEnsureKey,
  type DailyBriefFactEnsureEntry
} from './dailyBriefFactEnsureCache'

const asOf = '2026-10-30T00:00:00.000Z'
const at = '2026-10-30T00:30:00.000Z'

function entry(overrides: Partial<DailyBriefFactEnsureEntry> = {}): DailyBriefFactEnsureEntry {
  return {
    editionDate: '2026-10-30',
    metric: 'core-stablecoin-supply-usd',
    asOf,
    state: 'available',
    source: 'stablecoin',
    lastAttemptAt: at,
    lastSuccessAt: at,
    attempts: 0,
    value: 253_000_000_000,
    unit: 'usd',
    observedAt: '2026-10-29T00:00:00.000Z',
    sourceUrl: 'https://stablecoins.llama.fi/stablecoin/1',
    method: 'historical-api',
    ...overrides
  }
}

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function cacheFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'daily-brief-ensure-'))
  directories.push(directory)
  return join(directory, 'daily-brief-fact-ensure.json')
}

describe('daily brief fact ensure cache', () => {
  it('round-trips entries through the file and keys by edition, metric and asOf', async () => {
    const file = await cacheFile()
    const first = createDailyBriefFactEnsureJsonCache(file)
    await first.put(entry())

    const second = createDailyBriefFactEnsureJsonCache(file)
    const key = dailyBriefFactEnsureKey(entry())
    expect(await second.get(key)).toEqual(entry())
    expect(await second.get(dailyBriefFactEnsureKey({ ...entry(), asOf: '2026-10-31T00:00:00.000Z' }))).toBeUndefined()
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ version: 1 })
  })

  it('prunes editions older than the retention boundary', async () => {
    const cache = createInMemoryDailyBriefFactEnsureCache()
    await cache.put(entry({ editionDate: '2026-10-16' }))
    await cache.put(entry({ editionDate: '2026-10-17', asOf: '2026-10-17T00:00:00.000Z' }))

    await cache.prune('2026-10-17')
    expect((await cache.entries()).map((item) => item.editionDate)).toEqual(['2026-10-17'])
  })

  it('drops malformed entries and a corrupt file instead of trusting them', async () => {
    const file = await cacheFile()
    await writeFile(file, JSON.stringify({
      version: 1,
      entries: {
        [dailyBriefFactEnsureKey(entry())]: { ...entry(), metric: 'not-a-metric' },
        [dailyBriefFactEnsureKey({ ...entry(), asOf: '2026-10-29T00:00:00.000Z' })]: {
          ...entry({ asOf: '2026-10-29T00:00:00.000Z' }),
          observedAt: '2026-10-30T00:00:00.000Z'
        }
      }
    }), 'utf8')

    expect(await createDailyBriefFactEnsureJsonCache(file).entries()).toEqual([])
    await writeFile(file, '{not-json', 'utf8')
    expect(await createDailyBriefFactEnsureJsonCache(file).entries()).toEqual([])
  })

  it('keeps a failure entry usable as a named gap', async () => {
    const cache = createInMemoryDailyBriefFactEnsureCache()
    await cache.put(entry({
      state: 'unavailable',
      attempts: 2,
      gapCode: 'historical-api-unavailable',
      detail: 'the provider refused the request.',
      value: undefined,
      unit: undefined,
      observedAt: undefined,
      sourceUrl: undefined,
      method: undefined,
      lastSuccessAt: undefined
    }))

    const stored = await cache.get(dailyBriefFactEnsureKey(entry()))
    expect(stored).toMatchObject({ state: 'unavailable', attempts: 2, gapCode: 'historical-api-unavailable' })
    expect(stored?.value).toBeUndefined()
  })
})
