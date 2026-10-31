import { describe, expect, it } from 'vitest'

import type { BriefingGenerationStageId, BriefingGenerationTrace, DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { DailyBriefAgentRunner } from './dailyBriefAgentRunner'
import type { DailyBriefingFactPacket } from './dailyBriefingFactPacket'
import { createDailyBriefingService, type DailyBriefingSource, type DailyBriefingStore, type DailyBriefingStoredEdition } from './dailyBriefingService'

const asOf = '2026-10-30T00:30:00.000Z'

const emptyPacket = (): DailyBriefingFactPacket => ({
  asOf,
  windowStart: '2026-10-29T00:30:00.000Z',
  windowEnd: asOf,
  windowHours: 24,
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

type AttemptRow = Readonly<{ date: string; locale: DailyBriefingLocale; trace: BriefingGenerationTrace }>

function memoryStore(overrides: Partial<DailyBriefingStore> = {}): DailyBriefingStore & {
  rows: Map<string, DailyBriefingStoredEdition>
  attempts: Map<string, BriefingGenerationTrace>
} {
  const rows = new Map<string, DailyBriefingStoredEdition>()
  const attempts = new Map<string, BriefingGenerationTrace>()
  const key = (date: string, locale: string): string => `${date}:${locale}`
  return {
    rows,
    attempts,
    async get(date, locale) { return rows.get(key(date, locale)) },
    async put(edition) { rows.set(key(edition.date, edition.locale), edition) },
    async list(from, to, locale) {
      return [...rows.values()].filter((row) => row.locale === locale && row.date >= from && row.date <= to)
    },
    async prune() {},
    async putAttempt(attempt: AttemptRow) { attempts.set(key(attempt.date, attempt.locale), attempt.trace) },
    async getAttempt(date, locale) { return attempts.get(key(date, locale)) },
    async clearAttempt(date, locale) { attempts.delete(key(date, locale)) },
    ...overrides
  }
}

function source(packet: () => DailyBriefingFactPacket = emptyPacket): DailyBriefingSource {
  return { async buildPacket() { return packet() } }
}

const validSelection = JSON.stringify({ stage: 'select', news: [], macro: [], next: [] })
const acceptedEditorial = JSON.stringify({ lede: '事实层导语。', ledePattern: 'event-shock', items: [], hidden: [], importance: [] })

function runner(input: Readonly<{
  start?: () => Promise<unknown>
  continue?: (message: string) => Promise<unknown>
}> = {}): DailyBriefAgentRunner {
  return {
    async start() {
      return input.start ? input.start() : { sessionId: 's1', created: true, assistantText: validSelection, toolInvocations: [] }
    },
    async continue(_sessionId: string, message: string) {
      return input.continue ? input.continue(message) : { assistantText: acceptedEditorial, toolInvocations: [] }
    },
    async finish() {}
  } as unknown as DailyBriefAgentRunner
}

function stage(trace: BriefingGenerationTrace, id: BriefingGenerationStageId) {
  return trace.stages.find((entry) => entry.id === id)
}

function traceOf(result: Awaited<ReturnType<ReturnType<typeof createDailyBriefingService>['getToday']>>): BriefingGenerationTrace {
  if (result.state === 'unavailable') {
    expect(result.generationTrace).toBeDefined()
    return result.generationTrace!
  }
  const trace = result.document.provenance.generationTrace
  expect(trace).toBeDefined()
  return trace!
}

describe('daily briefing generation trace', () => {
  it('records a successful attempt with the document and clears the failed-attempt record', async () => {
    const store = memoryStore()
    const service = createDailyBriefingService({ source: source(), store, now: () => asOf, agentRunner: runner() })

    const result = await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    const trace = traceOf(result)

    expect(trace.state).toBe('success')
    expect(stage(trace, 'source')?.state).toBe('success')
    expect(stage(trace, 'candidates')?.state).toBe('success')
    expect(stage(trace, 'selection')?.state).toBe('success')
    expect(stage(trace, 'field-backfill')?.state).toBe('skipped')
    expect(stage(trace, 'writing')?.state).toBe('success')
    expect(stage(trace, 'validation')?.state).toBe('success')
    expect(stage(trace, 'repair-1')?.state).toBe('skipped')
    expect(stage(trace, 'repair-2')?.state).toBe('skipped')
    expect(stage(trace, 'store')?.state).toBe('success')
    expect(store.attempts.size).toBe(0)
    expect(result.state).toBe('available')
    if (result.state === 'available') {
      expect(result.document.provenance.generationTrace).toEqual(trace)
      expect(store.rows.size).toBe(1)
    }
  })

  it('locates a source failure and persists the failed trace beside the edition key', async () => {
    const store = memoryStore()
    const service = createDailyBriefingService({
      source: { async buildPacket() { throw new Error('query failed') } },
      store, now: () => asOf
    })

    const result = await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    const trace = traceOf(result)

    expect(result.state).toBe('unavailable')
    if (result.state === 'unavailable') expect(result.failureCode).toBe('source-failed')
    expect(trace.state).toBe('failed')
    expect(stage(trace, 'source')).toMatchObject({ state: 'failed', failureCode: 'source-failed' })
    expect(stage(trace, 'candidates')?.state).toBe('skipped')
    expect(store.attempts.get('2026-10-30:zh-CN')?.state).toBe('failed')
    expect(store.rows.size).toBe(0)
  })

  it('locates an AI-selection failure', async () => {
    const store = memoryStore()
    const service = createDailyBriefingService({
      source: source(), store, now: () => asOf,
      agentRunner: runner({
        start: async () => ({ sessionId: 's1', created: true, assistantText: 'not json', toolInvocations: [] })
      })
    })

    const result = await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    const trace = traceOf(result)

    expect(trace.state).toBe('failed')
    expect(stage(trace, 'selection')).toMatchObject({ state: 'failed', failureCode: 'invalid-shape' })
    expect(stage(trace, 'writing')?.state).toBe('skipped')
    expect(result.state).toBe('available')
    if (result.state === 'available') {
      expect(result.document.provenance.editorialFailure).toBe('invalid-shape')
    }
  })

  it('records a truncated writing stage instead of calling every throw a timeout', async () => {
    const store = memoryStore()
    const service = createDailyBriefingService({
      source: source(), store, now: () => asOf,
      agentRunner: runner({
        continue: async () => { throw new Error('stop_reason=max_tokens: output truncated') }
      })
    })

    const result = await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    const trace = traceOf(result)

    expect(trace.state).toBe('failed')
    expect(stage(trace, 'writing')).toMatchObject({ state: 'failed', failureCode: 'agent-turn-output-truncated' })
    expect(stage(trace, 'validation')?.state).toBe('skipped')
    if (result.state === 'available') {
      expect(result.document.provenance.editorialFailure).toBe('agent-turn-output-truncated')
    }
  })

  it('locates a validation failure that exhausted both repairs', async () => {
    const store = memoryStore()
    const service = createDailyBriefingService({
      source: source(), store, now: () => asOf,
      agentRunner: runner({ continue: async () => ({ assistantText: '{}', toolInvocations: [] }) })
    })

    const result = await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    const trace = traceOf(result)

    expect(trace.state).toBe('failed')
    expect(stage(trace, 'validation')).toMatchObject({ state: 'failed', failureCode: expect.any(String) })
    expect(stage(trace, 'repair-1')?.state).toBe('success')
    expect(stage(trace, 'repair-2')?.state).toBe('success')
    expect(stage(trace, 'store')?.state).toBe('skipped')
  })

  it('locates a store failure and still persists the attempt', async () => {
    const attempts = new Map<string, BriefingGenerationTrace>()
    const store = memoryStore({
      async put() { throw new Error('disk full') },
      async putAttempt(attempt: AttemptRow) { attempts.set(`${attempt.date}:${attempt.locale}`, attempt.trace) }
    })
    const service = createDailyBriefingService({ source: source(), store, now: () => asOf, agentRunner: runner() })

    const result = await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    const trace = traceOf(result)

    expect(result.state).toBe('unavailable')
    if (result.state === 'unavailable') expect(result.failureCode).toBe('store-failed')
    expect(trace.state).toBe('failed')
    expect(stage(trace, 'store')).toMatchObject({ state: 'failed', failureCode: 'store-failed' })
    expect(attempts.get('2026-10-30:zh-CN')?.state).toBe('failed')
  })

  it('records an unavailable model as a selection failure', async () => {
    const store = memoryStore()
    const service = createDailyBriefingService({
      source: source(), store, now: () => asOf, agentRunner: runner(),
      agentModel: async () => ({ state: 'unavailable', reason: 'default-unavailable' })
    })

    const result = await service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    const trace = traceOf(result)

    expect(trace.state).toBe('failed')
    expect(stage(trace, 'selection')).toMatchObject({ state: 'failed', failureCode: 'model-unavailable' })
    expect(stage(trace, 'writing')?.state).toBe('skipped')
  })
})
