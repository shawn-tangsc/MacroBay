/**
 * How much each fixed-share source may contribute to one analysis run.
 *
 * These are running numbers, not shape: changing one changes what a run reads, never what a caller
 * compiles against. They sat in `contracts/marketAnalysisContracts.ts` next to the metric names they
 * apply to, which made a tuned budget look like part of the wire shape; the names stay there as
 * closed sets and the budgets live here.
 *
 * The two sources share one property: their facts are slow-moving (a meeting-level cadence) and
 * their share is deliberately capped so the domains that explain an intraday move keep the budget.
 * A read that exceeds a cap is truncated and the fact set says so, rather than silently shrinking.
 */
export const MARKET_ANALYSIS_RUN_SOURCE_BUDGET = Object.freeze({
  /**
   * How many calendar events one month read may page through. The read is a month, so the number is
   * a page bound rather than a per-run fact count: a busy month must not truncate silently at an
   * arbitrary point, and a quiet one must not cost more than it needs.
   */
  macroCalendarMaximumEvents: 200,
  /** The policy-path facts are a fixed share of the context, not an open-ended feed. */
  policyPath: Object.freeze({
    /**
     * Deliberately below 10% of the macro ceiling and well below a thousandth of the output byte
     * limit: a read that exceeds it is truncated and says so.
     */
    maximumFacts: 8,
    maximumPromptCharacters: 900
  })
} as const)
