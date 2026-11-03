import type {
  AnalysisPredictionStatus,
  AnalysisRun,
  AnalysisSummary,
  EvidenceSnapshot,
  EventGroup,
  PredictionLedgerEntry,
  TimelineEntry
} from '../../../contracts/marketAnalysisContracts'
import {
  mostSevereSkippedEvidence, parseSignalEvidence, signalEvidenceJson
} from '../../../contracts/moduleSignalEvidence'
import { buildAnalysisSnapshotHash, snapshotHashInput } from '../analysis/analysisHash'

/**
 * 一行存储记录与一条领域记录之间的换算，以及「这个记录根本说不出口」的拒绝。
 *
 * 单独成文件的原因只有一个：**这是唯一一处把存储字节解释成应用会显示的东西**。放在仓储实现里时，
 * 它和 SQL、游标、迁移混在同一个 500 多行的文件里，改一个字段名要在四处翻；挪出来之后，「表里读到的
 * 是什么」和「怎么读」是两个可以分别读的段落。
 *
 * 这里的函数都是纯的：不碰连接、不写盘、不吞异常。校验失败一律抛出，因为一条缺了依据的摘要
 * 被当成正常读完，比拒绝读更糟——那会让界面显示一段引用不到证据的结论。
 */
export type StoredRow = Record<string, unknown>

const ARCHIVE_REF_PATTERN = /^[a-f0-9]{64}\.json\.gz$/
const ARCHIVE_STATUS = Object.freeze({ readable: 'readable', unavailable: 'unavailable' } as const)

export type MarketAnalysisArchiveMetadata = Readonly<{
  archiveRef: string
  archiveHash: string
  archiveBytes: number
  archiveSchemaVersion: number
  archiveStatus: keyof typeof ARCHIVE_STATUS
}>

/**
 * One rewrite rule for a row that stops being a queued run.
 *
 * The decision picks the shape, so the batch is converted here and never left for the reader to
 * discard. Corrupt bytes become `null` on purpose: keeping them would keep a row that claims a
 * reading it cannot state.
 */
export function restateAsSkipped(stored: string | null): string | null {
  const queued = parseSignalEvidence('queued', stored)
  // `parseSignalEvidence` returns whichever shape its decision validates; the key check narrows it
  // back for the conversion, because the parser's return type names both shapes.
  if (queued && 'signalCount' in queued) return signalEvidenceJson('skipped', mostSevereSkippedEvidence(queued))
  const skipped = parseSignalEvidence('skipped', stored)
  return skipped && !('signalCount' in skipped) ? signalEvidenceJson('skipped', skipped) : null
}

export function validateEventGroup(value: EventGroup): void { if (!value.id.startsWith('mi-eg-') || value.schemaVersion !== 1) throw new Error('analysis-event-group-invalid') }

export function validateSnapshot(value: EvidenceSnapshot): void {
  if (!value.id.startsWith('mi-es-') || (value.schemaVersion !== 1 && value.schemaVersion !== 2) || value.snapshotHash !== buildAnalysisSnapshotHash(snapshotHashInput(value))) throw new Error('analysis-snapshot-invalid')
}

export function validateRun(value: AnalysisRun): void { if (!value.id.startsWith('mi-ar-') || value.schemaVersion !== 1) throw new Error('analysis-run-invalid') }

export function validateArchiveMetadata(value: MarketAnalysisArchiveMetadata | undefined): void {
  if (!value) return
  if (!ARCHIVE_REF_PATTERN.test(value.archiveRef) || !/^[a-f0-9]{64}$/.test(value.archiveHash) || !Number.isSafeInteger(value.archiveBytes) || value.archiveBytes <= 0 || !Number.isSafeInteger(value.archiveSchemaVersion) || value.archiveSchemaVersion < 1 || !Object.values(ARCHIVE_STATUS).includes(value.archiveStatus)) throw new Error('analysis-archive-metadata-invalid')
  if (value.archiveRef.slice(0, 64) !== value.archiveHash) throw new Error('analysis-archive-metadata-invalid')
}

export function validateSummaryReferences(summary: AnalysisSummary, snapshot: EvidenceSnapshot): void {
  const facts = new Set(snapshot.facts.map(value => value.factId))
  const evidence = new Set(snapshot.evidenceRefs.map(value => value.evidenceRefId))
  const factRefs = [...summary.knownFacts.map(value => value.factId), ...summary.marketReaction.flatMap(value => value.factIds)]
  const evidenceRefs = [
    ...summary.knownFacts.flatMap(value => value.evidenceRefIds),
    ...summary.transmissionHypotheses.flatMap(value => value.evidenceRefIds),
    ...summary.marketReaction.flatMap(value => value.evidenceRefIds),
    ...summary.supportingEvidence.map(value => value.evidenceRefId),
    ...summary.counterEvidence.map(value => value.evidenceRefId),
    ...summary.nextCatalysts.flatMap(value => value.evidenceRefIds),
    ...(summary.directions ?? []).flatMap(value => value.evidenceRefIds),
    ...summary.evidenceRefs
  ]
  if (factRefs.some(value => !facts.has(value)) || evidenceRefs.some(value => !evidence.has(value))) throw new Error('analysis-missing-evidence')
}

