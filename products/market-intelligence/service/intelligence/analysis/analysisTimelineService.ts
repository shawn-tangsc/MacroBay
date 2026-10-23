import type { AnalysisRun, AnalysisSummary, Prediction, TimelineEntry } from '../../../contracts/marketAnalysisContracts'
import { analysisWorkspacePolicy, type AnalysisFollowUpInput } from '../../../contracts/analysisWorkspaceContracts'
import { projectTriggerStatus, type TriggerStatus, type TriggerStatusRow } from './triggerStatusProjection'
import { withSnapshotChange } from './snapshotChange'
import type { EvidenceSnapshot } from '../../../contracts/marketAnalysisContracts'

type ComparableSnapshot = Pick<EvidenceSnapshot, 'id' | 'eventGroupId' | 'createdAt' | 'snapshotHash' | 'facts' | 'missingDomains' | 'caveats' | 'evidenceRefs' | 'change'>

type Repository = Readonly<{
  listTimeline: (input: { eventGroupId?: string; cursor?: string | null; limit?: number }) => { items: readonly TimelineEntry[]; nextCursor: string | null }
  getTimelineEntry?: (id: string) => TimelineEntry | undefined
  getEventGroup: (id: string) => { id: string; currentSummaryId: string | null } | undefined
  getSnapshot?: (id: string) => (ComparableSnapshot & { asOf: string; dataCutoff: string }) | undefined
  listSnapshots?: (eventGroupId: string) => readonly ComparableSnapshot[]
  getRun: (id: string) => AnalysisRun | undefined
  getSummary: (id: string) => AnalysisSummary | undefined
  getSummaryForRun: (analysisRunId: string) => AnalysisSummary | undefined
  listPredictions: (summaryId: string) => readonly Prediction[]
  listTriggerLedger?: (eventGroupId: string) => readonly TriggerStatusRow[]
}>

/**
 * Renderer-facing description of what moved in a snapshot.
 *
 * The compact encoding (`~metric:old->new`) is for the model and for hashing; a
 * reader needs the subject, the unit and a countable summary, so the renderer gets
 * those instead of internal fact and evidence identifiers.
 */
export type RendererChangeView = Readonly<{
  /**
   * Deliberately no compact encoding here. It is a machine format for the model and
   * the hash, it reaches tens of thousands of characters for a large diff, and the
   * renderer renders the structured facts below instead.
   */
  facts: readonly Readonly<{
    domain: string
    subject: string | null
    metric: string
    unit: string | null
    kind: 'added' | 'removed' | 'changed'
    previousValue: string | number | null
    value: string | number | null
  }>[]
  missingDomainsAdded: readonly string[]
  missingDomainsRemoved: readonly string[]
  caveatsAdded: number
  caveatsRemoved: number
  evidenceRefsAdded: number
  evidenceRefsRemoved: number
}>

export type RendererTimelineEntry = Readonly<Pick<TimelineEntry, 'id' | 'eventGroupId' | 'analysisRunId' | 'kind' | 'status' | 'occurredAt' | 'summaryRef' | 'safeTitle' | 'safeExcerpt' | 'direction' | 'version'> & {
  /** Why the newest automatic decision for this group happened, or why it did not. */
  triggerStatus: TriggerStatus | null
}>
export type RendererTimelinePage = Readonly<{ schemaVersion: 1; items: readonly RendererTimelineEntry[]; nextCursor: string | null }>

export function createAnalysisTimelineService(deps: Readonly<{
  repository: Repository
  createFollowUpSession?: (input: AnalysisFollowUpInput) => Promise<string>
}>): Readonly<{
  listTimeline: (input: { eventGroupId?: string; cursor?: string | null; limit?: number }) => RendererTimelinePage
  getTimelineEntry: (id: string) => RendererTimelineEntry
  getAnalysisRun: (id: string) => Readonly<Pick<AnalysisRun, 'id' | 'eventGroupId' | 'analysisPhase' | 'status' | 'failureCode' | 'queuedAt' | 'startedAt' | 'completedAt'> & { asOf: string; dataCutoff: string; evidenceCount: number; change: RendererChangeView | null }>
  getSummary: (id: string) => Readonly<AnalysisSummary>
  listPredictions: (summaryId: string) => readonly Pick<Prediction, 'id' | 'summaryId' | 'asset' | 'horizonStart' | 'horizonEnd' | 'baseCase' | 'conditions' | 'invalidation' | 'nextCatalyst' | 'status' | 'verificationDueAt' | 'createdAt'>[]
  startFollowUp: (input: { eventGroupId: string; analysisRunId: string; existingSessionId?: string }) => Promise<{ agentId: string; sessionId: string; eventGroupId: string; analysisRunId: string }>
}> {
  function listTimeline(input: { eventGroupId?: string; cursor?: string | null; limit?: number }): RendererTimelinePage {
    const page = deps.repository.listTimeline(input)
    return { schemaVersion: 1, items: page.items.map(entry => toTimelineEntry(entry, readSummary(deps, entry), readTriggerStatus(deps, entry))), nextCursor: page.nextCursor }
  }

  function getTimelineEntry(id: string): RendererTimelineEntry {
    const entry = deps.repository.getTimelineEntry?.(id)
    if (!entry) throw new Error('analysis-timeline-entry-not-found')
    return toTimelineEntry(entry, readSummary(deps, entry), readTriggerStatus(deps, entry))
  }

  function getAnalysisRun(id: string) {
    const run = deps.repository.getRun(id)
    if (!run) throw new Error('analysis-run-not-found')
    const snapshot = deps.repository.getSnapshot?.(run.snapshotId)
    if (!snapshot) throw new Error('analysis-snapshot-not-found')
    return { id: run.id, eventGroupId: run.eventGroupId, analysisPhase: run.analysisPhase, status: run.status, failureCode: run.failureCode, queuedAt: run.queuedAt, startedAt: run.startedAt, completedAt: run.completedAt, asOf: snapshot.asOf, dataCutoff: snapshot.dataCutoff, evidenceCount: snapshot.evidenceRefs.length, change: changeViewFor(run, deps.repository) }
  }

  function getSummary(id: string): AnalysisSummary {
    const summary = deps.repository.getSummary(id)
    if (!summary) throw new Error('analysis-summary-not-found')
    return structuredClone(summary)
  }

  function listPredictions(summaryId: string) {
    if (!deps.repository.getSummary(summaryId)) throw new Error('analysis-summary-not-found')
    return deps.repository.listPredictions(summaryId).map(({ schemaVersion: _schemaVersion, ...prediction }) => prediction)
  }

  async function startFollowUp(input: { eventGroupId: string; analysisRunId: string; existingSessionId?: string }) {
    const group = deps.repository.getEventGroup(input.eventGroupId)
    const run = deps.repository.getRun(input.analysisRunId)
    if (!group || !run || run.eventGroupId !== group.id || run.status !== 'succeeded') throw new Error('analysis-event-group-not-found')
    const summary = deps.repository.getSummaryForRun(run.id)
    if (!summary || summary.analysisRunId !== run.id || summary.eventGroupId !== group.id) throw new Error('analysis-not-available')
    const sessionId = await deps.createFollowUpSession?.({ ...input, agentId: analysisWorkspacePolicy.agentId })
    if (!sessionId) throw new Error('analysis-follow-up-unavailable')
    return { agentId: 'crypto-market-analyst', sessionId, eventGroupId: group.id, analysisRunId: run.id }
  }

  return { listTimeline, getTimelineEntry, getAnalysisRun, getSummary, listPredictions, startFollowUp }
}

