import type { DashboardFeedRow, DashboardFeedRowState, DashboardFeedText } from './dashboardFeedStatusModel'

/**
 * Which feed states are 健康 and which one deserves a line of its own.
 *
 * The strip used to print four feed rows all the time, which made a working board as loud as a broken
 * one. It now prints one ✓ line for the feeds that are simply working, and one line per feed that has
 * something the reader should look at.
 *
 * The split is an explicit map rather than "everything that is not ok", because a new state must
 * default to the safe side: a state the map has never heard of lands in 需要留意, so a future feed
 * cannot quietly disappear into the healthy summary. The map is exhaustive over today's states, so
 * adding one to `DashboardFeedRowState` fails the type check here until it is classified on purpose.
 */
export type DashboardFeedHealth = 'healthy' | 'needs-attention'

export type DashboardFeedHealthPolicy = Readonly<{
  healthy: Readonly<Record<DashboardFeedRowState, boolean>>
  /** The state shown for a row a dashboard row could not classify. Never printed by today's code. */
  unknownStateHealth: DashboardFeedHealth
}>

export const dashboardFeedHealthPolicy: DashboardFeedHealthPolicy = {
  healthy: {
    // Only a reading that came from the source itself, with nothing standing in for it.
    ok: true,
    loading: false,
    unconfigured: false,
    'configured-disabled': false,
    failed: false,
    'stale-fallback': false,
    proxy: false,
    'awaiting-collection': false,
    unavailable: false
  },
  unknownStateHealth: 'needs-attention'
}

/**
 * The health of one row. A row that says it is reading a stand-in — the synthesis or the tokenised
 * proxy — is never 健康 even if its state word says 采集正常: the point of the strip is that a
 * fallback is visible, so the fallback wins over the state's own classification.
 */
export function dashboardFeedRowHealth(row: DashboardFeedRow, policy: DashboardFeedHealthPolicy = dashboardFeedHealthPolicy): DashboardFeedHealth {
  if (row.fallback !== undefined) return 'needs-attention'
  const known = policy.healthy[row.state] as boolean | undefined
  if (known === undefined) return policy.unknownStateHealth
  return known ? 'healthy' : 'needs-attention'
}

export type DashboardFeedHealthView = Readonly<{
  /** True when at least one feed is healthy: a summary of zero feeds is never printed. */
  hasSummary: boolean
  healthyCount: number
  /** The healthy feeds' own names, in reading order, joined by the strip's separator. */
  healthyNames: string
  /** The feeds that need a line of their own, in reading order. */
  attentionRows: readonly DashboardFeedRow[]
}>

/**
 * Splits the projected rows into the one summary line and the rows that each keep a line.
 *
 * A healthy row is counted and named; every other row — including any state the policy does not
 * classify — is handed back for the strip to print on its own line.
 */
export function projectDashboardFeedHealth(rows: readonly DashboardFeedRow[], text: DashboardFeedText, policy: DashboardFeedHealthPolicy = dashboardFeedHealthPolicy): DashboardFeedHealthView {
  const healthy = rows.filter(row => dashboardFeedRowHealth(row, policy) === 'healthy')
  const attentionRows = rows.filter(row => dashboardFeedRowHealth(row, policy) === 'needs-attention')
  return Object.freeze({
    hasSummary: healthy.length > 0,
    healthyCount: healthy.length,
    healthyNames: healthy.map(row => text.rowNames[row.id]).join(' · '),
    attentionRows: Object.freeze(attentionRows)
  })
}
