import { crossAssetQuotesReady } from './dailyBriefReadinessGate'

/**
 * What counts as this edition's market data, decided once for the gate and for the body.
 *
 * The morning brief reads "the 24 hours to its cutoff", and the bar stamped at the cutoff is
 * ingested by the next poll — twenty minutes later on the morning this policy came from. Under the
 * old rule (what was known *at* the cutoff) that bar could never count, so the readiness gate asked a
 * question that was false by construction: it waited the whole budget, then published an edition with
 * BTC and ETH missing, every single morning.
 *
 * The rule now: a reading admits bars **stamped at or before the cutoff** and **known within thirty
 * minutes of it**. The window does not move — only "by when did we have to know it" does. A bar from
 * the afternoon is still never part of the morning edition, even though it is newer.
 *
 * One function, both consumers: the gate's "is the market readable" and the body's read of the same
 * market must never become two opinions about one fact again.
 */
import { briefingLateDataGraceMs, briefingMarketKnowledgeAt } from './dailyBriefGracePolicy'

export { briefingLateDataGraceMs, briefingMarketKnowledgeAt }

/** The part of a cross-asset snapshot this policy talks about: the closed returns it judges. */
export type BriefingMarketSnapshot = Readonly<{
  closedReturns: Readonly<Record<string, Readonly<Record<string, Readonly<{ state: string }>>>>>
}>

/** The one cross-asset reader both surfaces use. */
export type BriefingMarketReader = Readonly<{
  queryCrossAssetSnapshot: (input: {
    range: '24h'
    asOf: string
    knowledgeAt: string
  }) => Promise<BriefingMarketSnapshot | undefined>
}>

/**
 * The market this edition is about: the window that ends at its cutoff, read with the late-data grace.
 */
export function readBriefingMarketSnapshot<T extends BriefingMarketSnapshot>(
  reader: Readonly<{ queryCrossAssetSnapshot: (input: { range: '24h'; asOf: string; knowledgeAt: string }) => Promise<T | undefined> }>,
  asOf: string,
  nowMs: number = Date.now()
): Promise<T | undefined> {
  // Required, never defaulted: an unreadable cutoff cannot produce a knowledge instant, and asking
  // without one silently falls back to the frozen as-of view.
  const knowledgeAt = briefingMarketKnowledgeAt(asOf, undefined, nowMs)
  if (!knowledgeAt) return Promise.reject(new Error('invalid-cutoff'))
  return reader.queryCrossAssetSnapshot({ range: '24h', asOf, knowledgeAt })
}

/**
 * Whether the two prices this edition must not be without are there.
 *
 * The same predicate decides the gate's answer and the body's data, so "ready" can never mean one
 * thing to the waiter and another to the reader.
 */
export function briefingMarketReady(snapshot: BriefingMarketSnapshot | undefined): boolean {
  return crossAssetQuotesReady(snapshot)
}

/** One log line that answers "why is this row empty" without a database dig. */
export function logBriefingMarketRead(input: Readonly<{
  asOf: string
  knowledgeAt: string | undefined
  snapshot: BriefingMarketSnapshot | undefined
  failure: string | null | undefined
}>): void {
  console.log(JSON.stringify({
    marker: 'MI_DAILY_BRIEF_MARKET_READ',
    asOf: input.asOf,
    knowledgeAt: input.knowledgeAt ?? null,
    snapshot: input.snapshot !== undefined,
    btc: input.snapshot?.closedReturns.btc?.['24h']?.state ?? 'missing',
    eth: input.snapshot?.closedReturns.eth?.['24h']?.state ?? 'missing',
    index: input.snapshot?.closedReturns.index?.['24h']?.state ?? 'missing',
    failure: input.failure ?? null
  }))
}
