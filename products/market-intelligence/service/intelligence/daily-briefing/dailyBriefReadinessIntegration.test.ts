import { describe, expect, it, vi } from 'vitest'

import { createDailyBriefingService, type DailyBriefingStore } from './dailyBriefingService'
import { createDailyBriefReadiness, createDailyBriefReadinessFor } from './dailyBriefReadinessGate'

/**
 * The gate as the generation path actually uses it.
 *
 * The unit tests above prove the polling policy; these prove the two things only the wiring can show:
 * nothing is recorded while the brief is waiting, and the probe asks about the edition's cutoff rather
 * than about the moment it happens to run.
 */
const TIME_ZONE = 'Asia/Shanghai'
const NOW = '2026-11-03T23:08:00.000Z'
/** 07:00 on 11-04 in Shanghai: the cutoff the generation will read and the probe must ask about. */
const CUTOFF = '2026-11-03T23:00:00.000Z'

const readySnapshot = {
  closedReturns: { btc: { '24h': { state: 'available' } }, eth: { '24h': { state: 'available' } }, index: { '24h': { state: 'unavailable' } } }
}

function store(beginAttempt: (input: unknown) => Promise<number>): DailyBriefingStore {
  return {
    async get() { return undefined },
    async put() {},
    async list() { return [] },
    async prune() {},
    beginAttempt
  } as unknown as DailyBriefingStore
}

describe('the index is never a reason to wait', () => {
  it('does not wait for the index row, which is often late', async () => {
    // The cell that would otherwise burn fifteen minutes every morning: readable snapshot with BTC
    // and ETH priced is ready, even though the index is not.
    const sleep = vi.fn(async () => undefined)
    const gate = createDailyBriefReadiness({ readSnapshot: async () => readySnapshot, sleep })
    const service = createDailyBriefingService({
      source: { readFacts: vi.fn(async () => { throw new Error('not under test') }) } as never,
      store: store(async () => 1),
      readiness: gate,
      editorialEnabled: async () => false,
      now: () => NOW
    })

    await service.getToday({ locale: 'zh-CN', timeZone: TIME_ZONE }).catch(() => undefined)

    expect(sleep).not.toHaveBeenCalled()
  })
})

describe('a wait that runs out still produces the edition once', () => {
  it('reports the timeout and starts exactly one run afterwards', async () => {
    const attempts: unknown[] = []
    let clock = 0
    const gate = createDailyBriefReadiness({
      readSnapshot: async () => undefined,
      sleep: async (ms) => { clock += ms },
      now: () => clock,
      pollMs: 30_000,
      budgetMs: 60_000
    })
    const service = createDailyBriefingService({
      source: { readFacts: vi.fn(async () => { throw new Error('not under test') }) } as never,
      store: store(async (input) => { attempts.push(input); return 1 }),
      readiness: gate,
      editorialEnabled: async () => false,
      now: () => NOW
    })

    await service.getToday({ locale: 'zh-CN', timeZone: TIME_ZONE }).catch(() => undefined)

    // One attempt, opened only after the budget expired.
    expect(attempts).toHaveLength(1)
    expect(clock).toBeGreaterThan(0)
  })
})

