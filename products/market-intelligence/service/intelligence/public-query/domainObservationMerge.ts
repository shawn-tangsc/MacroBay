import type {
  AnalysisFreshness,
  MarketAnalysisQueryState
} from '../../../contracts/marketAnalysisContracts'

/** One domain's runtime read state: what the queries answered, and how many facts came back. */
export type MarketAnalysisDomainObservation = Readonly<{
  queryState: MarketAnalysisQueryState
  freshness: AnalysisFreshness
  factCount: number
  evidenceCount: number
  caveats: readonly string[]
}>

export function observation(
  queryState: MarketAnalysisQueryState,
  freshness: AnalysisFreshness,
  factCount: number,
  evidenceCount: number,
  caveats: readonly string[]
): MarketAnalysisDomainObservation {
  return { queryState, freshness, factCount, evidenceCount, caveats }
}

/**
 * How much one domain's sources have to say, weakest first.
 *
 * A domain can have more than one producer — the macro domain is answered by the economic calendar
 * *and* by the collected macro snapshot and the FRED daily block — while the matrix carries one
 * `queryState` per domain. The state shown has to be the strongest truthful statement about the
 * domain rather than whichever producer happened to run last: a working FRED read must not be erased
 * by an unwired calendar, and an unavailable calendar must not hide behind an empty one.
 */
const QUERY_STATE_STRENGTH: Readonly<Record<MarketAnalysisQueryState, number>> = Object.freeze({
  unavailable: 0, missing: 1, empty: 2, stale: 3, 'not-comparable': 4, available: 5
})

/**
 * Merges one domain observation into the accumulator.
 *
 * Fact counts add up and caveats union without duplicates, so a gap another producer reported stays
 * named even when the domain is available overall. The query state — and, with it, the freshness
 * that describes *that* state — is the stronger of the two: a stale calendar cannot label a fresh
 * FRED read as stale.
 */
export function mergeDomainObservation(
  current: MarketAnalysisDomainObservation | undefined,
  incoming: MarketAnalysisDomainObservation
): MarketAnalysisDomainObservation {
  if (!current) return incoming
  const incomingWins = QUERY_STATE_STRENGTH[incoming.queryState] > QUERY_STATE_STRENGTH[current.queryState]
  return Object.freeze({
    queryState: incomingWins ? incoming.queryState : current.queryState,
    freshness: incomingWins ? incoming.freshness : current.freshness,
    factCount: current.factCount + incoming.factCount,
    evidenceCount: current.evidenceCount + incoming.evidenceCount,
    caveats: Object.freeze([...new Set([...current.caveats, ...incoming.caveats])])
  })
}
