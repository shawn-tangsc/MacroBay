import { describe, expect, it, vi } from 'vitest'
import { factSnapshotFromPacket } from './dailyBriefingFactSnapshot'

import type { DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { NewsSentimentItemView } from '../news-sentiment/newsSentimentQuery'
import type { DailyBriefingCalendarEvent, DailyBriefingFactPacket } from './dailyBriefingFactPacket'
import { createDailyBriefAgentRunner } from './dailyBriefAgentRunner'
import { DailyBriefTurnAbortedError } from './dailyBriefAgentTurn'
import { createDailyBriefEditorSessionPort } from './dailyBriefEditorSessionPort'
import { createDailyBriefSessionLinkStore } from './dailyBriefSessionLinks'
import { createDailyBriefingSqliteStore } from './dailyBriefingStore'
import {
  briefingWindow,
  createDailyBriefingService,
  DAILY_BRIEF_GENERATION_BUDGET_MS,
  localDate,
  type DailyBriefingSource,
  type DailyBriefingPeriodRun,
  type DailyBriefingStore,
  type DailyBriefingStoredEdition
} from './dailyBriefingService'

const asOf = '2026-10-30T00:30:00.000Z'

type PacketInput = Readonly<{ asOf: string; windowEnd: string; windowHours: number }>

const emptyPacket = (input: PacketInput = { asOf, windowEnd: asOf, windowHours: 24 }): DailyBriefingFactPacket => ({
  asOf: input.asOf,
  windowStart: new Date(Date.parse(input.windowEnd) - input.windowHours * 60 * 60 * 1_000).toISOString(),
  windowEnd: input.windowEnd,
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

function memoryStore(): DailyBriefingStore & {
  rows: Map<string, DailyBriefingStoredEdition>
  /** 运行记录：与版次分开存，「有运行没版次」和「有版次没运行」才构造得出来。 */
  runs: DailyBriefingPeriodRun[]
  pruned: string[]
} {
  const rows = new Map<string, DailyBriefingStoredEdition>()
  const runs: DailyBriefingPeriodRun[] = []
  const pruned: string[] = []
  const key = (date: string, locale: string) => `${date}:${locale}`
  return {
    rows,
    runs,
    pruned,
    async get(date, locale) { return rows.get(key(date, locale)) },
    async put(edition) { rows.set(key(edition.date, edition.locale), edition) },
    async list(from, to, locale) {
      return [...rows.values()].filter((row) => row.locale === locale && row.date >= from && row.date <= to)
    },
    async listPeriodRuns(from, to) {
      return runs.filter((run) => run.date >= from && run.date <= to)
    },
    async getPeriodRun(date, periodId = 'default') {
      return runs.find((run) => run.date === date && run.periodId === periodId)
    },
    async prune(beforeDate) { pruned.push(beforeDate) }
  }
}

function storedEdition(date: string): DailyBriefingStoredEdition {
  const at = `${date}T00:00:00.000Z`
  return {
    date,
    periodId: 'default',
    locale: 'zh-CN',
    generatedAt: at,
    windowStart: at,
    windowEnd: at,
    document: {
      schemaVersion: 1,
      policyVersion: 'daily-briefing.v1',
      edition: { date, locale: 'zh-CN', generatedAt: at, windowStart: at, windowEnd: at, timeZone: 'Asia/Shanghai' },
      status: { readings: [], readingsAvailable: 4, readingsTotal: 4 },
      lede: { source: 'template', text: '', generatedAt: at },
      news: { items: [], macro: [], notes: {} },
      data: { market: [], funds: [], sentiment: { fearGreed: null, news: { state: 'empty' } } },
      conclusion: null,
      next: { items: [] },
      citations: [],
      provenance: { summaryId: null, readAt: at }
    }
  } as DailyBriefingStoredEdition
}

function periodRun(date: string): DailyBriefingPeriodRun {
  return {
    date,
    periodId: 'default',
    expectedLocales: ['zh-CN'],
    primaryRequested: 'zh-CN',
    primaryUsed: 'zh-CN',
    snapshotId: 'bs_seed',
    snapshotHash: 'seed',
    contentVersion: 1,
    writingRounds: 1,
    direction: 'undecided',
    editionRows: [],
    state: 'published',
    startedAt: `${date}T00:00:00.000Z`
  } as DailyBriefingPeriodRun
}

function fakeSource(
  packet: (input: PacketInput) => DailyBriefingFactPacket = (input) => emptyPacket(input)
): DailyBriefingSource & { calls: number; lastInput?: PacketInput } {
  let lastPacket: DailyBriefingFactPacket | undefined
  const source = {
    calls: 0,
    lastInput: undefined as PacketInput | undefined,
    async readFacts(input: Readonly<{ asOf: string; windowEnd?: string; windowHours?: number }>) {
      source.calls += 1
      source.lastInput = { asOf: input.asOf, windowEnd: input.windowEnd ?? input.asOf, windowHours: input.windowHours ?? 24 }
      lastPacket = packet(source.lastInput)
      return factSnapshotFromPacket(lastPacket)
    },
    async renderPacket(_facts: { asOf: string; windowEnd: string; windowHours: number }, locale: DailyBriefingLocale, timeZone: string) {
      return Object.freeze({ ...lastPacket!, locale, timeZone })
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
    // 08:30 local is past the 07:00 default cutoff, so it reads the edition closed at 07:00.
    expect(briefingWindow('2026-10-30T00:30:00.000Z', 'Asia/Shanghai')).toEqual({ date: '2026-10-30', windowStart: '2026-10-28T23:00:00.000Z', windowEnd: '2026-10-29T23:00:00.000Z', windowHours: 24, zoneSource: 'settings' })
    // 07:30 local is on the other side of the same cutoff; the day rolls over, the window does not.
    expect(briefingWindow('2026-10-29T23:30:00.000Z', 'Asia/Shanghai')).toEqual({ date: '2026-10-30', windowStart: '2026-10-28T23:00:00.000Z', windowEnd: '2026-10-29T23:00:00.000Z', windowHours: 24, zoneSource: 'settings' })
  })

  it('stops the run when its attempt row cannot be written, instead of running unrecorded', async () => {
    // A run with no attempt row cannot be found afterwards. Before this, the write error was
    // swallowed and the run continued: afterwards "no attempt" meant both "nothing ran" and
    // "something ran and could not say so".
    const store = { ...memoryStore(), beginAttempt: async () => { throw new Error('database is locked') } } as DailyBriefingStore
    const source = fakeSource()
    const service = createDailyBriefingService({ source, store, now: () => asOf })

    const result = await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })

    expect(result).toMatchObject({ state: 'unavailable', failureCode: 'attempt-not-recorded' })
    // Nothing was collected, stored or published for a run that has no record of itself.
    expect(source.calls).toBe(0)
  })

  it('moves the cutoff with the configured generation time', () => {
    // 08:30 local is before a 09:30 cutoff, so the open belongs to the previous edition.
    expect(briefingWindow('2026-10-30T00:30:00.000Z', 'Asia/Shanghai', { generationTime: '09:30' })).toEqual({
      date: '2026-10-29', windowStart: '2026-10-28T01:30:00.000Z', windowEnd: '2026-10-29T01:30:00.000Z', windowHours: 24, zoneSource: 'settings'
    })
    expect(briefingWindow('2026-10-30T02:00:00.000Z', 'Asia/Shanghai', { generationTime: '09:30' })).toEqual({
      date: '2026-10-30', windowStart: '2026-10-29T01:30:00.000Z', windowEnd: '2026-10-30T01:30:00.000Z', windowHours: 24, zoneSource: 'settings'
    })
  })

  it('subtracts the configured window hours from the cutoff', () => {
    expect(briefingWindow('2026-10-30T00:30:00.000Z', 'Asia/Shanghai', { windowHours: 12 })).toEqual({
      date: '2026-10-30', windowStart: '2026-10-29T11:00:00.000Z', windowEnd: '2026-10-29T23:00:00.000Z', windowHours: 12, zoneSource: 'settings'
    })
    expect(briefingWindow('2026-10-30T00:30:00.000Z', 'Asia/Shanghai', { windowHours: 48, generationTime: '06:00' })).toEqual({
      date: '2026-10-30', windowStart: '2026-10-27T22:00:00.000Z', windowEnd: '2026-10-29T22:00:00.000Z', windowHours: 48, zoneSource: 'settings'
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

    // 读数用运行时刻（02:00），窗口仍卡在截止（01:30）。
    expect(source.lastInput).toEqual({ asOf: '2026-10-30T02:00:00.000Z', windowEnd: '2026-10-30T01:30:00.000Z', windowHours: 48 })
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
    // The fallback schedule is the policy default, 07:00 local: 23:00Z the evening before.
    expect(source.lastInput).toEqual({ asOf, windowEnd: '2026-10-29T23:00:00.000Z', windowHours: 24 })
  })

  it('reports only the attempt that is running, and forgets it once the run settles', async () => {
    const store = memoryStore()
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const source: DailyBriefingSource = {
      async readFacts(input) {
        await gate
        // The service consumes a frozen snapshot, not the raw packet: the same conversion the other
        // fakes use, so this fake cannot drift into returning the wrong shape unnoticed.
        return factSnapshotFromPacket(emptyPacket({ asOf: input.asOf, windowEnd: input.windowEnd ?? input.asOf, windowHours: input.windowHours ?? 24 }))
      },
      // Required by the source contract even though this run is held at `readFacts`: a fake that
      // omits a required member only compiles while the file is outside the typecheck's scope.
      async renderPacket(_facts, locale, timeZone) {
        return Object.freeze({ ...emptyPacket(), locale, timeZone })
      }
    }
    const service = createDailyBriefingService({ source, store, now: () => asOf })

    expect(await service.getProgress({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })).toEqual({ state: 'idle' })

    const running = service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const progress = await service.getProgress({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    expect(progress.state).toBe('running')
    if (progress.state === 'running') {
      expect(progress.progress.attemptId).toBe('2026-10-30:zh-CN:2026-10-29T23:00:00.000Z')
      expect(progress.progress.stages.every((stage) => stage.state !== 'skipped')).toBe(true)
    }

    release()
    await running
    // A settled attempt is not reported twice: its trace travels with the result or the edition.
    expect(await service.getProgress({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })).toEqual({ state: 'idle' })
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

  it('stores the fact layer and marks it when the agent turn fails', async () => {
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
    // A brief that could be read is a brief that ships: the reader gets the numbers, and the edition
    // says in its provenance that the interpretation is missing. "No brief today" is the other thing.
    expect(result.state).toBe('available')
    expect(store.rows.size).toBe(1)
    expect(result.state === 'available' ? result.document.provenance.editorialFailure : undefined).toBeDefined()
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
      await vi.advanceTimersByTimeAsync(DAILY_BRIEF_GENERATION_BUDGET_MS)
      const result = await pending

      expect(cancelAgentSession).toHaveBeenCalledWith('s-timeout')
      expect((await links.findBySession('s-timeout'))?.state).toBe('abandoned')
      expect(result.state).toBe('available')
      if (result.state === 'available') {
        expect(result.document.provenance.editorialFailure).toBe('editorial-timeout')
      }
      expect(store.rows.size).toBe(1)
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
      await vi.advanceTimersByTimeAsync(DAILY_BRIEF_GENERATION_BUDGET_MS)
      const result = await pending

      expect(finish).not.toHaveBeenCalled()
      expect(result.state).toBe('available')
      if (result.state === 'available') {
        expect(result.document.provenance.editorialFailure).toBe('editorial-timeout')
      }
      expect(store.rows.size).toBe(1)
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
        promptVersion: 'daily-briefing.agent.v2',
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
        promptVersion: 'daily-briefing.agent.v2',
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
    expect(store.rows.size).toBe(1)
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
    expect(store.rows.size).toBe(1)
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

  it('coalesces concurrent regenerations into one run', async () => {
    // The reported defect: a reader pressed 重新生成 three times and got three concurrent runs, each
    // publishing its own session — three "11-01 Daily brief" entries for one edition.
    const store = memoryStore()
    const source = fakeSource()
    const service = createDailyBriefingService({ source, store, now: () => asOf })
    await Promise.all([
      service.regenerate({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' }),
      service.regenerate({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' }),
      service.regenerate({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    ])
    expect(source.calls).toBe(1)
  })

  it('joins a generation already running instead of starting a second one', async () => {
    const store = memoryStore()
    const source = fakeSource()
    const service = createDailyBriefingService({ source, store, now: () => asOf })
    await Promise.all([
      service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' }),
      service.regenerate({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    ])
    expect(source.calls).toBe(1)
  })

  it('draws a day only where there is a trace: an edition, a run, or today', async () => {
    // 三向规则（2026-11-05 定，`9456b52`）：有版次或有运行的日子出现，今天永远出现，**空着的过去日子不出现**。
    // 这条用例以前断言「固定铺满 14 天」，那是旧口径；现在按规则本身断言，两个来源各构造一次。
    const store = memoryStore()
    const service = createDailyBriefingService({ source: fakeSource(), store, now: () => asOf })
    await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })

    // 有版次、没有运行：这一版还在，日子必须出现。
    store.rows.set('2026-10-28:zh-CN', storedEdition('2026-10-28'))
    // 有运行、版次已被删：天头仍要在（读者删过这一版，运行记录留着）。
    store.runs.push(periodRun('2026-10-27'))

    const listed = await service.list({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    expect(listed.state).toBe('available')
    if (listed.state !== 'available') return
    // 新到旧；今天在最上，空着的 10-29 不出现。
    expect(listed.result.dates).toEqual(['2026-10-30', '2026-10-28', '2026-10-27'])
    expect(listed.result.dates).not.toContain('2026-10-29')
    expect(listed.result.editions.map((edition) => edition.date)).toEqual(expect.arrayContaining(['2026-10-30', '2026-10-28']))
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
    const failing: DailyBriefingSource = {
      async readFacts() { throw new Error('query failed') },
      async renderPacket() { throw new Error('query failed') }
    }
    const service = createDailyBriefingService({ source: failing, store, now: () => asOf })
    expect(await service.getToday({ locale: 'zh-CN', timeZone: 'UTC' })).toMatchObject({
      state: 'unavailable', failureCode: 'source-failed',
      generationTrace: { state: 'failed', stages: expect.arrayContaining([expect.objectContaining({ id: 'source', state: 'failed' })]) }
    })
  })

  it('fails without generating when the news candidate pool exceeds 200', async () => {
    const store = memoryStore()
    const source = fakeSource(() => ({
      ...emptyPacket(),
      news: { state: 'available', items: Array.from({ length: 201 }, (_, index) => newsCandidate(index)) }
    }))
    const service = createDailyBriefingService({ source, store, now: () => asOf })

    await expect(service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })).resolves.toMatchObject({
      state: 'unavailable', failureCode: 'candidate-overflow',
      generationTrace: { state: 'failed', stages: expect.arrayContaining([expect.objectContaining({ id: 'candidates', state: 'failed' })]) }
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

    await expect(service.regenerate({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })).resolves.toMatchObject({
      state: 'unavailable', failureCode: 'candidate-overflow',
      generationTrace: { state: 'failed', stages: expect.arrayContaining([expect.objectContaining({ id: 'candidates', state: 'failed' })]) }
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

    await expect(service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })).resolves.toMatchObject({
      state: 'unavailable', failureCode: 'store-failed',
      generationTrace: { state: 'failed', stages: expect.arrayContaining([expect.objectContaining({ id: 'store', state: 'failed' })]) }
    })
  })

  it('lists the languages that exist, one row each, whatever the interface language is', async () => {
    const store = memoryStore()
    const source = fakeSource()
    const service = createDailyBriefingService({ source, store, now: () => asOf })
    // Generate only zh-CN, then list from en-US. 一行 = 一期 = 一种语言：这一天只有中文那一行，
    // 不会因为界面是英文就凭空多出一条英文行，也不会把两种语言合进一行。
    await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    const listed = await service.list({ locale: 'en-US', timeZone: 'Asia/Shanghai' })
    expect(listed.state).toBe('available')
    if (listed.state !== 'available') return
    const thatDay = listed.result.editions.filter((edition) => edition.date === '2026-10-30')
    expect(thatDay).toHaveLength(1)
    expect(thatDay[0]).toMatchObject({ locale: 'zh-CN', state: 'generated' })
    expect((await service.get({ date: '2026-10-30', locale: 'en-US' })).state).toBe('missing')
    expect((await service.get({ date: '2026-10-30', locale: 'zh-CN' as DailyBriefingLocale })).state).toBe('available')
  })

  it('runs the core-fact ensure after building the packet and before the editorial turn', async () => {
    const events: string[] = []
    const cutoffs: string[] = []
    const store = memoryStore()
    const source = fakeSource((input) => { events.push('packet'); return emptyPacket(input) })
    const runner = {
      async start() {
        events.push('agent')
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
    const service = createDailyBriefingService({
      source, store, agentRunner: runner, now: () => asOf,
      coreFactEnsure: async ({ document, cutoff }) => {
        events.push('ensure')
        cutoffs.push(cutoff)
        return document
      }
    })

    const result = await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })

    expect(result.state).toBe('available')
    expect(events).toEqual(['packet', 'ensure', 'agent'])
    expect(cutoffs).toEqual(['2026-10-29T23:00:00.000Z'])
  })

  it('still generates the edition when the core-fact ensure fails', async () => {
    const store = memoryStore()
    const runner = {
      async start() {
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
    const service = createDailyBriefingService({
      source: fakeSource(),
      store,
      agentRunner: runner,
      now: () => asOf,
      coreFactEnsure: async () => { throw new Error('reader down') }
    })

    const result = await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })

    expect(result.state).toBe('available')
    expect(store.rows.size).toBe(1)
  })

  it('re-checks the new cutoff on the next generation', async () => {
    let currentNow = asOf
    const cutoffs: string[] = []
    const store = memoryStore()
    const runner = {
      async start() {
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
    const service = createDailyBriefingService({
      source: fakeSource(),
      store,
      agentRunner: runner,
      now: () => currentNow,
      coreFactEnsure: async ({ document, cutoff }) => {
        cutoffs.push(cutoff)
        return document
      }
    })

    await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    currentNow = '2026-10-31T00:30:00.000Z'
    await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })

    expect(cutoffs).toEqual(['2026-10-29T23:00:00.000Z', '2026-10-30T23:00:00.000Z'])
  })
})


describe('period run', () => {
  it('records the frozen facts of the generation and settles it as published', async () => {
    const store = createDailyBriefingSqliteStore(':memory:')
    const service = createDailyBriefingService({ source: fakeSource(), store, now: () => asOf })
    await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })

    const run = await store.getPeriodRun?.('2026-10-30')
    expect(run).toMatchObject({
      periodId: 'default',
      expectedLocales: ['zh-CN'],
      primaryUsed: 'zh-CN',
      state: 'published',
      writingRounds: 1
    })
    // The digest is what a later reader compares; a placeholder here would prove nothing.
    expect(run?.snapshotId).toMatch(/^bs_[0-9a-f]{24}$/)
    expect(run?.snapshotHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('writes the period and the trigger of the run into the edition it publishes', async () => {
    const store = createDailyBriefingSqliteStore(':memory:')
    const service = createDailyBriefingService({ source: fakeSource(), store, now: () => asOf })
    const result = await service.getToday({
      locale: 'zh-CN', timeZone: 'Asia/Shanghai',
      periodId: 'period_x', periodKind: 'manual', runTrigger: 'manual'
    })

    expect(result.state).toBe('available')
    if (result.state !== 'available') return
    // A non-default period must not be filed under `default`, and a manual run must not read as
    // scheduled: the identity the run was given is what the edition records.
    expect(result.document.edition).toMatchObject({ periodId: 'period_x', periodKind: 'manual', runTrigger: 'manual' })
    expect(result.document.edition.periodTime).toBe(result.document.edition.windowEnd)
    // The stored row lives under the same period, so a second period cannot overwrite it.
    expect(await store.get('2026-10-30', 'zh-CN', 'period_x')).toBeDefined()
    expect(await store.get('2026-10-30', 'zh-CN', 'default')).toBeUndefined()
  })

  it('records a failed run when the source cannot be read', async () => {
    const store = createDailyBriefingSqliteStore(':memory:')
    const failing: DailyBriefingSource = {
      async readFacts() { throw new Error('source-down') },
      async renderPacket() { throw new Error('source-down') }
    }
    const service = createDailyBriefingService({ source: failing, store, now: () => asOf })
    expect((await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })).state).toBe('unavailable')
    expect(await store.getPeriodRun?.('2026-10-30')).toBeUndefined()
  })
})

describe('briefing notices', () => {
  function completedRun() {
    const notices: Array<Record<string, unknown>> = []
    const service = createDailyBriefingService({
      source: fakeSource(),
      store: memoryStore(),
      now: () => asOf,
      generationSettings: async () => ({ generationTime: '08:00', windowHours: 24 }),
      noticeSubmit: async (request) => {
        notices.push(request as unknown as Record<string, unknown>)
        return { kind: 'accepted', recordId: 'r1', levels: ['center'] }
      }
    })
    return { service, notices }
  }

  it('submits one completion notice with a date-only key when an automatic run stores an edition', async () => {
    // 读者 2026-11-04 翻案：完成也要一条。自动运行落盘后发一条；键里只有日期，
    // 同一天再生成不是新的一期。
    const { service, notices } = completedRun()

    const result = await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })

    expect(result.state).toBe('available')
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({
      eventTypeId: 'market-intelligence.briefing.ready',
      producerId: 'market-intelligence.dailyBriefing',
      dedupeVars: { builder: 'template', vars: { date: '2026-10-30' } },
      deeplink: { scope: 'product', productId: 'market-intelligence', pageId: 'daily-briefing' }
    })
    // 版本号、生成时刻、内容哈希或期号任一混进键里，同一天的重新生成都会变成第二条提醒。
    // The edition's identity is in the key now (a day may hold several issues); the content's
    // revision, hash and generation moment must still stay out of it.
    expect(JSON.stringify(notices[0]?.dedupeVars)).toMatch(/periodId/)
    expect(JSON.stringify(notices[0]?.dedupeVars)).not.toMatch(/revision|documentId|hash|generatedAt/)
  })

  it('writes the completion record without delivering it when the reader regenerates', async () => {
    // The record is not a delivery: a manual run still states which edition exists, so "push to phone"
    // has something to check, while `deliver: false` keeps the surfaces silent until the reader asks.
    const { service, notices } = completedRun()

    await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    await service.regenerate({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })

    // One automatic record, one manual one: the manual keeps the row and drops the delivery.
    expect(notices).toHaveLength(2)
    expect(notices[0]).not.toHaveProperty('deliver')
    expect(notices[1]).toMatchObject({ deliver: false })
    expect(notices[1]).toHaveProperty('edition')
    // Both name the edition they carry, so a later push can check it is the one on screen.
    expect(notices[0]).toHaveProperty('edition')
  })

  it('N5 ①: a terminal failure says the edition was not generated', async () => {
    const notices: Array<Record<string, unknown>> = []
    const failing: DailyBriefingSource = {
      async readFacts() { throw new Error('source-down') },
      async renderPacket() { throw new Error('source-down') }
    }
    const service = createDailyBriefingService({
      source: failing,
      store: createDailyBriefingSqliteStore(':memory:'),
      now: () => asOf,
      noticeSubmit: async (request) => {
        notices.push(request as unknown as Record<string, unknown>)
        return { kind: 'accepted', recordId: 'r1', levels: ['center', 'desktop'] }
      }
    })

    expect((await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })).state).toBe('unavailable')
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({
      eventTypeId: 'market-intelligence.briefing.failed',
      bodyVariant: 'not-generated'
    })
  })

  it('N5 ②: data ready but the interpretation missing still ships the brief', async () => {
    // 数据齐了、解读没出来：**仍然出报**（事实层 + 标记），所以发的不是「失败」而是「完成」——
    // 「未生成」会在读者那里变成「今天没有日报」，而那正是我们要避免的那句假话。
    const notices: Array<Record<string, unknown>> = []
    const service = createDailyBriefingService({
      source: fakeSource(),
      store: memoryStore(),
      now: () => asOf,
      agentRunner: {
        async start() {
          return { sessionId: 's1', created: true, assistantText: '', toolInvocations: [] }
        },
        async continue() { return { assistantText: '', toolInvocations: [] } },
        async finish() { return undefined }
      },
      agentModel: async () => ({ state: 'agent', providerId: 'p', modelId: 'm', source: 'default' }),
      noticeSubmit: async (request) => {
        notices.push(request as unknown as Record<string, unknown>)
        return { kind: 'accepted', recordId: 'r1', levels: ['center', 'desktop'] }
      }
    })

    const result = await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    expect(result.state).toBe('available')
    expect(notices).toHaveLength(1)
    // A delivered brief is a completion notice, whatever the editor did: the reader opens it and sees
    // the numbers plus "this edition has no interpretation". A failure notice would say nothing ran.
    expect(notices[0]).toMatchObject({ eventTypeId: 'market-intelligence.briefing.ready' })
    expect(notices[0]).not.toHaveProperty('bodyVariant', 'editorial-missing')
  })
})
