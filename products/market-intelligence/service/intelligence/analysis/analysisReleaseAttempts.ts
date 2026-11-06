import type { AnalysisRunStatus, EventGroup } from '../../../contracts/marketAnalysisContracts'
import type { IntelligenceItem } from '../schema/intelligenceRecord'
import type { MetricIntelligenceEvent } from '../schema/intelligenceMetricEvent'
import type { AnalysisChange } from './eventGroupService'
import {
  analysisReleaseCoalescingPolicy,
  decideAnalysisReleaseCoverage,
  resolveAnalysisReleaseIdentity,
  type AnalysisReleaseAttempt,
  type AnalysisReleaseCoverage
} from './analysisReleaseCoalescing'

/**
 * Gathers what the trigger line already recorded about one release, then asks whether this
 * indicator still has a chance at an analysis.
 *
 * Kept out of the runtime because it is a read-only scan with three sources (groups, their attempt
 * rows, and the runs those rows produced) and because the runtime file is on the file-size
 * baseline. The inputs are injected, so the whole decision is testable without SQLite.
 */
export type AnalysisReleaseAttemptSources = Readonly<{
  listEventGroups: () => readonly EventGroup[]
  listTriggerLedger: (eventGroupId: string) => readonly Readonly<{
    decision: string
    createdAt: string
    analysisRunId: string | null
  }>[]
  getRun: (runId: string) => Readonly<{ status: AnalysisRunStatus }> | undefined
  listItems: () => readonly IntelligenceItem[]
  listMetricEvents: () => readonly MetricIntelligenceEvent[]
}>

export function findAnalysisReleaseCoverage(
  input: AnalysisReleaseAttemptSources & Readonly<{ change: AnalysisChange; currentGroupId: string; now: string }>
): AnalysisReleaseCoverage {
  const items = new Map(input.listItems().map(item => [item.itemId, item]))
  const metricEvents = new Map(input.listMetricEvents().map(event => [event.itemId, event]))
  const item = items.get(input.change.eventRef)
  const identity = item
    ? resolveAnalysisReleaseIdentity({ item, metricEvent: metricEvents.get(input.change.eventRef) })
    : undefined
  // No release identity (no metric event behind the item): leave it to its own trigger decision.
  if (!identity) return { decision: 'uncovered' }

  const nowMs = Date.parse(input.now)
  if (!Number.isFinite(nowMs)) return { decision: 'uncovered' }
  const attempts: AnalysisReleaseAttempt[] = []
  for (const group of input.listEventGroups()) {
    if (group.id === input.currentGroupId || group.groupType !== 'macro') continue
    const observedAt = Date.parse(group.lastObservedAt)
    // A cheap window filter before any ledger read: releases around this moment only.
    if (!Number.isFinite(observedAt) || Math.abs(nowMs - observedAt) > analysisReleaseCoalescingPolicy.windowMs) continue
    const itemRef = group.eventRefs[0]
    const otherItem = itemRef ? items.get(itemRef) : undefined
    if (!otherItem) continue
    const other = resolveAnalysisReleaseIdentity({ item: otherItem, metricEvent: itemRef ? metricEvents.get(itemRef) : undefined })
    if (!other) continue
    for (const row of input.listTriggerLedger(group.id)) {
      // Only allowed attempts count. A skipped row (merged, refused, cooled down) never spent a call.
      if (row.decision !== 'queued') continue
      const status = row.analysisRunId ? input.getRun(row.analysisRunId)?.status ?? 'unknown' : 'unknown'
      attempts.push({ identity: other, decidedAt: row.createdAt, status })
    }
  }
  return decideAnalysisReleaseCoverage({ identity, now: input.now, attempts })
}
