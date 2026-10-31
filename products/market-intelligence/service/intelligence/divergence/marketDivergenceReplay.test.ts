import { describe, expect, it } from 'vitest'

import { queryMarketDivergenceAsync, type DivergenceLegReader } from './marketDivergenceQuery'
import { divergenceReplay, type DivergenceReplayRecord, type ReplayReading } from './marketDivergenceReplay.fixture'

/**
 * Replays the recorded afternoon through the card's own query.
 *
 * The fixture is a series, not a case: it answers "does this card refuse conclusions day to day?",
 * which no per-branch unit test can. Both sides of the contrast are measured from the same rows —
 * the recorded refusals for the current rules, and `priceStrict` plus the old six-hour bound for
 * the rules that came before — so the improvement cannot drift into a remembered claim.
 */
const readerFor = (record: DivergenceReplayRecord): DivergenceLegReader => ({
  stablecoin: async () => record.stablecoin ?? undefined,
  etf: async () => ({ rows: divergenceReplay.etfRows }),
  openInterest: async () => record.openInterest ?? undefined,
  funding: async () => record.funding ?? undefined,
  price: async () => record.price ?? undefined,
  sentiment: async () => record.sentiment
})

const refusedPairs = (result: Awaited<ReturnType<typeof queryMarketDivergenceAsync>>) =>
  result.state === 'unavailable' ? null : result.withheld.map(entry => [entry.pairId, entry.leg, entry.reason] as const)

/** The single six-hour freshness bound every intraday leg used to share. */
const oldFreshnessMs = 6 * 60 * 60 * 1_000

/**
 * Whether the card would have refused at least one pair on this sample under the old rules.
 *
 * Deliberately re-stated here instead of imported: the point is to keep measuring the old rules,
 * so they must not be reachable through the code whose behaviour is being contrasted.
 */
const refusedUnderOldRules = (record: DivergenceReplayRecord): boolean => {
  const stale = (reading: ReplayReading | null) =>
    !reading || Date.parse(record.at) - Date.parse(reading.observedAt) > oldFreshnessMs
  // The old sentiment reader answered "nothing" for a zero bearish share, which also cost a pair.
  const sentimentUnusable = record.sentiment.state !== 'available'
    || record.sentiment.scoredCount <= 0
    || record.sentiment.bearishSharePercent === 0
  return stale(record.priceStrict) || stale(record.funding) || stale(record.openInterest) || sentimentUnusable
}

describe('divergence replay: the recorded afternoon', () => {
  it('holds the window it claims: 55 samples, five minutes apart', () => {
    const { from, to, stepMs, samples } = divergenceReplay.window
    expect((Date.parse(to) - Date.parse(from)) / stepMs + 1).toBe(samples)
    expect(divergenceReplay.records).toHaveLength(samples)
  })

  it('refuses exactly the pairs it refused when the afternoon was recorded', async () => {
    for (const record of divergenceReplay.records) {
      const result = await queryMarketDivergenceAsync({ asOf: record.at, read: readerFor(record) })
      // A card that cannot even answer is a different failure than a refused pair, and the
      // recording has neither: every sample produced a conclusion of some state.
      const refused = refusedPairs(result)
      expect(refused, `sample ${record.at}`).not.toBeNull()
      expect(refused, `sample ${record.at}`).toEqual(record.refused.map(entry => [entry[0], entry[1], entry[2]]))
    }
  })

  it('answers almost every sample without refusing a pair', () => {
    const refused = divergenceReplay.records.filter(record => record.refused.length > 0)
    expect(divergenceReplay.records.length - refused.length).toBe(divergenceReplay.window.samples - divergenceReplay.contrast.refusedAfterFix)
    expect(refused).toHaveLength(divergenceReplay.contrast.refusedAfterFix)
  })

  it('refuses only the price leg, and only the two pairs that need it', () => {
    const refusals = divergenceReplay.records.flatMap(record => record.refused)
    expect(refusals.every(([, leg, reason]) => leg === 'price' && reason === 'leg-missing')).toBe(true)
    expect(refusals.map(([pair]) => pair).sort()).toEqual(['flows-price', 'flows-price', 'narrative-price', 'narrative-price'])
  })

  it('would have refused at every one of those samples far more often under the old rules', () => {
    const refusedBefore = divergenceReplay.records.filter(refusedUnderOldRules).length
    expect(refusedBefore).toBe(divergenceReplay.contrast.refusedBeforeFix)
    // The measured claim, stated once: this afternoon the old rules lost a pair in most samples.
    expect(refusedBefore).toBeGreaterThan(divergenceReplay.contrast.refusedAfterFix * 10)
  })
})
