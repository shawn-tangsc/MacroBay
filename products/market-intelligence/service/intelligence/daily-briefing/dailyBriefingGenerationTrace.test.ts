import { describe, expect, it } from 'vitest'

import type { BriefingGenerationStageId, BriefingGenerationTrace, DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { DailyBriefAgentRunner } from './dailyBriefAgentRunner'
import type { DailyBriefingFactPacket } from './dailyBriefingFactPacket'
import { factSnapshotFromPacket } from './dailyBriefingFactSnapshot'
import { createDailyBriefingService, type DailyBriefingSource, type DailyBriefingStore, type DailyBriefingStoredEdition } from './dailyBriefingService'
import { createDailyBriefingGenerationRecorder } from './dailyBriefingGenerationTrace'

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


function memoryStore(overrides: Partial<DailyBriefingStore> = {}): DailyBriefingStore & {
  rows: Map<string, DailyBriefingStoredEdition>
  attempts: Map<string, BriefingGenerationTrace>
} {
  const rows = new Map<string, DailyBriefingStoredEdition>()
  const attempts = new Map<string, BriefingGenerationTrace>()
  const attemptCounts = new Map<string, number>()
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
    async beginAttempt(attempt) {
      const no = (attemptCounts.get(key(attempt.date, attempt.locale)) ?? 0) + 1
      attemptCounts.set(key(attempt.date, attempt.locale), no)
      return no
    },
    async finishAttempt(attempt) {
      if (attempt.trace) attempts.set(key(attempt.date, attempt.locale), attempt.trace)
    },
    async getAttempt(date, locale) { return attempts.get(key(date, locale)) },
    ...overrides
  }
}

function source(packet: () => DailyBriefingFactPacket = emptyPacket): DailyBriefingSource {
  return { async readFacts() { return factSnapshotFromPacket(packet()) }, async renderPacket(facts, locale, timeZone) { return Object.freeze({ ...packet(), locale, timeZone }) } }
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

describe('live progress snapshot', () => {
  it('keeps unstarted stages pending and never reports them as skipped', () => {
    let changes = 0
    const recorder = createDailyBriefingGenerationRecorder({
      attemptId: 'attempt-1',
      now: () => asOf,
      onChange: () => { changes += 1 }
    })

    recorder.begin('source')
    recorder.end('source', 'success')
    const snapshot = recorder.snapshot()

    expect(snapshot.attemptId).toBe('attempt-1')
    expect(snapshot.stages.find((stage) => stage.id === 'source')?.state).toBe('success')
    // Only a finished attempt may claim a stage was skipped; a running one cannot know yet.
    expect(snapshot.stages.filter((stage) => stage.id !== 'source').every((stage) => stage.state === 'pending')).toBe(true)
    expect(changes).toBe(2)
  })

  it('announces a change only when the attempt actually changed', () => {
    let changes = 0
    const recorder = createDailyBriefingGenerationRecorder({
      attemptId: 'attempt-2',
      now: () => asOf,
      onChange: () => { changes += 1 }
    })

    recorder.begin('source')
    recorder.begin('source')
    recorder.skip('repair-1')
    recorder.skip('repair-1')

    // Two distinct stages spoke; the repeated calls were no-ops.
    expect(changes).toBe(2)
  })
})

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
      source: { async readFacts() { throw new Error('query failed') }, async renderPacket() { throw new Error('query failed') } },
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
      async finishAttempt(attempt) { if (attempt.trace) attempts.set(`${attempt.date}:${attempt.locale}`, attempt.trace) }
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

/**
 * A stage that runs twice reports its latest segment.
 *
 * Validation runs, fails, hands off to a repair, then runs again. If the second begin were ignored
 * (the old behaviour), the validation row's window would swallow the repair's seconds and two rows
 * would show one set of numbers — the reader cannot tell which one actually spent the time.
 */
describe('a repeated stage reports its last segment', () => {
  it('gives the second segment its own start, and drops the first window', () => {
    let clock = Date.parse('2026-11-04T00:00:00.000Z')
    const recorder = createDailyBriefingGenerationRecorder({ attemptId: 'a', now: () => new Date(clock).toISOString() })

    recorder.begin('validation')
    clock += 1_000
    recorder.end('validation', 'failed', { failureCode: 'schema-validation-failed' })
    recorder.begin('repair-1')
    clock += 8_000
    recorder.end('repair-1', 'success')
    clock += 100
    recorder.begin('validation')
    clock += 500
    recorder.end('validation', 'success')

    const stages = recorder.snapshot().stages
    const validation = stages.find((stage) => stage.id === 'validation')
    const repair = stages.find((stage) => stage.id === 'repair-1')

    expect(validation?.startedAt).toBe('2026-11-04T00:00:09.100Z')
    expect(validation?.durationMs).toBe(500)
    // The repair keeps the seconds it spent, and the two rows no longer share a window.
    expect(repair?.startedAt).toBe('2026-11-04T00:00:01.000Z')
    expect(repair?.durationMs).toBe(8_000)
    expect(Date.parse(validation!.startedAt!)).toBeGreaterThan(Date.parse(repair!.finishedAt!))
  })
})

describe('a stage that runs more than once', () => {
  it("counts its segments and keeps the last one's timing", () => {
    // A clock that advances a second per read: the last segment's own start and end are then known
    // apart from every other read the recorder makes (the constructor reads it once too).
    let tick = Date.parse('2026-11-05T00:00:00.000Z')
    const recorder = createDailyBriefingGenerationRecorder({ attemptId: 'a', now: () => new Date((tick += 1_000)).toISOString() })
    // Validation ran, failed, ran again, failed again, ran a third time.
    recorder.begin('validation'); recorder.end('validation', 'failed')
    recorder.begin('validation'); recorder.end('validation', 'failed')
    recorder.begin('validation'); recorder.end('validation', 'failed')
    const trace = recorder.complete('failed')
    const validation = trace.stages.find((stage) => stage.id === 'validation')!
    // Three runs, one row, the last segment's own second: the count is what makes "it retried" visible
    // instead of implied by a timestamp the reader has to compare against someone else's.
    expect(validation.runs).toBe(3)
    expect(validation.durationMs).toBe(1_000)
    // A stage that ran once carries no count, so every existing trace keeps its shape.
    expect(trace.stages.find((stage) => stage.id === 'writing')?.runs).toBeUndefined()
  })
})
