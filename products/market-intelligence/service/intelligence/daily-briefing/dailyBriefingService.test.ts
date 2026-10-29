import { describe, expect, it } from 'vitest'

import type { DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { DailyBriefingFactPacket } from './dailyBriefingFactPacket'
import {
  createDailyBriefingService,
  localDate,
  type DailyBriefingSource,
  type DailyBriefingStore,
  type DailyBriefingStoredEdition
} from './dailyBriefingService'

const asOf = '2026-10-30T00:30:00.000Z'

const emptyPacket = (): DailyBriefingFactPacket => ({
  asOf, windowStart: '2026-10-29T00:30:00.000Z', windowEnd: asOf,
  locale: 'zh-CN', timeZone: 'Asia/Shanghai',
  conclusion: null,
  news: { state: 'empty', items: [] },
  calendar: { state: 'source-disabled', events: [] },
  readings: {
    fearGreed: { state: 'empty', asOf },
    funding: { state: 'empty', asOf },
    capital: { state: 'empty', asOf }
  },
  market: {},
  enabled: { fearGreed: false, funding: false, stablecoin: false, etf: false, calendar: false }
})

function memoryStore(): DailyBriefingStore & { rows: Map<string, DailyBriefingStoredEdition>; pruned: string[] } {
  const rows = new Map<string, DailyBriefingStoredEdition>()
  const pruned: string[] = []
  const key = (date: string, locale: string) => `${date}:${locale}`
  return {
    rows,
    pruned,
    async get(date, locale) { return rows.get(key(date, locale)) },
    async put(edition) { rows.set(key(edition.date, edition.locale), edition) },
    async list(from, to, locale) {
      return [...rows.values()].filter((row) => row.locale === locale && row.date >= from && row.date <= to)
    },
    async prune(beforeDate) { pruned.push(beforeDate) }
  }
}

function fakeSource(packet: () => DailyBriefingFactPacket = emptyPacket): DailyBriefingSource & { calls: number } {
  const source = {
    calls: 0,
    async buildPacket() { source.calls += 1; return packet() }
  }
  return source
}

describe('daily briefing service', () => {
  it('derives the local edition date from the requested zone', () => {
    expect(localDate('2026-10-30T00:30:00.000Z', 'Asia/Shanghai')).toBe('2026-10-30')
    expect(localDate('2026-10-29T20:00:00.000Z', 'Asia/Shanghai')).toBe('2026-10-30')
    expect(localDate('not-a-time', 'UTC')).toBeUndefined()
    expect(localDate(asOf, 'Not/AZone')).toBe('2026-10-30')
  })

  it('generates today once, stores it and prunes the retention window', async () => {
    const store = memoryStore()
    const source = fakeSource()
    const service = createDailyBriefingService({ source, store, now: () => asOf })

    const first = await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    const second = await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })

    expect(first.state).toBe('available')
    expect(second.state).toBe('available')
    expect(source.calls).toBe(1)
    expect(store.rows.size).toBe(1)
    expect(store.pruned.at(-1)).toBe('2026-10-17')
    if (first.state === 'available' && second.state === 'available') {
      expect(second.document.edition.date).toBe('2026-10-30')
      expect(second.document).toEqual(first.document)
    }
  })

  it('regenerates the same day, overwrites the row and applies the editorial layer', async () => {
    const store = memoryStore()
    const source = fakeSource()
    let calls = 0
    const service = createDailyBriefingService({
      source, store, now: () => asOf,
      editorial: async ({ document }) => {
        calls += 1
        return { document: { ...document, lede: { ...document.lede, source: 'agent', text: 'AI lede' } }, state: 'agent' }
      }
    })
    const first = await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    const second = await service.regenerate({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    expect(first.state).toBe('available')
    expect(second.state).toBe('available')
    if (first.state === 'available' && second.state === 'available') {
      expect(first.document.lede.source).toBe('agent')
      expect(second.document.lede.text).toBe('AI lede')
    }
    expect(source.calls).toBe(2)
    expect(calls).toBe(2)
    expect(store.rows.size).toBe(1)
  })

  it('keeps the template when the editorial layer throws', async () => {
    const store = memoryStore()
    const service = createDailyBriefingService({
      source: fakeSource(), store, now: () => asOf,
      editorial: async () => { throw new Error('model down') }
    })
    const result = await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    expect(result.state).toBe('available')
    if (result.state === 'available') expect(result.document.lede.source).toBe('template')
  })

  it('coalesces concurrent opens into one generation', async () => {
    const store = memoryStore()
    const source = fakeSource()
    const service = createDailyBriefingService({ source, store, now: () => asOf })
    await Promise.all([
      service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' }),
      service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' }),
      service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    ])
    expect(source.calls).toBe(1)
  })

  it('lists the last 14 local days with explicit gaps', async () => {
    const store = memoryStore()
    const source = fakeSource()
    const service = createDailyBriefingService({ source, store, now: () => asOf })
    await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })

    const listed = await service.list({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    expect(listed.state).toBe('available')
    if (listed.state !== 'available') return
    expect(listed.result.editions).toHaveLength(14)
    expect(listed.result.editions[0]).toMatchObject({ date: '2026-10-30', state: 'generated' })
    expect(listed.result.editions[1]).toMatchObject({ date: '2026-10-29', state: 'missing' })
    expect(listed.result.editions[13]?.date).toBe('2026-10-17')
  })

  it('returns the stored edition and missing for an unknown date', async () => {
    const store = memoryStore()
    const service = createDailyBriefingService({ source: fakeSource(), store, now: () => asOf })
    await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    const found = await service.get({ date: '2026-10-30', locale: 'zh-CN' })
    const missing = await service.get({ date: '2026-10-01', locale: 'zh-CN' })
    expect(found.state).toBe('available')
    expect(missing.state).toBe('missing')
  })

  it('fails closed on an invalid clock or a source failure', async () => {
    const store = memoryStore()
    const invalidClock = createDailyBriefingService({ source: fakeSource(), store, now: () => 'not-a-time' })
    expect(await invalidClock.getToday({ locale: 'zh-CN', timeZone: 'UTC' })).toEqual({
      state: 'unavailable', failureCode: 'time-invalid'
    })
    const failing: DailyBriefingSource = { async buildPacket() { throw new Error('query failed') } }
    const service = createDailyBriefingService({ source: failing, store, now: () => asOf })
    expect(await service.getToday({ locale: 'zh-CN', timeZone: 'UTC' })).toEqual({
      state: 'unavailable', failureCode: 'source-failed'
    })
  })

  it('keeps the other language visible when the current one has no edition', async () => {
    const store = memoryStore()
    const source = fakeSource()
    const service = createDailyBriefingService({ source, store, now: () => asOf })
    // Generate only zh-CN, then list from en-US: the day is a gap for the current locale but
    // `availableLocales` still names the edition that exists.
    await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    const listed = await service.list({ locale: 'en-US', timeZone: 'Asia/Shanghai' })
    expect(listed.state).toBe('available')
    if (listed.state !== 'available') return
    expect(listed.result.editions[0]).toMatchObject({ date: '2026-10-30', locale: 'zh-CN', state: 'generated' })
    expect(listed.result.editions[0]?.availableLocales).toEqual(['zh-CN'])
    expect((await service.get({ date: '2026-10-30', locale: 'en-US' })).state).toBe('missing')
    expect((await service.get({ date: '2026-10-30', locale: 'zh-CN' as DailyBriefingLocale })).state).toBe('available')
  })
})
