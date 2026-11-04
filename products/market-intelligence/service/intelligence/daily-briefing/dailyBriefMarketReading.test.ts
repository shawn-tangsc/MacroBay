import { describe, expect, it, vi } from 'vitest'

import { createCrossAssetSnapshotQuery } from '../cross-asset/crossAssetSnapshotQuery'
import { createMarketIntelligencePublicQueryService } from '../public-query/publicQueryService'
import { createIntelligencePipeline } from '../application/intelligencePipeline'
import { createRawRecordStore } from '../application/rawRecordStore'
import { briefingLateDataGraceMs, briefingMarketKnowledgeAt, briefingMarketReady, readBriefingMarketSnapshot } from './dailyBriefMarketReading'
import { createDailyBriefReadinessFor } from './dailyBriefReadinessGate'

/**
 * The rule this file exists for: a reading of "the 24 hours to the cutoff" admits bars stamped at or
 * before the cutoff that were **known within thirty minutes of it**.
 *
 * The morning it came from: the bar closing at 07:00 was ingested at 07:21, so the old rule (known
 * *at* the cutoff) could never see it. The gate then asked an impossible question and the edition
 * published with BTC and ETH missing — every morning, not once.
 */
const CUTOFF = '2026-11-03T23:00:00.000Z'
const CUTOFF_MS = Date.parse(CUTOFF)
const STEP_MS = 5 * 60_000

/** Bars every five minutes for the last day, all ingested at `observedAtMs`. */
function barsThroughCutoff(observedAtMs: number): readonly Readonly<{ barEndMs: number; close: string; observedAtMs: number }>[] {
  return Array.from({ length: 400 }, (_, index) => ({
    barEndMs: CUTOFF_MS - index * STEP_MS,
    close: String(100 + index),
    observedAtMs
  }))
}

function queryWith(bars: readonly Readonly<{ barEndMs: number; close: string; observedAtMs: number }>[], nowMs: number) {
  return createCrossAssetSnapshotQuery({
    now: () => nowMs,
    store: {
      revision: 1,
      queryAt: ({ fromMs, toMs, asOfMs }) => bars
        .filter((bar) => bar.barEndMs >= fromMs && bar.barEndMs < toMs && bar.observedAtMs <= asOfMs)
        .map((bar) => ({ barEndMs: bar.barEndMs, close: bar.close })) as never
    },
    live: () => ({ state: 'disabled' as const, quotes: { btc: { state: 'missing' as const }, eth: { state: 'missing' as const }, index: { state: 'missing' as const } } })
  })
}

const returnsOf = (snapshot: unknown): Readonly<Record<string, Record<string, { state: string }>>> =>
  (snapshot as { closedReturns: Readonly<Record<string, Record<string, { state: string }>>> }).closedReturns

describe('late data counts for thirty minutes, and only lapped at the cutoff', () => {
  it('admits the bar that closed at the cutoff and arrived twenty-one minutes later', () => {
    const now = CUTOFF_MS + 40 * 60_000
    const query = queryWith(barsThroughCutoff(CUTOFF_MS + 21 * 60_000), now)
    const snapshot = query.query({ range: '24h', asOf: CUTOFF, knowledgeAt: briefingMarketKnowledgeAt(CUTOFF)! })

    expect(returnsOf(snapshot).btc?.['24h']?.state).toBe('available')
    expect(returnsOf(snapshot).eth?.['24h']?.state).toBe('available')
    expect(briefingMarketReady(snapshot as never)).toBe(true)
  })

  it('does not admit a bar that arrived forty minutes late', () => {
    const now = CUTOFF_MS + 60 * 60_000
    const query = queryWith(barsThroughCutoff(CUTOFF_MS + 40 * 60_000), now)
    const snapshot = query.query({ range: '24h', asOf: CUTOFF, knowledgeAt: briefingMarketKnowledgeAt(CUTOFF)! })

    expect(returnsOf(snapshot).btc?.['24h']?.state).toBe('unavailable')
    expect(briefingMarketReady(snapshot as never)).toBe(false)
  })

  it('never admits a bar stamped after the cutoff, however early it arrived', () => {
    // The window ends at the cutoff. A bar from after it is not late data, it is another edition's
    // data, and letting it in would silently move the window.
    const now = CUTOFF_MS + 40 * 60_000
    const future = { barEndMs: CUTOFF_MS + STEP_MS, close: '999', observedAtMs: CUTOFF_MS + 60_000 }
    const query = queryWith([...barsThroughCutoff(CUTOFF_MS + 21 * 60_000), future], now)
    const snapshot = query.query({ range: '24h', asOf: CUTOFF, knowledgeAt: briefingMarketKnowledgeAt(CUTOFF)! })
    const closes = JSON.stringify(snapshot)

    expect(closes).not.toContain('999')
  })

  it('asks the same question from the gate and from the body', async () => {
    // One reader, one predicate: the gate cannot report ready for something the body will not read.
    const asked: unknown[] = []
    const snapshot = { closedReturns: { btc: { '24h': { state: 'available' } }, eth: { '24h': { state: 'available' } } } }
    const reader = {
      queryCrossAssetSnapshot: vi.fn(async (input: unknown) => { asked.push(input); return snapshot })
    }

    const gate = createDailyBriefReadinessFor(reader as never)
    const waited = await gate.wait(CUTOFF)
    const body = await readBriefingMarketSnapshot(reader as never, CUTOFF)

    expect(waited.ready).toBe(true)
    expect(asked).toHaveLength(2)
    expect(asked[0]).toEqual(asked[1])
    expect(asked[0]).toEqual({ range: '24h', asOf: CUTOFF, knowledgeAt: new Date(CUTOFF_MS + briefingLateDataGraceMs).toISOString() })
    expect(briefingMarketReady(body as never)).toBe(true)
  })
})

describe('the grace survives every layer it passes through', () => {
  it('hands knowledgeAt to the innermost query, not just to the caller next door', async () => {
    // The 2026-11-04 bug: the callers computed the grace and then an intermediate service rebuilt the
    // query input as `{ range, asOf }`, so the innermost query never saw it and every edition read the
    // frozen view again. Asserting on the top layer would have missed it — this spies the bottom one.
    const innermost = vi.fn((_input: unknown) => ({
      schemaVersion: 1, mode: 'historical', servedAt: CUTOFF, asOf: CUTOFF, analysisEnd: CUTOFF, windowStart: CUTOFF,
      historyCoverage: {}, curves: {}, closedReturns: { btc: { '24h': { state: 'available', value: 1 } }, eth: { '24h': { state: 'available', value: 1 } } },
      correlations: {}, relativeReturns: {}, indexSource: 'ustec'
    }))
    const service = createMarketIntelligencePublicQueryService({
      pipeline: createIntelligencePipeline({ rawRecordStore: createRawRecordStore() }),
      listSourceDefinitions: () => []
    })
    service.setCrossAssetQuery({ query: innermost })

    await readBriefingMarketSnapshot(service as never, CUTOFF)

    expect(innermost).toHaveBeenCalledTimes(1)
    expect(innermost.mock.calls.at(0)?.[0]).toMatchObject({
      range: '24h',
      asOf: CUTOFF,
      knowledgeAt: new Date(Date.parse(CUTOFF) + briefingLateDataGraceMs).toISOString()
    })
  })
})
