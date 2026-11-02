import { describe, expect, it } from 'vitest'
import { factSnapshotFromPacket } from './dailyBriefingFactSnapshot'

import type { DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { DailyBriefingFactPacket } from './dailyBriefingFactPacket'
import {
  createDailyBriefingService,
  type DailyBriefingSource,
  type DailyBriefingStore,
  type DailyBriefingStoredEdition
} from './dailyBriefingService'

/**
 * The live progress of a running generation.
 *
 * Two properties are worth pinning because they are the ones a later refactor would quietly break:
 * stages that have not begun must stay `pending` (only a finished attempt may call them skipped),
 * and the snapshot must disappear when the attempt settles, so the store keeps being the only copy
 * of a finished trace.
 */

const now = '2026-11-02T02:00:00.000Z'

function memoryStore(): DailyBriefingStore {
  const rows = new Map<string, DailyBriefingStoredEdition>()
  return {
    async get(date, locale) {
      return rows.get(`${date}:${locale}`)
    },
    async put(edition) {
      rows.set(`${edition.date}:${edition.locale}`, edition)
    },
    async list(from, to, locale) {
      return [...rows.values()].filter((row) => row.locale === locale && row.date >= from && row.date <= to)
    },
    async prune() {
      return undefined
    }
  }
}

function emptyPacket(input: Readonly<{ asOf: string; windowHours: number }>): DailyBriefingFactPacket {
  return {
    asOf: input.asOf,
    windowStart: new Date(Date.parse(input.asOf) - input.windowHours * 60 * 60 * 1_000).toISOString(),
    windowEnd: input.asOf,
    windowHours: input.windowHours,
    locale: 'zh-CN',
    timeZone: 'Asia/Shanghai',
    conclusion: null,
    news: { state: 'empty', items: [] },
    calendar: { state: 'source-disabled', events: [] },
    readings: {
      fearGreed: { state: 'empty', asOf: input.asOf },
      funding: { state: 'empty', asOf: input.asOf },
      capital: { state: 'empty', asOf: input.asOf }
    },
    market: {},
    enabled: { fearGreed: false, funding: false, stablecoin: false, etf: false, calendar: false }
  }
}

/** A source that stays inside the first stage until the test releases it. */
function gatedSource(): DailyBriefingSource & { release: () => void; entered: Promise<void> } {
  let release: () => void = () => undefined
  let entered: () => void = () => undefined
  const gate = new Promise<void>((resolve) => { release = resolve })
  const didEnter = new Promise<void>((resolve) => { entered = resolve })
  return {
    entered: didEnter,
    release: () => release(),
    async readFacts(input: Readonly<{ asOf: string; windowHours?: number }>) {
      entered()
      await gate
      return factSnapshotFromPacket(emptyPacket({ asOf: input.asOf, windowHours: input.windowHours ?? 24 }))
    },
    async renderPacket(facts: Readonly<{ asOf: string; windowHours: number }>, locale: DailyBriefingLocale, timeZone: string) {
      return Object.freeze({ ...emptyPacket({ asOf: facts.asOf, windowHours: facts.windowHours }), locale, timeZone })
    }
  }
}

function serviceWith(source: DailyBriefingSource): ReturnType<typeof createDailyBriefingService> {
  return createDailyBriefingService({
    source,
    store: memoryStore(),
    now: () => now,
    generationSettings: async () => ({ generationTime: '08:00', windowHours: 24 })
  })
}

describe('daily briefing generation progress', () => {
  it('says nothing is running before a generation starts', async () => {
    const service = serviceWith(gatedSource())
    expect(await service.getProgress({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })).toEqual({ state: 'idle' })
  })

  it('reports the stage that is running, and leaves unstarted stages pending', async () => {
    const source = gatedSource()
    const service = serviceWith(source)
    const running = service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    await source.entered

    const progress = await service.getProgress({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    expect(progress.state).toBe('running')
    if (progress.state !== 'running') return
    const [first, second] = progress.progress.stages
    expect(first).toMatchObject({ id: 'source', state: 'pending' })
    expect(first?.startedAt).toBeDefined()
    // Nothing has begun after the first stage, and a running attempt may not claim a stage was skipped.
    expect(second).toEqual({ id: 'candidates', state: 'pending' })
    expect(progress.progress.stages.every((stage) => stage.state !== 'skipped')).toBe(true)

    source.release()
    await running
  })

  it('drops the live copy once the attempt settles, so the stored trace stays the only one', async () => {
    const source = gatedSource()
    const service = serviceWith(source)
    const running = service.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    await source.entered
    source.release()
    const result = await running

    expect(await service.getProgress({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })).toEqual({ state: 'idle' })
    if (result.state === 'available') {
      // The finished attempt still carries its own trace; dropping the snapshot lost nothing.
      expect(result.document.provenance.generationTrace?.stages.length).toBeGreaterThan(0)
    } else {
      expect(result.state).toBe('unavailable')
    }
  })
})
