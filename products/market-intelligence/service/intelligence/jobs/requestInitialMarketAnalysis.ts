import type { JobRuntime } from '@platform/jobs'
import type { AnalysisRun, EventGroup } from '../../../contracts/marketAnalysisContracts'
import type { IntelligenceItem } from '../schema/intelligenceRecord'
import type { MarketAnalysisRepository } from '../store/marketAnalysisRepository'
import { resolveTriggerKey, type AnalysisTriggerSource } from '../analysis/analysisTriggerSourcePolicy'
import type { AnalysisSessionSlot } from '../analysis/analysisSchedulePolicy'
import { FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB } from './marketAnalysisJobIds'

// Product-owned manual retry policy: an observation timeout never ends the background job.
export const initialMarketAnalysisRequestPolicy = Object.freeze({
  freezeObservationTimeoutMs: 45_000,
  retryableStatuses: ['failed', 'invalid-output', 'cancelled'] as readonly AnalysisRun['status'][],
  blockingStatuses: ['queued', 'running', 'succeeded'] as readonly AnalysisRun['status'][],
  /**
   * Statuses that mean "work for this group is already on its way". A duplicate request must
   * not create a second one, and they are the only statuses a correction refuses.
   */
  inFlightStatuses: ['queued', 'running'] as readonly AnalysisRun['status'][]
})

export function createInitialMarketAnalysisRequest(deps: {
  repository: MarketAnalysisRepository
  jobRuntime: JobRuntime
  listItems: () => IntelligenceItem[]
  createGroup: (itemId: string) => EventGroup
  now: () => string
  /** The capability's switch. Absent (headless/test wiring) leaves the request ungated. */
  isEnabled?: () => Promise<boolean>
}) {
  const pending = new Set<string>()
  return async (itemId: string | undefined, retryRunId: string | undefined, mode: 'initial' | 'refresh', source: AnalysisTriggerSource, slot?: AnalysisSessionSlot): Promise<{ itemId: string; queued: true }> => {
    if (mode !== 'initial' && mode !== 'refresh') throw new Error('analysis-invalid-request')
    // Asked before anything is written: a disabled capability must not create a group, a freeze job
    // or a run, so there is nothing left behind for a later run to trip over.
    if (deps.isEnabled && !await deps.isEnabled()) throw new Error('analysis-not-enabled')
    // `source` is required and has no default: a caller that forgets it must not silently
    // inherit the manual exemption from the gate.
    const triggerKey = resolveTriggerKey(source, mode, slot)
    const previousRun = retryRunId ? deps.repository.getRun(retryRunId) : undefined
    if (retryRunId && (!previousRun || !initialMarketAnalysisRequestPolicy.retryableStatuses.includes(previousRun.status))) throw new Error('analysis-invalid-request')
    const retryGroup = previousRun ? deps.repository.getEventGroup(previousRun.eventGroupId) : undefined
    if (retryRunId && !retryGroup) throw new Error('analysis-invalid-request')
    const items = deps.listItems().filter(eligible)
    const item = retryGroup ? items.find(candidate => retryGroup.eventRefs.includes(candidate.itemId))
      : itemId ? items.find(candidate => candidate.itemId === itemId)
        : items.sort((left, right) => left.detectedAt.localeCompare(right.detectedAt)).at(-1)
    if (!item) throw new Error('analysis-not-eligible')
    const group = retryGroup ?? deps.repository.listEventGroups().find(candidate => candidate.eventRefs.includes(item.itemId)) ?? deps.createGroup(item.itemId)
    const activeFreeze = deps.jobRuntime.listRuns({ handlerId: FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB,
      statuses: ['queued', 'running'], payload: { eventGroupId: group.id }, limit: 1 })
    const manual = source === 'manual'
    // The single-flight guard still holds -- a duplicate must not start a second freeze -- but
    // the reader who clicked 重新分析 is asking for the run that is already on its way, so
    // reporting it as queued is the honest answer. Refusing the click with "已有最新分析"
    // told the reader nothing was happening at the exact moment something was.
    const inFlight = pending.has(group.id) || activeFreeze.length > 0 ||
      deps.repository.listRuns().some(run => run.eventGroupId === group.id && initialMarketAnalysisRequestPolicy.inFlightStatuses.includes(run.status))
    if (inFlight) {
      if (manual) return { itemId: item.itemId, queued: true }
      throw new Error('analysis-already-available')
    }
    // 重新分析 exists to replace the published conclusion, so for a manual correction the
    // remaining "already available" rules are exactly what it is meant to override. Every
    // other caller keeps them: for a data-driven trigger a skip is a budget decision, and for
    // `initial` the freeze boundary enforces the same invariant this gate would.
    const manualCorrection = manual && mode === 'refresh'
    const blockingStatuses = mode === 'refresh'
      ? initialMarketAnalysisRequestPolicy.inFlightStatuses
      : initialMarketAnalysisRequestPolicy.blockingStatuses
    if (!manualCorrection && ((mode === 'initial' && group.currentSummaryId) || deps.repository.listRuns().some(run => run.eventGroupId === group.id && blockingStatuses.includes(run.status)))) throw new Error('analysis-already-available')
    pending.add(group.id)
    try {
      const job = await deps.jobRuntime.enqueueDefinition({
        id: `market-analysis:manual-freeze:${group.id}`, owner: 'product', productId: 'market-intelligence',
        handlerId: FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB, title: mode === 'refresh' ? 'Refresh market analysis snapshot' : 'Freeze first market analysis snapshot', trigger: { kind: 'manual' },
        payload: { eventGroupId: group.id, triggerKey, analysisPhase: mode === 'refresh' ? 'correction' : 'initial', asOf: deps.now() }
      })
      // Observe the freeze boundary so pre-run query/storage errors cannot masquerade as queued work.
      const terminal = await deps.jobRuntime.waitForRunTerminal(job.id, { timeoutMs: initialMarketAnalysisRequestPolicy.freezeObservationTimeoutMs })
      if (terminal.state !== 'terminal' || terminal.run.status !== 'completed') throw new Error('analysis-initial-request-failed')
      return { itemId: item.itemId, queued: true }
    } finally { pending.delete(group.id) }
  }
}

function eligible(item: IntelligenceItem): boolean {
  if (item.sourceTrust !== 'high' || !item.publishedAt) return false
  try {
    const labels = JSON.parse(item.processingLabelsJson ?? '{}')
    return labels.relevanceOutcome === 'full-intelligence' && labels.sentimentEligible === true
  } catch { return false }
}
