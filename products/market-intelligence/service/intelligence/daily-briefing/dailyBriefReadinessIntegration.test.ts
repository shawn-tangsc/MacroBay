import { describe, expect, it, vi } from 'vitest'

import { createDailyBriefingService, type DailyBriefingStore } from './dailyBriefingService'
import { createDailyBriefReadiness } from './dailyBriefReadinessGate'

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
