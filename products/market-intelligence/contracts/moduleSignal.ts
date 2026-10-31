/**
 * The one shape a module rule speaks when it has something to say.
 *
 * Three rule families already compute something a reader would act on — a leveraged position
 * unwinding, flows leaving the funds, a release that surprised the market — and each of them
 * describes "how urgent" in its own words. This contract is the single vocabulary they share, so
 * the chip, the analysis snapshot and the trigger budget cannot each interpret the same event
 * differently.
 *
 * Two decisions are packed into it on purpose:
 *
 * - A signal is **derived data, never stored**. Every field can be recomputed from stored bars,
 *   flows and calendar rows; a table here would be a second truth that has to be backfilled every
 *   time a threshold moves.
 * - `cadence` is **one discriminant, not three numbers**. The dedupe bucket, the rule window and
 *   the cooldown are three readings of the same fact: how often this rule may speak. Split into
 *   `windowMs` + `cooldownMs` the two can contradict each other, and a daily rule ends up written
 *   as `3 × 86_400_000`, which silently counts a weekend as three trading days.
 */
export const moduleSignalPolicy = Object.freeze({
  version: '1',
  modules: Object.freeze(['open-interest', 'etf-flows', 'macro-calendar'] as const),
  /**
   * Rules that describe one asset, so `asset: null` is unreachable for them rather than unknown.
   *
   * The calendar is market-wide and keeps `null`; a per-asset rule that cannot name its asset has
   * not produced a signal, it has produced a question.
   */
  singleAssetModules: Object.freeze(['open-interest', 'etf-flows'] as const),
  severities: Object.freeze(['high', 'medium', 'low'] as const),
  readiness: Object.freeze(['available', 'unavailable'] as const),
  /**
   * One event cut into several fifteen-minute buckets: the first bucket speaks, the rest only
   * move the reading. Two hours is longer than any liquidation cascade lasts in one direction.
   */
  intradayCooldownMs: 2 * 60 * 60 * 1_000,
  /** A daily rule speaks once a trading day; a deeper reading the same day is an upgrade instead. */
  tradingDayCooldownDays: 1,
  canonicalUtcMillisPattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  ruleIdPattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  maximumRuleIdLength: 64,
  maximumDedupeKeyLength: 160,
  maximumValueEntries: 24,
  /** A bucket longer than a day is a daily rule wearing an intraday shape. */
  maximumBucketMs: 24 * 60 * 60 * 1_000
})

export type ModuleSignalModuleId = (typeof moduleSignalPolicy.modules)[number]
export type SignalSeverity = (typeof moduleSignalPolicy.severities)[number]
export type SignalReadiness = (typeof moduleSignalPolicy.readiness)[number]

/**
 * How often a rule is observed, and therefore what its window, bucket and cooldown are measured in.
 *
 * `intraday` carries its own bucket because fifteen minutes and one hour are both intraday rules
 * with different dedupe buckets; `trading-day` carries nothing because a trading day is a day.
 */
export type SignalCadence =
  | Readonly<{ kind: 'intraday'; bucketMs: number }>
  | Readonly<{ kind: 'trading-day' }>

export type ModuleSignal = Readonly<{
  /** Contract version, so a stored trigger key from an older shape is not read as this one. */
  version: string
  moduleId: ModuleSignalModuleId
  /** Readable on its own: a rule name that needs its module to make sense is two names for one thing. */
  ruleId: string
  asset: 'btc' | 'eth' | null
  /** Produced by the rule's own constants. The contract publishes the closed set, not the choice. */
  severity: SignalSeverity
  /** The instant the signal describes, never the instant it was computed. */
  observedAt: string
  cadence: SignalCadence
  /** Numbers only: a completeness flag is `coveredDays` / `requiredDays`, never a boolean. */
  values: Readonly<Record<string, number>>
  dedupeKey: string
  readiness: SignalReadiness
  /** `module-signal` unless an existing trigger key already owns this event. */
  triggerOwner: string
}>

/**
 * A rule's window, in its own cadence's unit.
 *
 * `upperBoundMs` is `null` for trading-day windows on purpose: a window of three trading days can
 * reach back four calendar days across a weekend and seven across a holiday week, so any single
 * millisecond figure would be a number the code then trusts. A caller that needs a read span pages
 * by trading date; a caller that needs "is this stale" compares the row's own date.
 */
export type SignalWindow =
  | Readonly<{ unit: 'buckets'; amount: number; bucketMs: number; upperBoundMs: number }>
  | Readonly<{ unit: 'trading-days'; amount: number; upperBoundMs: null }>

export type SignalCooldown =
  | Readonly<{ kind: 'duration'; ms: number }>
  | Readonly<{ kind: 'trading-days'; days: number }>

/**
 * The window of a rule, computed once for everyone.
 *
 * `amount` is expressed in the cadence's own unit — buckets for an intraday rule, trading days for
 * a daily one — so no caller ever multiplies by a day and no caller has to remember that a weekend
 * is not two trading days.
 */
export function signalWindow(cadence: SignalCadence, amount: number): SignalWindow | undefined {
  if (!Number.isFinite(amount) || amount <= 0) return undefined
  if (cadence.kind === 'intraday') {
    if (!isBucketMs(cadence.bucketMs)) return undefined
    return Object.freeze({ unit: 'buckets' as const, amount, bucketMs: cadence.bucketMs, upperBoundMs: amount * cadence.bucketMs })
  }
  return Object.freeze({ unit: 'trading-days' as const, amount, upperBoundMs: null })
}