describe('a manual run does not wait', () => {
  it('goes straight to work when the reader pressed 重新生成', async () => {
    // Waiting fifteen minutes on a button the reader just pressed is the feature being unusable: the
    // gate is for automatic runs, which nobody is watching.
    const wait = vi.fn(async () => ({ ready: false, polls: 1, waitedMs: 0 }))
    const gate = createDailyBriefReadiness({ readSnapshot: async () => undefined })
    const spaced = { ...gate, wait }
    let attempts = 0
    const service = createDailyBriefingService({
      source: { readFacts: vi.fn(async () => { throw new Error('not under test') }) } as never,
      store: store(async () => { attempts += 1; return 1 }),
      readiness: spaced,
      editorialEnabled: async () => false,
      now: () => NOW
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      await service.regenerate({ locale: 'zh-CN', timeZone: TIME_ZONE }).catch(() => undefined)
      expect(wait).not.toHaveBeenCalled()
      // The run opened its attempt row at once, instead of waiting for a market it was told to skip.
      expect(attempts).toBe(1)
      expect(log.mock.calls.map((call) => String(call[0])).join('\n')).toContain('MI_DAILY_BRIEF_READINESS_SKIPPED_MANUAL')
    } finally {
      log.mockRestore()
    }
  })
})

describe('the wait itself is published', () => {
  it('reports a running attempt with its probe count, before any attempt row exists', async () => {
    // "One running, no attempt row, no session" was the reader's whole complaint: the wait recorded
    // nothing, so nothing on screen could say it was waiting rather than stuck.
    const seen: unknown[] = []
    const holder: { service?: ReturnType<typeof createDailyBriefingService> } = {}
    let probes = 0
    const gate = createDailyBriefReadiness({
      readSnapshot: async () => {
        probes += 1
        seen.push(await holder.service!.getProgress({ locale: 'zh-CN', timeZone: TIME_ZONE }))
        return probes >= 2 ? readySnapshot : undefined
      },
      sleep: async () => undefined
    })
    let attempts = 0
    holder.service = createDailyBriefingService({
      source: { readFacts: vi.fn(async () => { throw new Error('not under test') }) } as never,
      store: store(async () => { attempts += 1; return 1 }),
      readiness: gate,
      editorialEnabled: async () => false,
      now: () => NOW
    })

    await holder.service.getToday({ locale: 'zh-CN', timeZone: TIME_ZONE }).catch(() => undefined)

    const first = seen[0] as { state: string; progress?: { waiting?: { polls: number; budgetMs: number } } }
    expect(first.state).toBe('running')
    expect(first.progress?.waiting?.polls).toBe(0)
    expect(first.progress?.waiting?.budgetMs).toBeGreaterThan(0)
    // The probe count moves while the wait goes on, and no attempt row exists yet.
    const second = seen[1] as { progress?: { waiting?: { polls: number } } }
    expect(second.progress?.waiting?.polls).toBe(1)
    expect(attempts).toBe(1)
  })
})

describe('generation waits before it records anything', () => {
  it('opens no attempt while the market is unreadable, and probes with the edition’s cutoff', async () => {
    const order: string[] = []
    const probes: string[] = []
    const gate = createDailyBriefReadiness({
      readSnapshot: async (asOf) => {
        probes.push(asOf)
        order.push('probe')
        return probes.length >= 2 ? readySnapshot : undefined
      },
      sleep: async () => { order.push('sleep') }
    })
    const service = createDailyBriefingService({
      source: { readFacts: vi.fn(async () => { throw new Error('not under test') }) } as never,
      store: store(async () => { order.push('attempt'); return 1 }),
      readiness: gate,
      editorialEnabled: async () => false,
      now: () => NOW
    })

    await service.getToday({ locale: 'zh-CN', timeZone: TIME_ZONE }).catch(() => undefined)

    // The first probe saw no attempt row, and the attempt only opened after the wait finished.
    expect(order.slice(0, 2)).toEqual(['probe', 'sleep'])
    expect(order.indexOf('attempt')).toBeGreaterThan(order.lastIndexOf('probe'))
    // Both probes asked about the edition's cutoff, never about `Date.now()`.
    expect(probes).toEqual([CUTOFF, CUTOFF])
  })
})

describe('every probe says what it asked and what came back', () => {
  it('logs the cutoff, whether a snapshot arrived, and each quote’s state', async () => {
    // "Waiting for the market" that nobody can audit is how a run spends fifteen minutes for a reason
    // no one can name afterwards: a historical cutoff asked of a current snapshot, or a quote that is
    // genuinely unavailable, have different fixes.
    const calls: string[] = []
    const log = vi.spyOn(console, 'log').mockImplementation((line: unknown) => { calls.push(String(line)) })
    try {
      const gate = createDailyBriefReadinessFor({
        queryCrossAssetSnapshot: async () => ({
          closedReturns: {
            btc: { '24h': { state: 'available' } },
            eth: { '24h': { state: 'available' } },
            index: { '24h': { state: 'unavailable', reason: 'missing' } }
          }
        }) as never,
        getCrossAssetQueryFailure: () => ({ reason: 'shape' })
      })
      await gate.wait(CUTOFF)

      const probe = calls.map((line) => JSON.parse(line) as Record<string, unknown>).find((entry) => entry.marker === 'MI_DAILY_BRIEF_READINESS_PROBE')
      expect(probe).toMatchObject({
        asOf: CUTOFF,
        snapshot: true,
        btc: 'available',
        eth: 'available',
        index: 'unavailable',
        // 「没数据」与「数据太旧」在日志里必须分得开：reason 是这两者的唯一区分。
        indexReason: 'missing',
        failure: { reason: 'shape' }
      })
    } finally {
      log.mockRestore()
    }
  })
})

describe('the readiness markers land where an operator can find them', () => {
  it('writes the probe and both timeout markers through the injected log, not stdout', async () => {
    // 只在 console 里打，就等于「终端关掉后那十五分钟没有任何记录」。这里钉的是落点：
    // 注入了日志就只走它，marker 名不变、字段不变。
    const lines: Array<{ level: string; event: string; fields: Record<string, unknown> }> = []
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      const gate = createDailyBriefReadinessFor({
        queryCrossAssetSnapshot: async () => ({
          closedReturns: {
            btc: { '24h': { state: 'unavailable', reason: 'missing' } },
            eth: { '24h': { state: 'unavailable', reason: 'missing' } },
            index: { '24h': { state: 'unavailable', reason: 'missing' } }
          }
        }) as never
      }, { log: (level, event, fields) => { lines.push({ level, event, fields: fields ?? {} }) }, budgetMs: 0 })

      await gate.wait(CUTOFF)
      gate.onTimeout?.({ polls: 1, waitedMs: 0 })

      expect(lines.map((line) => line.event)).toEqual([
        'MI_DAILY_BRIEF_READINESS_PROBE',
        'MI_DAILY_BRIEF_CORE_FACTS_NOT_READY',
        'MI_DAILY_BRIEF_LATE_DATA_EXCEEDED'
      ])
      expect(lines[0]?.fields).toMatchObject({ btc: 'unavailable', btcReason: 'missing' })
      // 走落盘日志时 console 一条都不该再出：两份记录会让排障时以哪份为准都说不清。
      expect(consoleSpy).not.toHaveBeenCalled()
    } finally {
      consoleSpy.mockRestore()
    }
  })
})
