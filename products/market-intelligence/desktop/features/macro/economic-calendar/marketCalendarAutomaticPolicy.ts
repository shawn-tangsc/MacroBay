/**
 * Presentation policy for the market calendar's automatic refresh (design 118).
 *
 * The scheduler lives in the product service layer and owns the real cadence; the
 * renderer cannot import service code, so the display value is mirrored here.
 * `marketCalendarAutomaticPolicy.test.ts` reads the service policy and fails if the
 * two intervals drift, which keeps this from becoming a second source of truth.
 */
export const marketCalendarAutomaticRefreshPolicy = Object.freeze({
  /** Mirrors `zeroXRouterCalendarSchedulerPolicy.intervalMs`. */
  intervalMinutes: 30,
  /** Every 0xRouter descriptor is refreshed automatically; nothing needs a manual run. */
  automatic: true
})
