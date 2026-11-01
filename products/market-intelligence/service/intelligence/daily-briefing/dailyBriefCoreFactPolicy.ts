/**
 * The deterministic core-fact policy: which seven rows may be completed, and how long a cached
 * answer or a failed attempt is honoured. Numbers only; the orchestration lives next door.
 */
export const dailyBriefCoreFactEnsurePolicy = Object.freeze({
  metrics: Object.freeze([
    'core-stablecoin-supply-usd',
    'etf-net-flow-btc',
    'etf-net-flow-eth',
    'dxy-level',
    'gold-level-usd',
    'us10y-yield-percent',
    'us10y-real-yield-percent'
  ] as const),
  /** A successful fact describes a fixed instant; a day of reuse is enough to coalesce starts. */
  successTtlMs: 24 * 60 * 60 * 1_000,
  /** A failed interface is retried later, but not on every launch and not forever. */
  failureRetryMs: 30 * 60 * 1_000,
  maximumAttempts: 3,
  /** Kept in step with the briefing's own retention window. */
  retentionDays: 14,
  method: 'daily-brief-core-fact-ensure'
})

export type DailyBriefCoreFactMetric = (typeof dailyBriefCoreFactEnsurePolicy.metrics)[number]

export function isDailyBriefCoreFactMetric(metric: unknown): metric is DailyBriefCoreFactMetric {
  return typeof metric === 'string' &&
    (dailyBriefCoreFactEnsurePolicy.metrics as readonly string[]).includes(metric)
}
