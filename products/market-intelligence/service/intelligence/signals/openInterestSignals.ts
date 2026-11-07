import { openInterestBucketPolicy } from '../../../contracts/openInterestHistory'
import {
  detectLiquidationHints,
  liquidationHintPolicy,
  type LiquidationHint,
  type PositioningBar
} from '../../../contracts/openInterestPositioning'
import type { OpenInterestHistoryResult } from '../../../contracts/openInterestHistory'
import { buildSignalDedupeKey, moduleSignalPolicy, type ModuleSignal } from '../../../contracts/moduleSignal'

/**
 * The open-interest rule, as a signal.
 *
 * It does not decide anything the panel does not already decide: it reads the same
 * `detectLiquidationHints` result the card marks, and turns each mark into the shared vocabulary.
 * A second threshold table here would let the chip and the mark disagree about the same bucket,
 * which is worse than either of them being wrong alone.
 *
 * The two numbers come from `liquidationHintPolicy`: `dropPct` decides the rule fires, and
 * `strongDropPct` decides it fires loudly — the second had no consumer until now, and inventing one
 * more percentage in this file is how a threshold ends up with two homes.
 */
export const openInterestSignalRule = Object.freeze({
  moduleId: 'open-interest' as const,
  ruleId: 'oi-liquidation-proxy',
  /**
   * The width one judgement covers. Read from the bucket policy, not spelled here: the store may
   * get finer without the rule's own bucket moving, and a local literal is how that distinction
   * gets lost.
   */
  bucketMs: openInterestBucketPolicy.signalBucketMs,
  triggerOwner: 'module-signal'
})

/**
 * Signals for one asset's closed buckets, oldest first.
 *
 * Returns one signal per marked bucket, or a single `unavailable` signal when the read could not be
 * made at all: an empty list means "nothing looked like a liquidation", which must not be how a
 * failed read looks.
 */
export function openInterestSignals(input: Readonly<{
  asset: 'btc' | 'eth'
  bars: readonly PositioningBar[]
  /** Used only when there is no bucket to date an `unavailable` signal by. */
  asOf: string
}>): readonly ModuleSignal[] {
  const hints = detectLiquidationHints({ asset: input.asset, bars: input.bars })
  return signalsFromHints({
    asset: input.asset,
    hints: hints.hints,
    state: hints.state,
    fallbackObservedAt: input.bars.at(-1)?.observedAt ?? input.asOf
  })
}

/**
 * The same signals, read from the query the panel already made.
 *
 * The panel and this mapping must not run the mark twice: `queryOpenInterestHistory` computes
 * `liquidationHints` from the stored buckets, and a second `detectLiquidationHints` here would be a
 * second implementation of the rule that can drift by one bar. So the production path reads the
 * hints out of the DTO and only maps them.
 */
export function openInterestSignalsFromHistory(
  reading: OpenInterestHistoryResult,
  /** The instant the read was made for: a failed read carries none of its own. */
  asOf: string
): readonly ModuleSignal[] {
  if (reading.state !== 'available') return unavailableForBothAssets(asOf)
  // An empty hint list here is "cannot tell", not "nothing happened" — the DTO says which.
  if (reading.liquidationHintsState === 'unavailable') return unavailableForBothAssets(reading.asOf)
  const signals: ModuleSignal[] = []
  for (const asset of ['btc', 'eth'] as const) {
    signals.push(...signalsFromHints({
      asset,
      hints: (reading.liquidationHints ?? []).filter(hint => hint.asset === asset),
      state: 'available',
      fallbackObservedAt: reading.asOf
    }))
  }
  return Object.freeze(signals)
}

function signalsFromHints(input: Readonly<{
  asset: 'btc' | 'eth'
  hints: readonly LiquidationHint[]
  state: 'available' | 'unavailable'
  fallbackObservedAt: string
}>): readonly ModuleSignal[] {
  if (input.state === 'unavailable') {
    const signal = build({ asset: input.asset, observedAt: input.fallbackObservedAt, severity: 'medium', values: {}, ready: false })
    return signal ? [signal] : []
  }
  const signals: ModuleSignal[] = []
  for (const hint of input.hints) {
    // `strongDropPct` is the rule's own "this one is worse" line, not a second threshold.
    const severity = hint.dropPct <= liquidationHintPolicy.strongDropPct ? 'high' : 'medium'
    const signal = build({
      asset: input.asset,
      observedAt: hint.observedAt,
      severity,
      // 价格只加不改：老记录/旧读取缺这一格就不写，绝不拿别的数补上。
      values: {
        dropPct: hint.dropPct,
        volumeMultiple: hint.volumeMultiple,
        notionalUsd: hint.notionalUsd,
        ...(Number.isFinite(hint.closePrice) ? { priceUsd: hint.closePrice } : {}),
        ...(Number.isFinite(hint.pricePct) ? { priceChangePct: hint.pricePct } : {})
      },
      ready: true
    })
    // A bucket whose instant cannot be read is not a signal: it cannot be deduplicated or placed.
    if (signal) signals.push(signal)
  }
  return Object.freeze(signals)
}

/** Neither asset can be read, and the rule cannot name one as a guess. */
function unavailableForBothAssets(asOf: string): readonly ModuleSignal[] {
  return Object.freeze((['btc', 'eth'] as const)
    .map(asset => build({ asset, observedAt: asOf, severity: 'medium', values: {}, ready: false }))
    .filter((signal): signal is ModuleSignal => signal !== undefined))
}

function build(input: Readonly<{
  asset: 'btc' | 'eth'
  observedAt: string
  severity: ModuleSignal['severity']
  values: Readonly<Record<string, number>>
  ready: boolean
}>): ModuleSignal | undefined {
  const cadence = Object.freeze({ kind: 'intraday' as const, bucketMs: openInterestSignalRule.bucketMs })
  const dedupeKey = buildSignalDedupeKey({
    moduleId: openInterestSignalRule.moduleId,
    ruleId: openInterestSignalRule.ruleId,
    asset: input.asset,
    observedAt: input.observedAt,
    cadence
  })
  if (!dedupeKey) return undefined
  return Object.freeze({
    version: moduleSignalPolicy.version,
    moduleId: openInterestSignalRule.moduleId,
    ruleId: openInterestSignalRule.ruleId,
    asset: input.asset,
    severity: input.severity,
    observedAt: input.observedAt,
    cadence,
    values: Object.freeze({ ...input.values }),
    dedupeKey,
    readiness: input.ready ? 'available' as const : 'unavailable' as const,
    triggerOwner: openInterestSignalRule.triggerOwner
  })
}
