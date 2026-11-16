import type { AnalysisRun, AnalysisSummary, Prediction, TimelineEntry } from '../../../contracts/marketAnalysisContracts'
import { analysisWorkspacePolicy, type AnalysisFollowUpInput } from '../../../contracts/analysisWorkspaceContracts'
import { projectTriggerStatus, type TriggerStatus, type TriggerStatusRow } from './triggerStatusProjection'
import { withSnapshotChange } from './snapshotChange'
import type { EvidenceSnapshot } from '../../../contracts/marketAnalysisContracts'

type ComparableSnapshot = Pick<EvidenceSnapshot, 'id' | 'eventGroupId' | 'createdAt' | 'snapshotHash' | 'facts' | 'missingDomains' | 'caveats' | 'evidenceRefs' | 'change'>

type Repository = Readonly<{
  listTimeline: (input: { eventGroupId?: string; cursor?: string | null; limit?: number }) => { items: readonly TimelineEntry[]; nextCursor: string | null }
  getTimelineEntry?: (id: string) => TimelineEntry | undefined
  /**
   * The group's own identity. Both extra fields are optional: the group row may be an older shape,
   * and a test double that only knows the summary pointer must keep working.
   */
  getEventGroup: (id: string) => { id: string; currentSummaryId: string | null; groupType?: string; mergeKey?: string } | undefined
  getSnapshot?: (id: string) => (ComparableSnapshot & { asOf: string; dataCutoff: string }) | undefined
  listSnapshots?: (eventGroupId: string) => readonly ComparableSnapshot[]
  getRun: (id: string) => AnalysisRun | undefined
  getSummary: (id: string) => AnalysisSummary | undefined
  getSummaryForRun: (analysisRunId: string) => AnalysisSummary | undefined
  listPredictions: (summaryId: string) => readonly Prediction[]
  listTriggerLedger?: (eventGroupId: string) => readonly TriggerStatusRow[]
  /** 只有已发布运行会写时间轴行；排队/运行中/失败的运行靠它补进来。 */
  listRuns?: () => readonly AnalysisRun[]
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

/**
 * 一次运行在时间轴上的状态：发布过的行是前三种；**还没发布**的运行补成 `running` / `failed`。
 *
 * 用 `running` 而不是 `pending`：`pending` 在文案表里已经是预测条目的「待验证」，同一个 token
 * 两种含义，时间轴、最新结论卡、结论详情、详情抽屉四个页面必然分叉。`running` 本来就在运行
 * 状态词表里，一处一词。
 */
export type RendererTimelineStatus = TimelineEntry['status'] | 'running' | 'failed'

export type RendererTimelineEntry = Readonly<Omit<Pick<TimelineEntry, 'id' | 'eventGroupId' | 'analysisRunId' | 'kind' | 'status' | 'occurredAt' | 'summaryRef' | 'safeTitle' | 'safeExcerpt' | 'direction' | 'version'>, 'status'> & {
  status: RendererTimelineStatus
  /**
   * 同一次运行稳定不变的键：`running` → `published` / `failed` 之间不变，界面靠它就地把那
   * 一行换状态、行数不变（`id` 会从 `run:<runId>` 变成真实时间轴行 id）。没有运行的旧行用
   * `entry:<id>`。
   */
  runKey: string
  /** `failed` 行上运行自己的失败码；界面遇到未知码兜一句「解析失败」，不把码印给读者。 */
  failureCode: string | null
  /** Why the newest automatic decision for this group happened, or why it did not. */
  triggerStatus: TriggerStatus | null
  /**
   * Which kind of event this row belongs to (`macro`, `sentiment`, `funding`, ...).
   *
   * A page spans several event groups, and two rows published seconds apart are two different
   * events, not a duplicate: without this the list reads as the same conclusion posted twice.
   */
  groupType: string | null
  /** The group's own subject (a news headline, a series name) — what the conclusion is about. */
  groupSubject: string | null
}>
export type RendererTimelinePage = Readonly<{ schemaVersion: 1; items: readonly RendererTimelineEntry[]; nextCursor: string | null }>

export function createAnalysisTimelineService(deps: Readonly<{
  repository: Repository
  /** 读者时区：时间线的「哪个开盘」按它换算。 */
  timeZone: () => string
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
    // One group can own several rows on a page (an analysis and its review, an event and its
    // update), and the name is read per row: without this the same group row was read once per row.
    const groups = new Map<string, { groupType: string | null; groupSubject: string | null }>()
    const groupFor = (eventGroupId: string) => {
      const cached = groups.get(eventGroupId)
      if (cached) return cached
      const resolved = readGroup(deps, eventGroupId)
      groups.set(eventGroupId, resolved)
      return resolved
    }
    const items = page.items.map(entry => toTimelineEntry(entry, readSummary(deps, entry), readTriggerStatus(deps, entry), groupFor(entry.eventGroupId)))
    // 翻页不注入：正在跑的运行永远属于最新那一屏，往历史页里塞反而会让游标对不上。
    if (input.cursor) return { schemaVersion: 1, items, nextCursor: page.nextCursor }
    const represented = new Set(items.flatMap(item => item.analysisRunId ? [item.analysisRunId] : []))
    return {
      schemaVersion: 1,
      items: [...unpublishedRunEntries(deps, groupFor, input.eventGroupId, represented), ...items]
        .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || right.id.localeCompare(left.id)),
      nextCursor: page.nextCursor
    }
  }

  function getTimelineEntry(id: string): RendererTimelineEntry {
    const entry = deps.repository.getTimelineEntry?.(id)
    if (!entry) throw new Error('analysis-timeline-entry-not-found')
    return toTimelineEntry(entry, readSummary(deps, entry), readTriggerStatus(deps, entry), readGroup(deps, entry.eventGroupId))
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

/**
 * 时间轴条目只来自已发布的摘要，所以「正在解析」在这里本来是空的——读者只能靠猜。
 *
 * 这条把还没发布的运行补进来：排队/运行中是 `pending`，跑挂了（失败、输出不合法、取消）是
 * `failed`。它和发布行是同一次运行，`analysisRunId` 相同——列表据此把两态认成同一行，发布那一刻
 * 就地变状态，条数不变。
 *
 * `safeTitle` 留空：状态词由界面文案表给，服务端不在这里印中文（发布行那句是历史遗留）。
 * `stale` / `superseded` 不补：那是记账状态，不是读者在看的那件事。
 */
const pendingRunStatuses: ReadonlySet<string> = new Set(['queued', 'running'])
const failedRunStatuses: ReadonlySet<string> = new Set(['failed', 'invalid-output', 'cancelled'])
const maximumUnpublishedEntries = 20

function unpublishedRunEntries(
  deps: { repository: Repository },
  groupFor: (eventGroupId: string) => { groupType: string | null; groupSubject: string | null },
  eventGroupId: string | undefined,
  represented: ReadonlySet<string>
): RendererTimelineEntry[] {
  const runs = deps.repository.listRuns?.() ?? []
  return runs
    .filter(run => (pendingRunStatuses.has(run.status) || failedRunStatuses.has(run.status)) &&
      !represented.has(run.id) && (eventGroupId === undefined || run.eventGroupId === eventGroupId))
    .sort((left, right) => right.queuedAt.localeCompare(left.queuedAt))
    .slice(0, maximumUnpublishedEntries)
    .map(run => {
      const group = groupFor(run.eventGroupId)
      return {
        id: `run:${run.id}`,
        eventGroupId: run.eventGroupId,
        analysisRunId: run.id,
        kind: run.analysisPhase === 'review' ? 'review' : 'analysis',
        status: pendingRunStatuses.has(run.status) ? 'running' : 'failed',
        runKey: run.id,
        failureCode: failedRunStatuses.has(run.status) ? run.failureCode ?? null : null,
        // 排队那一刻就要出现在时间轴上：读者是按下按钮之后立刻去找它的。
        occurredAt: run.startedAt ?? run.queuedAt,
        summaryRef: null,
        safeTitle: '',
        safeExcerpt: null,
        direction: null,
        version: 1,
        triggerStatus: null,
        groupType: group.groupType,
        // 组没有主体名时退回触发那条新闻的标题：读者要知道这是哪条新闻在解析。
        groupSubject: group.groupSubject ?? triggerSubjectLabel(deps, run)
      } satisfies RendererTimelineEntry
    })
}

function triggerSubjectLabel(deps: { repository: Repository }, run: AnalysisRun): string | null {
  const snapshot = deps.repository.getSnapshot?.(run.snapshotId) as
    Readonly<{ trigger?: { factId: string }; facts?: readonly Readonly<{ factId: string; subjectLabel?: string }>[] }> | undefined
  if (!snapshot?.trigger) return null
  const fact = snapshot.facts?.find(candidate => candidate.factId === snapshot.trigger!.factId)
  return fact?.subjectLabel?.trim() || null
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
function readTriggerStatus(deps: { repository: Repository; timeZone: () => string }, entry: TimelineEntry): TriggerStatus | null {
  try {
    const run = entry.analysisRunId ? deps.repository.getRun(entry.analysisRunId) : undefined
    return projectTriggerStatus(deps.repository.listTriggerLedger?.(entry.eventGroupId), run, deps.timeZone())
  } catch {
    return null
  }
}

/**
 * The group a row belongs to; an unreadable group is "unknown", never an exception.
 *
 * The timeline is a read of published rows. A group that cannot be read (retention, a
 * half-migrated store) must not turn the whole list into a failure, so the two labels simply
 * go missing.
 */
function readGroup(deps: { repository: Repository }, eventGroupId: string): { groupType: string | null; groupSubject: string | null } {
  try {
    const group = deps.repository.getEventGroup(eventGroupId)
    return { groupType: group?.groupType ?? null, groupSubject: subjectFromMergeKey(group?.mergeKey) }
  } catch {
    return { groupType: null, groupSubject: null }
  }
}

/**
 * What a group is about, read from its merge key.
 *
 * `eventGroupMergeKey` joins the group type, the source kind, the domain, the subject and the
 * release bucket, and the bucket is always the last segment — so the subject is the one before it:
 * a news headline for a sentiment group, the series name for a macro one. A key of an older or
 * unknown shape yields null rather than a wrong subject; a caption naming the wrong event is worse
 * than no caption. A subject still saying `unknown` is a placeholder, not a name.
 */
export function subjectFromMergeKey(mergeKey: string | null | undefined): string | null {
  if (!mergeKey) return null
  const segments = mergeKey.split('|')
  if (segments.length < 5) return null
  const subject = segments[segments.length - 2]?.trim()
  if (!subject || subject.toLowerCase() === 'unknown') return null
  return subject.length > 80 ? `${subject.slice(0, 79)}…` : subject
}

function toTimelineEntry(entry: TimelineEntry, summary?: { eventAssessment?: string; conclusion?: { summary: string; direction: string } }, triggerStatus: TriggerStatus | null = null, group: { groupType: string | null; groupSubject: string | null } = { groupType: null, groupSubject: null }): RendererTimelineEntry {
  const { schemaVersion: _schemaVersion, ...safe } = entry
  // Structured summaries publish their verdict as `summary`; legacy rows keep the stored excerpt.
  // Entry-level rather than page-level: `listTimeline` may span several event groups.
  return {
    ...safe,
    // 同一次运行在「正在解析 → 已发布」之间用同一个键，行不换身份。
    runKey: entry.analysisRunId ?? `entry:${entry.id}`,
    failureCode: null,
    safeExcerpt: summary?.conclusion?.summary ?? summary?.eventAssessment ?? safe.safeExcerpt,
    direction: (summary?.conclusion?.direction as TimelineEntry['direction']) ?? safe.direction ?? null,
    triggerStatus,
    groupType: group.groupType,
    groupSubject: group.groupSubject
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