/**
 * How long this rule stays quiet after it speaks.
 *
 * A daily rule gets a trading-day cooldown rather than an hour count, and it is never expressed as
 * `0`: zero means "no cooling", which is a different promise from "once a day".
 */
export function signalCooldown(cadence: SignalCadence): SignalCooldown {
  return cadence.kind === 'intraday'
    ? Object.freeze({ kind: 'duration' as const, ms: moduleSignalPolicy.intradayCooldownMs })
    : Object.freeze({ kind: 'trading-days' as const, days: moduleSignalPolicy.tradingDayCooldownDays })
}

/**
 * The bucket a rule is deduplicated on, from the cadence it declares.
 *
 * Built here rather than accepted from a caller: a key assembled at each call site is how the same
 * event ends up deduplicated on a different instant in two places. Trading-day rules key on the
 * trading date the signal describes, which for a late-arriving flow is the day of the data, not the
 * day it arrived.
 */
export function buildSignalDedupeKey(input: Readonly<{
  moduleId: ModuleSignalModuleId
  ruleId: string
  asset: 'btc' | 'eth' | null
  observedAt: string
  cadence: SignalCadence
}>): string | undefined {
  if (!isCanonicalSignalTime(input.observedAt)) return undefined
  const bucket = input.cadence.kind === 'intraday'
    ? (isBucketMs(input.cadence.bucketMs)
      ? new Date(Math.floor(Date.parse(input.observedAt) / input.cadence.bucketMs) * input.cadence.bucketMs).toISOString()
      : undefined)
    : input.observedAt.slice(0, 10)
  if (!bucket) return undefined
  const key = `${input.moduleId}:${input.ruleId}:${input.asset ?? 'market'}:${bucket}`
  return key.length <= moduleSignalPolicy.maximumDedupeKeyLength ? key : undefined
}

/**
 * Whether a window's data is complete.
 *
 * The one place the "two numbers instead of a boolean" decision lives: a caller passes the signal's
 * values and gets back whether the rule had enough days to speak. A signal without those two keys
 * has nothing to say about coverage, and answers complete.
 */
export function isCoverageComplete(values: Readonly<Record<string, number>>): boolean {
  const covered = values.coveredDays
  const required = values.requiredDays
  if (covered === undefined || required === undefined) return true
  return covered >= required
}

export function isCanonicalSignalTime(value: unknown): value is string {
  if (typeof value !== 'string' || !moduleSignalPolicy.canonicalUtcMillisPattern.test(value)) return false
  try {
    return new Date(value).toISOString() === value
  } catch {
    return false
  }
}

function isBucketMs(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= moduleSignalPolicy.maximumBucketMs
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * The contract check, shared by the rules that build signals and by anything that reads one.
 *
 * A second copy would drift: a rule would publish a shape the reader refuses and the chip would go
 * blank with no failing test. It returns false instead of throwing, because a malformed signal is a
 * rule bug to report, not an exception to unwind through a render.
 */
export function isModuleSignal(value: unknown): value is ModuleSignal {
  if (!isPlainRecord(value)) return false
  if (value.version !== moduleSignalPolicy.version) return false
  if (!moduleSignalPolicy.modules.includes(value.moduleId as ModuleSignalModuleId)) return false
  if (typeof value.ruleId !== 'string' || value.ruleId.length > moduleSignalPolicy.maximumRuleIdLength) return false
  if (!moduleSignalPolicy.ruleIdPattern.test(value.ruleId)) return false
  if (value.asset !== null && value.asset !== 'btc' && value.asset !== 'eth') return false
  if (value.asset === null && moduleSignalPolicy.singleAssetModules.includes(value.moduleId as never)) return false
  if (!moduleSignalPolicy.severities.includes(value.severity as SignalSeverity)) return false
  if (!isCanonicalSignalTime(value.observedAt)) return false
  if (!isCadence(value.cadence)) return false
  if (!isValues(value.values)) return false
  if (typeof value.dedupeKey !== 'string' || value.dedupeKey.length === 0 || value.dedupeKey.length > moduleSignalPolicy.maximumDedupeKeyLength) return false
  if (!moduleSignalPolicy.readiness.includes(value.readiness as SignalReadiness)) return false
  return typeof value.triggerOwner === 'string' && value.triggerOwner.length > 0
}

function isCadence(value: unknown): value is SignalCadence {
  if (!isPlainRecord(value)) return false
  if (value.kind === 'trading-day') return Object.keys(value).length === 1
  if (value.kind !== 'intraday') return false
  return Object.keys(value).length === 2 && isBucketMs(value.bucketMs)
}

function isValues(value: unknown): value is Readonly<Record<string, number>> {
  if (!isPlainRecord(value)) return false
  const entries = Object.entries(value)
  if (entries.length > moduleSignalPolicy.maximumValueEntries) return false
  // Numbers only. A boolean here would turn the validator into a set of type branches for one
  // flag, and `coveredDays` / `requiredDays` already say the same thing as two readable numbers.
  return entries.every(([key, entry]) => key.length > 0 && typeof entry === 'number' && Number.isFinite(entry))
}
