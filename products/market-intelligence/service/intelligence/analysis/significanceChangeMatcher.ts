import type { MacroEconomicCalendarEventView } from '../../../contracts/macro/economicCalendarQueryContracts'
import type { MacroCalendarProviderObservation } from '../macro-calendar/marketCalendarObservationNormalization'
import { eventKeyOfEvidenceRef } from './macroEvidenceRef'

/**
 * Compares what the model saw last time against the raw macro route now.
 *
 * Three facts drive the shape of this module:
 *
 * 1. The macro calendar replaces rows in place (`deleteByEvent` then insert) and its as-of
 *    reads filter by `detected_at_ms`, so an older value is *not* reachable by querying an
 *    older `asOf`; it only survives in the previous snapshot's facts. The "before" side is
 *    therefore a map rebuilt from that snapshot.
 * 2. Provider fact identity includes the collection instant, so comparing by fact id makes a
 *    same-value refresh look like "removed + added" every 30 minutes. Comparison is keyed by
 *    event identity instead, and the value comparison is skipped when the snapshot never
 *    carried that metric — an unknown value is not evidence of a change.
 * 3. A change absent from the snapshot is *unknown*, not new: "added" additionally requires
 *    `detectedAt` newer than the previous snapshot, so an event that merely fell outside the
 *    snapshot's 160-fact budget can never fake an addition on every refresh.
 *
 * Removals are deliberately not signals. In a current-state store "absent at the previous
 * as-of" is indistinguishable from "replaced", and the previous facts carry no importance,
 * so a removal could neither be proven nor filtered to high importance; reporting it would
 * spend model calls on reschedules. Recorded as a known limitation instead.
 */

/**
 * How long after its scheduled time a high-importance release we had never seen still counts as
 * news.
 *
 * The reader's case: the 09:30 CPI printed while the event was absent from the previous snapshot's
 * baseline — the admission cap had dropped it — so the comparison above could not see it change,
 * and the "upcoming catalyst" branch could not either, because the release was already in the past.
 * The release existed, the store had it, and the analysis simply never heard about it.
 *
 * Bounded to a day on purpose: a first sync of a long month must not replay weeks of history into
 * the model, and the significance policy still filters to high importance.
 */
export const firstSeenReleaseWindowMs = 24 * 60 * 60 * 1_000

/**
 * `provider-surprise` 不是"变了"，而是"偏了"：provider 发布的实际值与市场预期的距离超过既定阈值
 * （设计 145 §8 A）。它由 `providerReleaseSurprisePolicy` 产出，与变化信号一起交给同一次判定。
 */
export type SignificanceSignalKind = 'actual-changed' | 'previous-revised' | 'consensus-changed' | 'event-added' | 'provider-surprise'

export type SignificanceSignal = Readonly<{
  kind: SignificanceSignalKind
  eventKey: string
  titleKey: string
  metric: string
  importance: 'high' | 'medium' | 'low'
  previousValue: string | null
  value: string | null
  /**
   * 市场预期，只在 `provider-surprise` 上有值。
   *
   * 偏离的是"与实际值的距离"，只报实际值等于没说出意外在哪；而 provider 的预期值没有单位准入，
   * 所以它作为**文本**随信号走，不参与比较（比较在契约的 `assessMarketCalendarSurprise` 里做）。
   */
  expectedValue?: string | null
}>

export type SignificanceBaseline = Readonly<{
  official: readonly MacroEconomicCalendarEventView[]
  provider: readonly MacroCalendarProviderObservation[]
  months: readonly string[]
  asOf: string
}>

/** `domain|subject|metric|eventKey` — the identity that survives collection churn. */
export type PreviousFactKey = string

export function semanticKeyOf(domain: string, subject: string, metric: string, eventKey: string): PreviousFactKey {
  return [domain, subject, metric, eventKey].join('|')
}

export { eventKeyOfEvidenceRef } from './macroEvidenceRef'

type BaselineEvent = MacroEconomicCalendarEventView | MacroCalendarProviderObservation

const comparableMetrics = [
  ['actual', 'actual-changed'],
  ['previous', 'previous-revised'],
  ['consensus', 'consensus-changed']
] as const

function displayValue(event: BaselineEvent, metric: (typeof comparableMetrics)[number][0]): string | null {
  const value = event[metric]
  return value && typeof value.displayValue === 'string' ? value.displayValue : null
}

/** Scheduled in the future relative to the evaluation: something to watch, not history. */
function isUpcoming(event: BaselineEvent, asOf: string): boolean {
  if (event.scheduledAt) return event.scheduledAt > asOf
  return event.scheduledDate > asOf.slice(0, 10)
}

export function diffSignificance(previous: ReadonlyMap<PreviousFactKey, string | null> | null,
  current: SignificanceBaseline, previousAsOf: string | null): readonly SignificanceSignal[] {
  if (previous === null || previousAsOf === null) return []
  const events: readonly BaselineEvent[] = [...current.official, ...current.provider]
  const knownEventKeys = new Set([...previous.keys()].map(key => key.slice(key.lastIndexOf('|') + 1)))
  const signals: SignificanceSignal[] = []
  for (const event of events) {
    for (const [metric, kind] of comparableMetrics) {
      const key = semanticKeyOf('macro', event.eventFamily, metric, event.eventKey)
      if (!previous.has(key)) continue
      const before = previous.get(key) ?? null
      const now = displayValue(event, metric)
      if (before === now) continue
      signals.push({ kind, eventKey: event.eventKey, titleKey: event.titleKey, metric, importance: event.importance, previousValue: before, value: now })
    }
    // "New to us" is not the same as "new information". A released, past-dated observation that
    // merely rolled into the collection window (weekly rig counts, routine supply series) adds
    // nothing forward-looking, and waking the model for it produced conclusions about oil rigs
    // for a crypto market. A release of an event we already knew arrives as `actual-changed`
    // above; what an addition is worth analysing for is an upcoming catalyst.
    if (knownEventKeys.has(event.eventKey) || event.detectedAt <= previousAsOf) continue
    if (isUpcoming(event, current.asOf)) {
      signals.push({ kind: 'event-added', eventKey: event.eventKey, titleKey: event.titleKey, metric: 'event-name', importance: event.importance, previousValue: null, value: event.titleKey })
      continue
    }
    // A high-importance release we had never seen, inside the recency window: the reader was
    // watching for exactly this number and the snapshot had no entry to compare against, so
    // without this branch the release would never be analysed at all.
    const actual = displayValue(event, 'actual')
    const scheduledAt = Date.parse(event.scheduledAt ?? '')
    if (event.importance === 'high' && actual !== null && Number.isFinite(scheduledAt) &&
      Date.parse(current.asOf) - scheduledAt <= firstSeenReleaseWindowMs) {
      signals.push({ kind: 'actual-changed', eventKey: event.eventKey, titleKey: event.titleKey, metric: 'actual', importance: event.importance, previousValue: null, value: actual })
    }
  }
  return signals
}
