import { openInterestBucketPolicy } from '../../../contracts/openInterestHistory'
import { liquidationHintPolicy, type LiquidationHint } from '../../../contracts/openInterestPositioning'
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
  /** 这条规则只说一件事：多头被清（价格跌）。 */
  direction: 'long' as const,
  /**
   * The width one judgement covers. Read from the bucket policy, not spelled here: the store may
   * get finer without the rule's own bucket moving, and a local literal is how that distinction
   * gets lost.
   */
  bucketMs: openInterestBucketPolicy.signalBucketMs,
  triggerOwner: 'module-signal'
})

/** 镜像那条：空头被清（价格涨）。门槛同一套，方向只由 `ruleId` 与读数符号表达。 */
export const openInterestShortSignalRule = Object.freeze({
  moduleId: 'open-interest' as const,
  ruleId: 'oi-short-liquidation-proxy',
  direction: 'short' as const,
  bucketMs: openInterestBucketPolicy.signalBucketMs,
  triggerOwner: 'module-signal'
})

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
    const rule = hint.direction === 'short' ? openInterestShortSignalRule : openInterestSignalRule
    // `strongDropPct` is the rule's own "this one is worse" line, not a second threshold.
    const severity = hint.dropPct <= liquidationHintPolicy.strongDropPct ? 'high' : 'medium'
    // 方向不变量：多头规则必须记负的涨跌、空头规则必须记正的。不符就不产出，也不发出去再看。
    if (Number.isFinite(hint.pricePct) && (rule.direction === 'long' ? hint.pricePct! >= 0 : hint.pricePct! <= 0)) {
      console.log(JSON.stringify({ marker: 'MI_OI_SIGNAL_SIGN_CONFLICT', ruleId: rule.ruleId, asset: input.asset, observedAt: hint.observedAt }))
      continue
    }
    const signal = build({
      rule,
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

type OpenInterestSignalRule = typeof openInterestSignalRule | typeof openInterestShortSignalRule

function build(input: Readonly<{
  rule?: OpenInterestSignalRule
  asset: 'btc' | 'eth'
  observedAt: string
  severity: ModuleSignal['severity']
  values: Readonly<Record<string, number>>
  ready: boolean
}>): ModuleSignal | undefined {
  const rule = input.rule ?? openInterestSignalRule
  const cadence = Object.freeze({ kind: 'intraday' as const, bucketMs: rule.bucketMs })
  const dedupeKey = buildSignalDedupeKey({
    moduleId: rule.moduleId,
    ruleId: rule.ruleId,
    asset: input.asset,
    observedAt: input.observedAt,
    cadence
  })
  if (!dedupeKey) return undefined
  return Object.freeze({
    version: moduleSignalPolicy.version,
    moduleId: rule.moduleId,
    ruleId: rule.ruleId,
    asset: input.asset,
    severity: input.severity,
    observedAt: input.observedAt,
    cadence,
    values: Object.freeze({ ...input.values }),
    dedupeKey,
    readiness: input.ready ? 'available' as const : 'unavailable' as const,
    triggerOwner: rule.triggerOwner
  })
}