export function fromEventGroup(row: StoredRow): EventGroup { return { id: String(row.id), schemaVersion: Number(row.schema_version) as 1, status: row.status as EventGroup['status'], groupType: row.group_type as EventGroup['groupType'], mergeKey: String(row.merge_key), firstObservedAt: String(row.first_observed_at), lastObservedAt: String(row.last_observed_at), reviewDeadlineAt: String(row.review_deadline_at), eventRefs: JSON.parse(String(row.event_refs_json)), triggerCount: Number(row.trigger_count), reviewCount: Number(row.review_count), currentSummaryId: row.current_summary_id as string | null, supersededByGroupId: row.superseded_by_group_id as string | null, revision: Number(row.revision), createdAt: String(row.created_at), updatedAt: String(row.updated_at) } }
export function fromSnapshot(row: StoredRow): EvidenceSnapshot { return { id: String(row.id), schemaVersion: Number(row.schema_version) as 1 | 2, eventGroupId: String(row.event_group_id), asOf: String(row.as_of), dataCutoff: String(row.data_cutoff), snapshotHash: String(row.snapshot_hash), profileId: 'crypto-market-analysis-v1', facts: JSON.parse(String(row.facts_json)), missingDomains: JSON.parse(String(row.missing_domains_json)), caveats: JSON.parse(String(row.caveats_json)), evidenceRefs: JSON.parse(String(row.evidence_refs_json)), sourceHealth: JSON.parse(String(row.source_health_json)), createdAt: String(row.created_at), policyVersion: 'cryptoMarketAnalysisTriggerPolicy.v1' } }
export function fromRun(row: StoredRow): AnalysisRun { return { id: String(row.id), schemaVersion: Number(row.schema_version) as 1, eventGroupId: String(row.event_group_id), snapshotId: String(row.snapshot_id), snapshotHash: String(row.snapshot_hash), analysisPhase: row.analysis_phase as AnalysisRun['analysisPhase'], triggerKey: String(row.trigger_key), idempotencyKey: String(row.idempotency_key), status: row.status as AnalysisRun['status'], attempt: Number(row.attempt), retryOfRunId: row.retry_of_run_id as string | null, modelProviderId: row.model_provider_id as string | null, modelId: row.model_id as string | null, policyVersion: String(row.policy_version), promptVersion: String(row.prompt_version), skillVersion: String(row.skill_version), outputSchemaVersion: Number(row.output_schema_version) as 1 | 2, jobRunId: row.job_run_id as string | null, traceId: row.trace_id as string | null, failureCode: row.failure_code as string | null, failureDetailCode: row.failure_detail_code as string | null, queuedAt: String(row.queued_at), startedAt: row.started_at as string | null, completedAt: row.completed_at as string | null } }
export function fromTimeline(row: StoredRow): TimelineEntry { return { id: String(row.id), schemaVersion: Number(row.schema_version) as 1, eventGroupId: String(row.event_group_id), analysisRunId: row.analysis_run_id as string | null, kind: row.kind as TimelineEntry['kind'], status: row.status as TimelineEntry['status'], occurredAt: String(row.occurred_at), summaryRef: row.summary_ref as string | null, safeTitle: String(row.safe_title), safeExcerpt: row.safe_excerpt as string | null, direction: (row.direction as TimelineEntry['direction']) ?? null, version: Number(row.version) } }
export function fromLedger(row: StoredRow): PredictionLedgerEntry { return { predictionId: String(row.prediction_id), schemaVersion: 1, asset: row.asset as PredictionLedgerEntry['asset'], horizonStart: String(row.horizon_start), horizonEnd: String(row.horizon_end), predicate: row.predicate === null ? null : String(row.predicate), conditionCount: Number(row.condition_count), status: row.status as AnalysisPredictionStatus, reasonCode: String(row.reason_code), ruleVersion: row.rule_version as PredictionLedgerEntry['ruleVersion'], evidenceRefs: JSON.parse(String(row.evidence_refs_json)) as string[], evidenceRefCount: Number(row.evidence_ref_count), predictionCreatedAt: String(row.prediction_created_at), evaluatedAt: String(row.evaluated_at) } }
export function stableMergeKey(value: string): string { const parts = value.split('|'); return parts.slice(0, -1).join('|') }
