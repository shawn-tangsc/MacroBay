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
  /** 尝试记录：列表的"这一天有痕迹"以它为准，运行记录（审计）不参与。 */
  attempts: Array<Readonly<{ date: string; periodId: string; locale: 'zh-CN' | 'en-US'; state: 'running' | 'succeeded' | 'failed'; startedAt: string }>>
} {
  const rows = new Map<string, DailyBriefingStoredEdition>()
  const runs: DailyBriefingPeriodRun[] = []
  const pruned: string[] = []
  const attempts: Array<Readonly<{ date: string; periodId: string; locale: 'zh-CN' | 'en-US'; state: 'running' | 'succeeded' | 'failed'; startedAt: string }>> = []
  const key = (date: string, locale: string) => `${date}:${locale}`
  return {
    rows,
    runs,
    pruned,
    attempts,
    async listAttempts(date, locale, periodId = 'default') {
      return attempts.filter((attempt) => attempt.date === date && attempt.locale === locale && attempt.periodId === periodId)
        .map((attempt, index) => ({ attemptNo: index + 1, state: attempt.state, startedAt: attempt.startedAt })) as never
    },
    async listAttemptRuns(from, to) {
      return attempts.filter((attempt) => attempt.date >= from && attempt.date <= to)
    },
    async get(date, locale) { return rows.get(key(date, locale)) },
    async put(edition) { rows.set(key(edition.date, edition.locale), edition) },
    async list(from, to, locale) {
      return [...rows.values()].filter((row) => row.locale === locale && row.date >= from && row.date <= to)
    },
    async listPeriodRuns(from, to) {
      return runs.filter((run) => run.date >= from && run.date <= to)
    },
    async getPeriodRun(date, periodId = 'default', locale = 'zh-CN') {
      return runs.find((run) => run.date === date && run.periodId === periodId && run.locale === locale)
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
    locale: 'zh-CN',
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
    // 08:30 本地、截止 09:30：**日期仍是今天**（没有"当前期"这回事，`02` v2.132），
    // 但窗口右端不许伸进未来——还没到那一刻，就截止到"现在"。
    expect(briefingWindow('2026-10-30T00:30:00.000Z', 'Asia/Shanghai', { generationTime: '09:30' })).toEqual({
      date: '2026-10-30', windowStart: '2026-10-29T00:30:00.000Z', windowEnd: '2026-10-30T00:30:00.000Z', windowHours: 24, zoneSource: 'settings'
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

  it('does not publish a template edition when the agent turn fails, and records the failure', async () => {
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
    // 写作没出来就**不发布**（用户 2026-11-06 拍板）：模板版一旦落库，页面就有正文可开、库里还记成功，
    // 三处口径互相打架。现在这一跑如实返回失败，库里没有版次。
    expect(result.state).toBe('unavailable')
    if (result.state === 'unavailable') expect(result.failureCode).toBe('invalid-shape')
    expect(store.rows.size).toBe(0)
  })

  it('cancels the runtime session, and still publishes the data with the reason when the editorial deadline fires', async () => {
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
      // 超时属模型类原因（r17 情形二）：版次照发（读者拿到数据），但原因写进 provenance、
      // 这次尝试记失败——不是"悄悄发一份看起来完整的模板版"。
      expect(result.state).toBe('available')
      expect(store.rows.size).toBe(1)
      expect((await links.findBySession('s-timeout'))?.state).toBe('abandoned')
      if (result.state === 'available') {
        expect(result.document.provenance.editorialFailure).toBe('editorial-timeout')
        expect(result.document.lede.source).not.toBe('agent')
      }
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
      // 会话都没建起来也一样：数据是真拿到的，版次照发，原因记在 provenance。
      expect(result.state).toBe('available')
      expect(store.rows.size).toBe(1)
      if (result.state === 'available') expect(result.document.provenance.editorialFailure).toBe('editorial-timeout')
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

  it('publishes the data with the reason when no model can be called', async () => {
    const store = memoryStore()
    const starts: number[] = []
    const service = createDailyBriefingService({
      source: fakeSource(), store, now: () => asOf,
      agentRunner: acceptingAgentRunner(starts),
      agentModel: async () => ({ state: 'unavailable', reason: 'default-unavailable' })
    })
    const result = await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })

    expect(starts).toHaveLength(0)
    // r17 情形一（2026-11-09 翻 11-06 的"干脆不出"）：没配模型的读者也要拿到这一天——
    // 数据照发，provenance 写下原因，页面据此说「本期只有数据，没有 AI 写的解读」。
    expect(store.rows.size).toBe(1)
    expect(result.state).toBe('available')
    if (result.state === 'available') {
      expect(result.document.provenance.editorialFailure).toBe('model-unavailable')
      expect(result.document.lede.source).not.toBe('agent')
    }
  })

  it('records the data-only edition and its failed attempt in the same write', async () => {
    const store = createDailyBriefingSqliteStore(':memory:')
    const service = createDailyBriefingService({
      source: fakeSource(), store, now: () => asOf,
      agentRunner: acceptingAgentRunner(),
      agentModel: async () => ({ state: 'unavailable', reason: 'default-unavailable' })
    })
    const result = await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })

    expect(result.state).toBe('available')
    // 版次在、这次尝试记 failed：读者拿到数据，审计里也看得出"解读没出来"。
    expect(await store.get('2026-10-30', 'zh-CN')).toBeTruthy()
    const attempts = await store.listAttempts!('2026-10-30', 'zh-CN')
    expect(attempts.map((attempt) => attempt.state)).toContain('failed')
  })

  it('does not deliver a completion notice for a data-only edition that is marked failed', async () => {
    // 模型这一类失败照发数据版，但这一期在库里是 failed。推一条「完成」到手机就是把失败画成
    // 成功（用户红线）。记录照写、deliver 关掉：手动「推送到手机」仍能核对是哪一版，表面一声不响。
    const notices: Array<Record<string, unknown>> = []
    const service = createDailyBriefingService({
      source: fakeSource(), store: memoryStore(), now: () => asOf,
      agentRunner: acceptingAgentRunner(),
      agentModel: async () => ({ state: 'unavailable', reason: 'default-unavailable' }),
      noticeSubmit: async (request) => {
        notices.push(request as unknown as Record<string, unknown>)
        return { kind: 'accepted', recordId: 'r1', levels: ['center'], suppressedLevels: [] }
      }
    })
    const result = await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })

    expect(result.state).toBe('available')
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ eventTypeId: 'market-intelligence.briefing.ready', deliver: false })
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
    // 解析不出模型可用性也是模型类原因：照发数据，原因写进 provenance（不记成功）。
    expect(store.rows.size).toBe(1)
    expect(result.state).toBe('available')
    if (result.state === 'available') expect(result.document.provenance.editorialFailure).toBe('model-unavailable')
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

  it('draws a day only where there is a trace: an edition, an attempt, or today', async () => {
    // 三向规则（2026-11-05 定，`9456b52`）：有版次或有运行的日子出现，今天永远出现，**空着的过去日子不出现**。
    // 这条用例以前断言「固定铺满 14 天」，那是旧口径；现在按规则本身断言，两个来源各构造一次。
    const store = memoryStore()
    const service = createDailyBriefingService({ source: fakeSource(), store, now: () => asOf })
    await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })

    // 有版次、没有运行：这一版还在，日子必须出现。
    store.rows.set('2026-10-28:zh-CN', storedEdition('2026-10-28'))
    // 有尝试、版次已被删：天头仍要在（读者删过这一版，尝试记录留着——审计表不参与渲染）。
    store.attempts.push({ date: '2026-10-27', periodId: 'default', locale: 'zh-CN', state: 'failed', startedAt: '2026-10-27T00:00:00.000Z' })

    const listed = await service.list({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    expect(listed.state).toBe('available')
    if (listed.state !== 'available') return
    // 新到旧；今天在最上，空着的 10-29 不出现。
    expect(listed.result.dates).toEqual(['2026-10-30', '2026-10-28', '2026-10-27'])
    expect(listed.result.dates).not.toContain('2026-10-29')
    expect(listed.result.editions.map((edition) => edition.date)).toEqual(expect.arrayContaining(['2026-10-30', '2026-10-28']))
  })

  it('never lets an audit row change what the list shows', async () => {
    // `A0.16`（`02` v2.154）：日志/审计表只回答"发生过什么"，不许参与"现在该显示什么"。
    // 唯一例外是删除审计（读者意图，只影响补跑判断）。这条用例守的是正常路径：往运行记录里塞一行，
    // 列表与天头逐字不变。
    const store = createDailyBriefingSqliteStore(':memory:')
    const service = createDailyBriefingService({ source: fakeSource(), store, now: () => asOf })
    await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    const before = await service.list({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    expect(before.state).toBe('available')
    if (before.state !== 'available') return

    // 一条只存在于审计表里的"运行"：它有日期、有期号，但没有任何版次与尝试。
    await store.openPeriodRun!({
      date: '2026-10-27', periodId: 'period_audit_only', locale: 'zh-CN', expectedLocales: ['zh-CN'],
      primaryRequested: 'zh-CN', primaryUsed: 'zh-CN', snapshotId: 'bs_audit', snapshotHash: 'h',
      contentVersion: 1, writingRounds: 1, direction: 'bearish', editionRows: [], state: 'failed',
      startedAt: '2026-10-27T00:00:00.000Z'
    })

    const after = await service.list({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    expect(after.state).toBe('available')
    if (after.state !== 'available') return
    // 天头不多一天、行不多一行：审计表不参与渲染。
    expect(after.result.dates).toEqual(before.result.dates)
    expect(after.result.editions.map((edition) => edition.periodId))
      .toEqual(before.result.editions.map((edition) => edition.periodId))
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

    const run = await store.getPeriodRun?.('2026-10-30', 'default', 'zh-CN')
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

  it('files a manual regenerate as a manual period, even when no cutoff was chosen', async () => {
    // 用户实测那版（11/06 02:59）：点「手动生成」没改时刻直接按生成，文档写成
    // `periodKind=scheduled` + `runTrigger=manual`，列表于是显示成「定时」。
    // `02` v2.134 G9：期次类型一处推导——手动发起就是手动期。
    const store = createDailyBriefingSqliteStore(':memory:')
    const service = createDailyBriefingService({ source: fakeSource(), store, now: () => asOf })
    const result = await service.regenerate({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })

    expect(result.state).toBe('available')
    if (result.state !== 'available') return
    expect(result.document.edition).toMatchObject({ periodKind: 'manual', runTrigger: 'manual' })
    // 两者不许再各说各的：这是同一件事的两种说法，只能同时成立。
    expect(`${result.document.edition.periodKind}|${result.document.edition.runTrigger}`).toBe('manual|manual')
  })

  it('keeps one edition when a second period claims the same (date, cutoff, language)', async () => {
    // 用户 2026-11-06：「同一个时间，同一个窗口同一个语言生成了两份简报」。槽的身份是
    // (日期, 截止时刻, 语言)：第二个期号来抢同一个槽时，写进已有那一版，不再插一行。
    const store = createDailyBriefingSqliteStore(':memory:')
    const service = createDailyBriefingService({ source: fakeSource(), store, now: () => asOf })

    const first = await service.regenerate({
      locale: 'zh-CN', timeZone: 'Asia/Shanghai', periodId: 'period_a',
      rerun: { periodTime: '2026-10-29T23:00:00.000Z', windowHours: 24 }
    })
    const second = await service.regenerate({
      locale: 'zh-CN', timeZone: 'Asia/Shanghai', periodId: 'period_b',
      rerun: { periodTime: '2026-10-29T23:00:00.000Z', windowHours: 12 }
    })

    expect(first.state).toBe('available')
    expect(second.state).toBe('available')
    // 库里只有一版，而且就是第一个期号占着的那个槽——后来的那次写进了它。
    const listed = await store.list('2026-10-29', '2026-10-31', 'zh-CN')
    expect(listed).toHaveLength(1)
    expect(listed[0]?.periodId).toBe('period_a')
    expect(await store.get('2026-10-30', 'zh-CN', 'period_b')).toBeUndefined()
    if (second.state === 'available') expect(second.document.edition.periodId).toBe('period_a')
  })

  it('refuses a manual run outside the last three days, with a readable reason', async () => {
    // 用户 2026-11-06：手动生成只允许最近 3 天（含今天）；服务端也要拒——界面挡不住 bug 与直接调接口，
    // 而每次生成都是一次模型调用。
    const store = createDailyBriefingSqliteStore(':memory:')
    const service = createDailyBriefingService({ source: fakeSource(), store, now: () => asOf })
    // `asOf` = 2026-10-30 08:30 本地；10 天前那一版 → 超窗。
    const tooOld = await service.regenerate({
      locale: 'zh-CN', timeZone: 'Asia/Shanghai', periodId: 'period_old',
      generation: { asOf: '2026-10-19T23:00:00.000Z', windowHours: 24 }
    })
    expect(tooOld).toMatchObject({ state: 'unavailable', failureCode: 'date-out-of-window' })
    // 未来同理。
    const future = await service.regenerate({
      locale: 'zh-CN', timeZone: 'Asia/Shanghai', periodId: 'period_future',
      generation: { asOf: '2026-11-02T23:00:00.000Z', windowHours: 24 }
    })
    expect(future).toMatchObject({ state: 'unavailable', failureCode: 'date-out-of-window' })
    // 窗口内的（2 天前）照常跑。
    const inside = await service.regenerate({
      locale: 'zh-CN', timeZone: 'Asia/Shanghai', periodId: 'period_inside',
      generation: { asOf: '2026-10-27T23:00:00.000Z', windowHours: 24 }
    })
    expect(inside.state).toBe('available')
  })

  it('records a failed run when the source cannot be read', async () => {
    const store = createDailyBriefingSqliteStore(':memory:')
    const failing: DailyBriefingSource = {
      async readFacts() { throw new Error('source-down') },
      async renderPacket() { throw new Error('source-down') }
    }
    const service = createDailyBriefingService({ source: failing, store, now: () => asOf })
    expect((await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })).state).toBe('unavailable')
    expect(await store.getPeriodRun?.('2026-10-30', 'default', 'zh-CN')).toBeUndefined()
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
        return { kind: 'accepted', recordId: 'r1', levels: ['center'], suppressedLevels: [] }
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

  it('does not submit again when a later read finds the stored edition', async () => {
    // 触发点是「生成并落库之后」，不是每次读：同一个版次再读一次不该再响一声。
    const { service, notices } = completedRun()

    await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    const again = await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })

    expect(again.state).toBe('available')
    expect(notices).toHaveLength(1)
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
        return { kind: 'accepted', recordId: 'r1', levels: ['center', 'desktop'], suppressedLevels: [] }
      }
    })

    expect((await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })).state).toBe('unavailable')
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({
      eventTypeId: 'market-intelligence.briefing.failed',
      rendered: { 'zh-CN': { body: expect.stringContaining('这一期没有生成出来') } }
    })
  })

  it('N5 ②（2026-11-06 用户翻案）：data ready but the interpretation missing is a failure notice, not a completion', async () => {
    // 以前"数据齐、解读没出来"照发出报并报「完成」。用户 2026-11-06 拍板：写作失败不许发布模板版，
    // 也不许记成功——所以现在发的是一条 `editorial-missing` 的失败通知，页面说失败、库也记失败。
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
        return { kind: 'accepted', recordId: 'r1', levels: ['center', 'desktop'], suppressedLevels: [] }
      }
    })

    const result = await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    expect(result.state).toBe('unavailable')
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({
      eventTypeId: 'market-intelligence.briefing.failed',
      rendered: { 'zh-CN': { body: expect.stringContaining('这一期数据齐了') } }
    })
  })
})
