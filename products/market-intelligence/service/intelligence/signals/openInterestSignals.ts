import {
  detectLiquidationHints,
  liquidationHintPolicy,
  type PositioningBar
} from '../../../contracts/openInterestPositioning'
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
  /** The bucket the panel charts and the store keeps. */
  bucketMs: 15 * 60 * 1_000,
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
  if (hints.state === 'unavailable') {
    const observedAt = input.bars.at(-1)?.observedAt ?? input.asOf
    const signal = build({ asset: input.asset, observedAt, severity: 'medium', values: {}, ready: false })
    return signal ? [signal] : []
  }
  const signals: ModuleSignal[] = []
  for (const hint of hints.hints) {
    // `strongDropPct` is the rule's own "this one is worse" line, not a second threshold.
    const severity = hint.dropPct <= liquidationHintPolicy.strongDropPct ? 'high' : 'medium'
    const signal = build({
      asset: input.asset,
      observedAt: hint.observedAt,
      severity,
      values: { dropPct: hint.dropPct, volumeMultiple: hint.volumeMultiple, notionalUsd: hint.notionalUsd },
      ready: true
    })
    // A bucket whose instant cannot be read is not a signal: it cannot be deduplicated or placed.
    if (signal) signals.push(signal)
  }
  return Object.freeze(signals)
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
