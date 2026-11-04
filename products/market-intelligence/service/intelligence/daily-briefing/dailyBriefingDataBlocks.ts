import type { BriefingMateriality, BriefingPulseRow, DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import { normalizeOutcomes } from '../../../contracts/policyPath'
import { baselineVisibility, leverageMateriality, policyPathMateriality } from './dailyBriefingDataSelection'
import { briefingOpenInterestSeries } from './dailyBriefingSeries'
import type { DailyBriefingFactPacket } from './dailyBriefingFactPacket'

/**
 * The two optional blocks of the data region, and the numbers behind them.
 *
 * Split out of the document builder because these two are the blocks whose *shape* keeps growing: the
 * policy card now carries the whole priced distribution beside its lead probability, and each
 * positioning card carries the series its line is drawn from. Keeping that growth here leaves the
 * builder assembling a document rather than accumulating per-block arithmetic.
 */

/**
 * The rate path card's data.
 *
 * The `probabilityChangePp` is measured against the previous edition's stored probability, never
 * against a second read of the venue: two reads are two instants, and the difference between them
 * would be reported as a market move.
 */
export function buildPolicyPathBlock(
  packet: DailyBriefingFactPacket,
  previous: DailyBriefingDocument | undefined
): DailyBriefingDocument['data']['policyPath'] {
  const policyPath = packet.policyPath
  const probability = policyPath?.probability
  if (!policyPath || !probability) return undefined
  const current = probability.value <= 1 ? probability.value * 100 : probability.value
  const previousProbability = previous?.data.policyPath?.probability
  const probabilityChangePp = typeof previousProbability === 'number' && Number.isFinite(previousProbability)
    ? Math.round((current - previousProbability) * 10) / 10
    : undefined
  const materiality = policyPathMateriality({
    meetingDate: policyPath.meetingDate,
    outcome: probability.outcome,
    previousOutcome: previous?.data.policyPath?.outcome,
    probabilityChangePp,
    windowEnd: packet.windowEnd
  })
  // The venue prices five buckets, and the edition used to keep only the leading one — so the card
  // could state "77.5%" but had no way to say what the rest was priced at. `normalizeOutcomes` is the
  // policy block's own normalizer: same five names, sum corrected to one, refused when incomplete.
  //
  // The card prints the lead probability and draws the dial from the same bucket, so the two are one
  // fact with two carriers. Normalization can move a bucket: an overround of a few tenths keeps them
  // within half a point, a payload that is off by more would draw an arc that contradicts the number
  // beside it. Such a distribution is not usable here, and the card stays legitimately two-segment
  // rather than showing two different odds for one market.
  const normalized = probability.distribution ? normalizeOutcomes(probability.distribution) : undefined
  const normalizedLead = normalized ? normalized[probability.outcome] * 100 : undefined
  const distribution = normalizedLead !== undefined && Math.abs(normalizedLead - current) <= 0.5 ? normalized : undefined
  return Object.freeze({
    state: 'available' as const,
    meetingDate: policyPath.meetingDate,
    outcome: probability.outcome,
    probability: current,
    observedAt: probability.asOf,
    ...(policyPath.targetRange ? { targetLower: policyPath.targetRange.lowerPercent, targetUpper: policyPath.targetRange.upperPercent } : {}),
    ...(distribution ? { distribution } : {}),
    ...(probabilityChangePp !== undefined ? { probabilityChangePp } : {}),
    materiality,
    ...baselineVisibility(true)
  })
}

/**
 * The perpetual positioning block's data.
 *
 * An empty read is a gap, not a flat market, so the block is still present; a failed read is absent,
 * because there is no card to draw. Each card's series comes from the same read as its amount, which
 * is what makes "the line ends on the printed number" a property rather than a coincidence.
 */
export function buildLeverageBlock(
  packet: DailyBriefingFactPacket,
  funds: readonly BriefingPulseRow[]
): NonNullable<DailyBriefingDocument['data']['leverage']> | undefined {
  const positioning = packet.positioning
  if (!positioning || positioning.state !== 'available') {
    if (positioning?.state !== 'empty') return undefined
    // An empty positioning read is a gap, not a flat market: keep the row so the reader sees the
    // hole instead of a silently complete data section.
    const gap: BriefingMateriality = Object.freeze({ material: true, reasonCode: 'gap' as const })
    return Object.freeze({ state: 'unavailable' as const, btc: {}, eth: {}, materiality: gap, ...baselineVisibility(false, true) })
  }
  const funding = (id: string) => {
    const row = funds.find((candidate) => candidate.id === id)
    return row?.value?.number
  }
  const last = (rows: readonly { notionalUsd: number }[]) => rows.at(-1)?.notionalUsd
  const change = positioning.change
  const materiality = leverageMateriality({
    funding: funds,
    openInterestChange24hPct: { btc: change?.btc.h24Pct, eth: change?.eth.h24Pct }
  })
  // A read that failed is `unavailable` above; a read that answered with fewer than two points leaves
  // the amount and states no series, which the card can tell apart from a missing read.
  const entry = (asset: 'btc' | 'eth') => {
    const series = briefingOpenInterestSeries(positioning[asset])
    return Object.freeze({
      ...(funding(`funding-${asset}`) !== undefined ? { fundingRate: funding(`funding-${asset}`) } : {}),
      ...(last(positioning[asset]) !== undefined ? { openInterestUsd: last(positioning[asset]) } : {}),
      ...(change?.[asset].h1Pct !== undefined ? { change1hPct: change[asset].h1Pct } : {}),
      ...(change?.[asset].h24Pct !== undefined ? { change24hPct: change[asset].h24Pct } : {}),
      ...(series ? { series } : {})
    })
  }
  return Object.freeze({
    state: 'available' as const,
    materiality,
    ...baselineVisibility(true),
    observedAt: positioning.btc.at(-1)?.observedAt ?? positioning.eth.at(-1)?.observedAt,
    btc: entry('btc'),
    eth: entry('eth')
  })
}