// The published conclusion lives in the immutable summary. Timeline nodes keep a
// stored excerpt for historical rows and for summaries that can no longer be
// read, so every renderer read restores the complete conclusion through the same
// summaryRef before falling back. `??` rather than `||` on purpose: an empty
// published assessment must stay empty instead of resurrecting a stored preview.
function readSummary(deps: { repository: Repository }, entry: TimelineEntry): { eventAssessment?: string; conclusion?: { summary: string; direction: string } } | undefined {
  const summaryRef = entry.summaryRef
  if (!summaryRef || !deps.repository.getSummary) return undefined
  try {
    return deps.repository.getSummary(summaryRef)
  } catch {
    return undefined
  }
}

/**
 * The decision that explains this entry's own run; a missing ledger or an unreadable run reads as
 * "nothing to say". Attributing the group's newest decision to every row is what made a reader's
 * 重新分析 row carry the staleness floor's wording.
 */
function readTriggerStatus(deps: { repository: Repository }, entry: TimelineEntry): TriggerStatus | null {
  try {
    const run = entry.analysisRunId ? deps.repository.getRun(entry.analysisRunId) : undefined
    return projectTriggerStatus(deps.repository.listTriggerLedger?.(entry.eventGroupId), run)
  } catch {
    return null
  }
}

function toTimelineEntry(entry: TimelineEntry, summary?: { eventAssessment?: string; conclusion?: { summary: string; direction: string } }, triggerStatus: TriggerStatus | null = null): RendererTimelineEntry {
  const { schemaVersion: _schemaVersion, ...safe } = entry
  // Structured summaries publish their verdict as `summary`; legacy rows keep the stored excerpt.
  // Entry-level rather than page-level: `listTimeline` may span several event groups.
  return {
    ...safe,
    safeExcerpt: summary?.conclusion?.summary ?? summary?.eventAssessment ?? safe.safeExcerpt,
    direction: (summary?.conclusion?.direction as TimelineEntry['direction']) ?? safe.direction ?? null,
    triggerStatus
  }
}

/**
 * Renders "what changed" for a run's snapshot.
 *
 * Snapshots frozen before the change record existed carry none, so it is derived
 * from the same event group's immutable predecessors. Returns null when the
 * snapshot itself cannot be read, so the reader falls back to the published
 * conclusion text instead of inventing a change.
 */
function changeViewFor(run: AnalysisRun, repository: Repository): RendererChangeView | null {
  const snapshot = repository.getSnapshot?.(run.snapshotId)
  if (!snapshot) return null
  const previous = repository.listSnapshots?.(run.eventGroupId) ?? []
  const resolved = withSnapshotChange(snapshot, previous)
  const change = resolved.change
  if (!change) return null
  return {
    facts: change.facts.map(fact => ({
      domain: String(fact.domain),
      subject: fact.subject ?? null,
      metric: fact.metric,
      unit: fact.unit ?? null,
      kind: fact.kind,
      previousValue: fact.previousValue ?? null,
      value: fact.value ?? null
    })),
    missingDomainsAdded: change.missingDomainsAdded.map(String),
    missingDomainsRemoved: change.missingDomainsRemoved.map(String),
    caveatsAdded: change.caveatsAdded.length,
    caveatsRemoved: change.caveatsRemoved.length,
    evidenceRefsAdded: change.evidenceRefsAdded.length,
    evidenceRefsRemoved: change.evidenceRefsRemoved.length
  }
}
