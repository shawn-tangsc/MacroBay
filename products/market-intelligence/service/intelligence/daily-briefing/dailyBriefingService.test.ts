import { describe, expect, it, vi } from 'vitest'

import type { DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { NewsSentimentItemView } from '../news-sentiment/newsSentimentQuery'
import type { DailyBriefingCalendarEvent, DailyBriefingFactPacket } from './dailyBriefingFactPacket'
import { createDailyBriefAgentRunner } from './dailyBriefAgentRunner'
import { DailyBriefTurnAbortedError } from './dailyBriefAgentTurn'
import { createDailyBriefEditorSessionPort } from './dailyBriefEditorSessionPort'
import { createDailyBriefSessionLinkStore } from './dailyBriefSessionLinks'
import {
  briefingWindow,
  createDailyBriefingService,
  localDate,
  type DailyBriefingSource,
  type DailyBriefingStore,
  type DailyBriefingStoredEdition
} from './dailyBriefingService'

const asOf = '2026-10-30T00:30:00.000Z'

type PacketInput = Readonly<{ asOf: string; windowHours: number }>

const emptyPacket = (input: PacketInput = { asOf, windowHours: 24 }): DailyBriefingFactPacket => ({
  asOf: input.asOf,
  windowStart: new Date(Date.parse(input.asOf) - input.windowHours * 60 * 60 * 1_000).toISOString(),
  windowEnd: input.asOf,
  windowHours: input.windowHours,
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

function fakeSource(
  packet: (input: PacketInput) => DailyBriefingFactPacket = (input) => emptyPacket(input)
): DailyBriefingSource & { calls: number; lastInput?: PacketInput } {
  const source = {
    calls: 0,
    lastInput: undefined as PacketInput | undefined,
    async buildPacket(input: PacketInput & { locale: DailyBriefingLocale; timeZone: string }) {
      source.calls += 1
      source.lastInput = { asOf: input.asOf, windowHours: input.windowHours ?? 24 }
      return packet(source.lastInput)
    }
  }
  return source
}

/** A session that returns a valid selection and then a minimal accepted editorial. */
function acceptingAgentRunner(starts: number[] = []) {
  return {
    async start() {
      starts.push(1)
      return {
        sessionId: 's1',
        created: true,
        assistantText: JSON.stringify({ stage: 'select', news: [], macro: [], next: [] }),
        toolInvocations: []
      }
    },
    async continue() {
      return {
        assistantText: JSON.stringify({ lede: '事实层导语。', ledePattern: 'event-shock', items: [], hidden: [], importance: [] }),
        toolInvocations: []
      }
    },
    async finish() {}
  }
}

const newsCandidate = (index: number): NewsSentimentItemView => ({
  itemId: `n${index}`,
  title: `Headline ${index}`,
  sourceId: 'coindesk-rss',
  sourceName: 'CoinDesk RSS',
  publishedAt: '2026-10-30T00:00:00.000Z',
  scoredAt: '2026-10-30T00:05:00.000Z',
  polarity: 'bearish',
  strength: 3,
  confidence: 78,
  symbols: ['BTC'],
  reasonCode: 'news.exploit.v1',
  engine: 'rules',
  caveats: []
})

const macroCandidate = (index: number): DailyBriefingCalendarEvent => ({
  eventKey: `US.TEST.${index}`,
  title: 'test-event',
  scheduledAt: '2026-10-29T12:00:00.000Z',
  importance: 'high',
  lifecycleState: 'released',
  category: 'economic-indicator',
  actual: '3.4%',
  consensus: '3.2%',
  surprise: { direction: 'beat', value: 0.2, unit: 'pp' }
})

describe('daily briefing service', () => {
  it('derives the local edition date from the requested zone', () => {
    expect(localDate('2026-10-30T00:30:00.000Z', 'Asia/Shanghai')).toBe('2026-10-30')
    expect(localDate('2026-10-29T20:00:00.000Z', 'Asia/Shanghai')).toBe('2026-10-30')
    expect(localDate('not-a-time', 'UTC')).toBeUndefined()
    expect(localDate(asOf, 'Not/AZone')).toBe('2026-10-30')
    expect(briefingWindow('2026-10-30T00:30:00.000Z', 'Asia/Shanghai')).toEqual({ date: '2026-10-30', windowStart: '2026-10-29T00:00:00.000Z', windowEnd: '2026-10-30T00:00:00.000Z', windowHours: 24 })
    expect(briefingWindow('2026-10-29T23:30:00.000Z', 'Asia/Shanghai')).toEqual({ date: '2026-10-29', windowStart: '2026-10-28T00:00:00.000Z', windowEnd: '2026-10-29T00:00:00.000Z', windowHours: 24 })
  })

  it('moves the cutoff with the configured generation time', () => {
    // 08:30 local is before a 09:30 cutoff, so the open belongs to the previous edition.
    expect(briefingWindow('2026-10-30T00:30:00.000Z', 'Asia/Shanghai', { generationTime: '09:30' })).toEqual({
      date: '2026-10-29', windowStart: '2026-10-28T01:30:00.000Z', windowEnd: '2026-10-29T01:30:00.000Z', windowHours: 24
    })
    expect(briefingWindow('2026-10-30T02:00:00.000Z', 'Asia/Shanghai', { generationTime: '09:30' })).toEqual({
      date: '2026-10-30', windowStart: '2026-10-29T01:30:00.000Z', windowEnd: '2026-10-30T01:30:00.000Z', windowHours: 24
    })
  })

  it('subtracts the configured window hours from the cutoff', () => {
    expect(briefingWindow('2026-10-30T00:30:00.000Z', 'Asia/Shanghai', { windowHours: 12 })).toEqual({
      date: '2026-10-30', windowStart: '2026-10-29T12:00:00.000Z', windowEnd: '2026-10-30T00:00:00.000Z', windowHours: 12
    })
    expect(briefingWindow('2026-10-30T00:30:00.000Z', 'Asia/Shanghai', { windowHours: 48, generationTime: '06:00' })).toEqual({
      date: '2026-10-30', windowStart: '2026-10-27T22:00:00.000Z', windowEnd: '2026-10-29T22:00:00.000Z', windowHours: 48
    })
  })

  it('generates at the configured time and records the actual window in the edition', async () => {
    const store = memoryStore()
    const source = fakeSource()
    const service = createDailyBriefingService({
      source, store,
      now: () => '2026-10-30T02:00:00.000Z',
      generationSettings: async () => ({ generationTime: '09:30', windowHours: 48 })
    })

    const result = await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })

    expect(source.lastInput).toEqual({ asOf: '2026-10-30T01:30:00.000Z', windowHours: 48 })
    expect(result.state).toBe('available')
    if (result.state === 'available') {
      expect(result.document.edition).toMatchObject({
        date: '2026-10-30',
        windowStart: '2026-10-28T01:30:00.000Z',
        windowEnd: '2026-10-30T01:30:00.000Z',
        windowHours: 48
      })
    }
  })

  it('keeps a stored edition as generated when the settings change afterwards', async () => {
    const store = memoryStore()
    const source = fakeSource()
    const later = '2026-10-30T02:00:00.000Z'
    const first = createDailyBriefingService({
      source, store,
      now: () => later,
      generationSettings: async () => ({ generationTime: '08:00', windowHours: 24 })
    })
    const generated = await first.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    expect(generated.state).toBe('available')

    const changed = createDailyBriefingService({
      source, store,
      now: () => later,
      generationSettings: async () => ({ generationTime: '09:30', windowHours: 12 })
    })
    const reread = await changed.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })

    expect(source.calls).toBe(1)
    expect(reread.state).toBe('available')
    if (generated.state === 'available' && reread.state === 'available') {
      expect(reread.document).toEqual(generated.document)
      expect(reread.document.edition.windowHours).toBe(24)
      expect(reread.document.edition.windowEnd).toBe(generated.document.edition.windowEnd)
    }
  })

  it('falls back to the default schedule when the setting cannot be read', async () => {
    const store = memoryStore()
    const source = fakeSource()
    const service = createDailyBriefingService({
      source, store,
      now: () => asOf,
      generationSettings: async () => { throw new Error('settings unreadable') }
    })

    const result = await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    expect(result.state).toBe('available')
    expect(source.lastInput).toEqual({ asOf: '2026-10-30T00:00:00.000Z', windowHours: 24 })
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

  it('returns a failed document without storing an edition when the agent turn fails', async () => {
    const store = memoryStore()
    const service = createDailyBriefingService({
      source: fakeSource(), store, now: () => asOf,
      agentRunner: {
        async start() { return { sessionId: 's', created: true, assistantText: '{}', toolInvocations: [] } },
        async continue() { return { assistantText: '{}', toolInvocations: [] } },
        async finish() {}
      }
    })
    const result = await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    expect(result.state).toBe('available')
    expect(store.rows.size).toBe(0)
  })

  it('cancels the runtime session and abandons its link when the editorial deadline fires', async () => {
    vi.useFakeTimers()
    try {
      const store = memoryStore()
      const links = createDailyBriefSessionLinkStore(':memory:')
      const cancelAgentSession = vi.fn(async () => undefined)
      const port = createDailyBriefEditorSessionPort({
        links,
        createSession: async () => ({ id: 's-timeout' } as never),
        send: () => new Promise<never>(() => undefined),
        cancelAgentSession,
        now: () => asOf
      })
      const service = createDailyBriefingService({
        source: fakeSource(), store, now: () => asOf,
        agentRunner: createDailyBriefAgentRunner({ port, agentId: 'daily-brief-editor' })
      })

      const pending = service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
      await vi.advanceTimersByTimeAsync(120_000)
      const result = await pending

      expect(cancelAgentSession).toHaveBeenCalledWith('s-timeout')
      expect((await links.findBySession('s-timeout'))?.state).toBe('abandoned')
      expect(result.state).toBe('available')
      if (result.state === 'available') {
        expect(result.document.provenance.editorialFailure).toBe('editorial-timeout')
      }
      expect(store.rows.size).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('skips the abandoned write when the deadline fires before a session exists', async () => {
    vi.useFakeTimers()
    try {
      const store = memoryStore()
      const finish = vi.fn(async () => undefined)
      const service = createDailyBriefingService({
        source: fakeSource(), store, now: () => asOf,
        agentRunner: {
          start: () => new Promise<never>(() => undefined),
          async continue() { return { assistantText: '{}', toolInvocations: [] } },
          finish
        }
      })

      const pending = service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
      await vi.advanceTimersByTimeAsync(120_000)
      const result = await pending

      expect(finish).not.toHaveBeenCalled()
      expect(result.state).toBe('available')
      if (result.state === 'available') {
        expect(result.document.provenance.editorialFailure).toBe('editorial-timeout')
      }
      expect(store.rows.size).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('runs the agent on the platform default and records the fallback when the custom model is unavailable', async () => {
    const store = memoryStore()
    const starts: number[] = []
    const service = createDailyBriefingService({
      source: fakeSource(), store, now: () => asOf,
      agentRunner: acceptingAgentRunner(starts),
      agentModel: async () => ({ state: 'agent', providerId: 'p', modelId: 'm', source: 'default', fallback: 'custom-unavailable' })
    })
    const result = await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })

    expect(starts).toHaveLength(1)
    expect(store.rows.size).toBe(1)
    expect(result.state).toBe('available')
    if (result.state === 'available') {
      expect(result.document.lede.source).toBe('agent')
      expect(result.document.provenance.editorialMeta).toEqual({
        promptVersion: 'daily-briefing.agent.v1',
        model: 'p:m',
        source: 'default',
        fallback: 'custom-unavailable'
      })
    }
  })

  it('keeps the accepted custom model unchanged in the provenance', async () => {
    const store = memoryStore()
    const service = createDailyBriefingService({
      source: fakeSource(), store, now: () => asOf,
      agentRunner: acceptingAgentRunner(),
      agentModel: async () => ({ state: 'agent', providerId: 'p2', modelId: 'm2', source: 'custom' })
    })
    const result = await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })

    expect(result.state).toBe('available')
    if (result.state === 'available') {
      expect(result.document.provenance.editorialMeta).toEqual({
        promptVersion: 'daily-briefing.agent.v1',
        model: 'p2:m2',
        source: 'custom'
      })
    }
  })

  it('keeps the fact layer without starting a session when no model can be called', async () => {
    const store = memoryStore()
    const starts: number[] = []
    const service = createDailyBriefingService({
      source: fakeSource(), store, now: () => asOf,
      agentRunner: acceptingAgentRunner(starts),
      agentModel: async () => ({ state: 'unavailable', reason: 'default-unavailable' })
    })
    const result = await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })

    expect(starts).toHaveLength(0)
    expect(store.rows.size).toBe(0)
    expect(result.state).toBe('available')
    if (result.state === 'available') {
      expect(result.document.lede.source).toBe('template')
      expect(result.document.provenance.editorialFailure).toBe('model-unavailable')
      expect(result.document.provenance.editorialFailureDetail).toBe('default-unavailable')
    }
  })

  it('fails closed without starting a session when model readiness cannot be resolved', async () => {
    const store = memoryStore()
    const starts: number[] = []
    const service = createDailyBriefingService({
      source: fakeSource(), store, now: () => asOf,
      agentRunner: acceptingAgentRunner(starts),
      agentModel: async () => { throw new Error('provider state unavailable') }
    })
    const result = await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })

    expect(starts).toHaveLength(0)
    expect(store.rows.size).toBe(0)
    if (result.state === 'available') {
      expect(result.document.provenance.editorialFailure).toBe('model-unavailable')
    }
  })

  it('regenerates the same day, overwrites the row and applies the agent editorial', async () => {
    const store = memoryStore()
    const source = fakeSource()
    const starts: number[] = []
    const service = createDailyBriefingService({
      source, store, now: () => asOf,
      agentRunner: acceptingAgentRunner(starts)
    })
    const first = await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    const second = await service.regenerate({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    expect(first.state).toBe('available')
    expect(second.state).toBe('available')
    if (first.state === 'available' && second.state === 'available') {
      expect(first.document.lede.source).toBe('agent')
      expect(second.document.lede.text).toBe('事实层导语。')
    }
    expect(source.calls).toBe(2)
    expect(starts).toHaveLength(2)
    expect(store.rows.size).toBe(1)
  })

  it('publishes the fact layer without starting a session when the AI editor is disabled', async () => {
    const store = memoryStore()
    const starts: number[] = []
    const service = createDailyBriefingService({
      source: fakeSource(), store, now: () => asOf,
      agentRunner: acceptingAgentRunner(starts),
      editorialEnabled: async () => false
    })
    const result = await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })

    expect(starts).toHaveLength(0)
    expect(store.rows.size).toBe(1)
    expect(result.state).toBe('available')
    if (result.state === 'available') {
      expect(result.document.lede.source).toBe('template')
      expect(result.document.provenance.editorialFailure).toBe('editorial-disabled')
    }
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

  it('fails without generating when the news candidate pool exceeds 200', async () => {
    const store = memoryStore()
    const source = fakeSource(() => ({
      ...emptyPacket(),
      news: { state: 'available', items: Array.from({ length: 201 }, (_, index) => newsCandidate(index)) }
    }))
    const service = createDailyBriefingService({ source, store, now: () => asOf })

    await expect(service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })).resolves.toEqual({
      state: 'unavailable', failureCode: 'candidate-overflow'
    })
    expect(store.rows.size).toBe(0)
  })

  it('fails without generating when the macro candidate pool exceeds 200', async () => {
    const store = memoryStore()
    const source = fakeSource(() => ({
      ...emptyPacket(),
      calendar: { state: 'available', events: Array.from({ length: 201 }, (_, index) => macroCandidate(index)) }
    }))
    const service = createDailyBriefingService({ source, store, now: () => asOf })

    await expect(service.regenerate({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })).resolves.toEqual({
      state: 'unavailable', failureCode: 'candidate-overflow'
    })
    expect(store.rows.size).toBe(0)
  })

  it('accepts exactly the 200-candidate budget', async () => {
    const store = memoryStore()
    const source = fakeSource(() => ({
      ...emptyPacket(),
      news: { state: 'available', items: Array.from({ length: 200 }, (_, index) => newsCandidate(index)) },
      calendar: { state: 'available', events: Array.from({ length: 200 }, (_, index) => macroCandidate(index)) }
    }))
    const service = createDailyBriefingService({ source, store, now: () => asOf })

    const result = await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    expect(result.state).toBe('available')
    expect(store.rows.size).toBe(1)
  })

  it('does not return an edition when the store write fails', async () => {
    const store: DailyBriefingStore = {
      async get() { return undefined },
      async put() { throw new Error('disk full') },
      async list() { return [] },
      async prune() {}
    }
    const service = createDailyBriefingService({ source: fakeSource(), store, now: () => asOf })

    await expect(service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })).resolves.toEqual({
      state: 'unavailable', failureCode: 'store-failed'
    })
  })

  it('reports a gap for the current locale but names the other locale', async () => {
    const store = memoryStore()
    const source = fakeSource()
    const service = createDailyBriefingService({ source, store, now: () => asOf })
    // Generate only zh-CN, then list from en-US: the day is a gap for the current locale but
    // `availableLocales` still names the edition that exists.
    await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    const listed = await service.list({ locale: 'en-US', timeZone: 'Asia/Shanghai' })
    expect(listed.state).toBe('available')
    if (listed.state !== 'available') return
    expect(listed.result.editions[0]).toMatchObject({ date: '2026-10-30', locale: 'en-US', state: 'missing' })
    expect(listed.result.editions[0]?.availableLocales).toEqual(['zh-CN'])
    expect((await service.get({ date: '2026-10-30', locale: 'en-US' })).state).toBe('missing')
    expect((await service.get({ date: '2026-10-30', locale: 'zh-CN' as DailyBriefingLocale })).state).toBe('available')
  })
})
