import type { IntelligenceItem } from '../schema/intelligenceRecord'
import type { MetricIntelligenceEvent } from '../schema/intelligenceMetricEvent'

/**
 * One macro release, read by several indicators, is one analysis.
 *
 * A release is published as a bundle: the same source stamps the same reporting period and the
 * same release moment on every indicator it carries (FRED's daily close yields are the observed
 * case — US 2Y, 10Y, breakeven and the real yield all arrive in one collection pass). Each
 * indicator travels as its own intelligence item, and the item path groups by subject, so without
 * this rule the bundle becomes one group and one model call per indicator: five calls inside a
 * minute, five conclusions that say the same thing with a different number on top.
 *
 * The window is deliberately narrow. Ten minutes is already generous for indicators of one
 * release: they arrive within the same minute. A wider window starts swallowing the next release
 * of the same source, and that is a different event which deserves its own analysis.
 *
 * The identity is taken from the metric event, never guessed from the item title. An item that
 * carries no metric event has no release identity this rule can trust, so it is not coalesced:
 * one macro-calendar entry is one event even when a second entry is published in the same minute.
 */
export const analysisReleaseCoalescingPolicy = Object.freeze({
  version: 'marketAnalysisReleaseCoalescing.v1',
  windowMs: 10 * 60 * 1_000,
  /** Ledger reason for an indicator that was not analysed because its release was already covered. */
  reasonCode: 'same-release-coalesced'
})

/**
 * What "the same release" means: the same publisher, about the same reporting period, published
 * within the window of the one already analysed.
 *
 * The period is what separates two releases that are minutes apart. Without it the release moment
 * alone would merge the prior month's figure with this month's when a source backfills them
 * together, and the newer figure would never be analysed.
 */
export type AnalysisReleaseIdentity = Readonly<{
  /** `<sourceId>|<period>` — `unstated` when the metric event carries no reporting period. */
  key: string
  /** When the publisher released the values, not when the collector noticed them. */
  releasedAt: string
}>

/** A decision already written for this release: the moment the trigger line allowed a run. */
export type AnalysisReleaseAttempt = Readonly<{
  identity: AnalysisReleaseIdentity
  decidedAt: string
}>

/**
 * Resolves what release an item belongs to.
 *
 * Returns `undefined` when the item has no metric event to read it from — the caller then leaves
 * the item's own trigger decision alone.
 */
export function resolveAnalysisReleaseIdentity(input: Readonly<{
  item: Pick<IntelligenceItem, 'publishedAt' | 'detectedAt'>
  metricEvent: Pick<MetricIntelligenceEvent, 'sourceId' | 'period' | 'releaseTime'> | undefined
}>): AnalysisReleaseIdentity | undefined {
  const metric = input.metricEvent
  if (!metric) return undefined
  const releasedAt = metric.releaseTime || input.item.publishedAt || input.item.detectedAt
  if (!Number.isFinite(Date.parse(releasedAt))) return undefined
  return { key: `${metric.sourceId}|${metric.period ?? 'unstated'}`, releasedAt }
}

/** True when both identities name the same publisher, period and release moment. */
export function isSameAnalysisRelease(
  left: AnalysisReleaseIdentity,
  right: AnalysisReleaseIdentity,
  windowMs: number = analysisReleaseCoalescingPolicy.windowMs
): boolean {
  if (left.key !== right.key) return false
  const leftAt = Date.parse(left.releasedAt)
  const rightAt = Date.parse(right.releasedAt)
  return Number.isFinite(leftAt) && Number.isFinite(rightAt) && Math.abs(leftAt - rightAt) <= windowMs
}

/**
 * The attempt that already covers this release, if any.
 *
 * A release counts as covered only while the attempt that covered it is inside the window: an
 * indicator arriving after that is far enough from the first one to be its own reading of the
 * release, and swallowing it would lose the change it carries.
 */
export function findCoveringReleaseAttempt(input: Readonly<{
  identity: AnalysisReleaseIdentity
  now: string
  attempts: readonly AnalysisReleaseAttempt[]
  windowMs?: number
}>): AnalysisReleaseAttempt | undefined {
  const windowMs = input.windowMs ?? analysisReleaseCoalescingPolicy.windowMs
  const nowMs = Date.parse(input.now)
  if (!Number.isFinite(nowMs)) return undefined
  let covering: AnalysisReleaseAttempt | undefined
  for (const attempt of input.attempts) {
    if (!isSameAnalysisRelease(input.identity, attempt.identity, windowMs)) continue
    const decidedAt = Date.parse(attempt.decidedAt)
    if (!Number.isFinite(decidedAt) || Math.abs(nowMs - decidedAt) > windowMs) continue
    if (!covering || decidedAt > Date.parse(covering.decidedAt)) covering = attempt
  }
  return covering
}
