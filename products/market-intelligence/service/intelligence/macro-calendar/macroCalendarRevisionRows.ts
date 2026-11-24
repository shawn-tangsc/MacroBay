import { createHash } from 'node:crypto'

import { MACRO_CALENDAR_SCHEMA_VERSION, type MacroCalendarRevision, type MacroCalendarValue } from './macroCalendarContracts'
import type { NarwhalReleaseRow, NarwhalReleaseValue } from './narwhalReleaseContracts'
import { isValidIsoTime } from '../public-query/asOfVisibility'
import { gradeCalendarEvent } from './calendarEventImportance'

/**
 * 修订行的**读写编解码**：行 ↔ 记录、快照哈希、有效行挑选。从仓库里拆出来，逻辑原样搬过来。
 *
 * 为什么单独一层：仓库本体是「语句 + 事务 + 对外方法」，这些纯函数与 SQL 无关，混在一起
 * 会让一个文件同时承担两件事，也是它涨到 500 行以上的原因。
 */
/**
 * 行类型与两条按源来的判据：**判据跟着编解码走**，不留在仓储里（仓储只留语句与事务）。
 * `macroCalendarAppendOnlyProviderId` 同时被有效行排序用到，所以排序 SQL 也由这里给出。
 */
export type StoredRow = Record<string, unknown>
/** 读取路径里 `sqlite` 回来的裸行（列名 → 值）。 */
export type Row = Record<string, string | null>

const macroCalendarAppendOnlyProviderId = 'macro-calendar-fed'
/** 有效行的排序键：**这条规则只有一份**，仓储、月份查询、按源查询都用它。 */
export const macroCalendarEffectiveOrderSql = `detected_at_ms desc, recorded_at desc, case when provider_id = '${macroCalendarAppendOnlyProviderId}' then rowid end desc, revision_id desc`

export const macroCalendarCurrentStatePolicy = {
  automaticBlsDescriptorIds: ['macro-calendar-bls-python-schedule', 'macro-calendar-bls-calendar-family-refresh-api-v2'],
  manualBlsDescriptorId: 'macro-calendar-bls-ics-manual',
  obsoleteBlsFamilies: ['cpi', 'core-cpi'],
  obsoleteManualValueDescriptorId: 'macro-calendar-bls-employment-refresh-api'
} as const

export function macroCalendarSnapshotHash(revision: MacroCalendarRevision): string {
  const { revisionId: _revisionId, recordedAt: _recordedAt, snapshotHash: _snapshotHash, rawRecordId: _rawRecordId, ...semantic } = revision
  const evidenceRefs = semantic.evidenceRefs
    .map(normalizeEvidenceRef)
    .sort((left, right) => evidenceIdentity(left).localeCompare(evidenceIdentity(right)))
  return createHash('sha256').update(JSON.stringify({ ...semantic, evidenceRefs })).digest('hex')
}

export function macroCalendarCurrentHash(revision: MacroCalendarRevision): string {
  const {
    revisionId: _revisionId,
    detectedAt: _detectedAt,
    recordedAt: _recordedAt,
    rawRecordId: _rawRecordId,
    evidenceHash: _evidenceHash,
    evidenceRefs: _evidenceRefs,
    snapshotHash: _snapshotHash,
    replacesRevisionId: _replacesRevisionId,
    ...content
  } = revision
  /**
   * **按键排序后再序列化**：这个哈希只用于「运行时判断两版内容是否相同」，从不落库。
   * 不排序时，`fromRow` 读回来的字段顺序与构造时不同（新字段插在中间还是末尾），
   * 同一份内容会算出两个哈希——去重当场失效（R44 加 `importanceGrade` 时实测踩到）。
   */
  return createHash('sha256').update(stableJson(content)).digest('hex')
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    // `undefined` 的字段整键略过（与 JSON.stringify 一致）：`fromRow` 会把缺失的列显式写成
    // `undefined`，构造出来的对象则干脆没有这个键——两者必须算同一份内容。
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function isAutomaticBlsRecord(revision: MacroCalendarRevision): boolean {
  return revision.providerId === 'macro-calendar-bls' &&
    (macroCalendarCurrentStatePolicy.automaticBlsDescriptorIds as readonly string[]).includes(revision.descriptorId)
}

export function isFedOfficialRecord(revision: MacroCalendarRevision): boolean {
  return revision.providerId === macroCalendarAppendOnlyProviderId &&
    (revision.revisionKind === 'official-release' || revision.revisionKind === 'official-revision')
}

/** FedFomcOfficialRevisionPolicy: only the chain tail dedupes; evidence changes remain auditable. */
export function fedOfficialContentHash(revision: MacroCalendarRevision): string {
  const value = (input: MacroCalendarValue | undefined) => input ? [input.displayValue, input.numericValue, input.numericLowerBound, input.numericUpperBound, input.unit] : null
  return JSON.stringify([revision.eventKey, revision.publishedAt, value(revision.actual), value(revision.previous), revision.evidenceHash])
}

export function isFedSchedule(revision: MacroCalendarRevision): boolean {
  return revision.providerId === macroCalendarAppendOnlyProviderId && revision.revisionKind === 'schedule'
}

export function isManualBlsSchedule(revision: MacroCalendarRevision): boolean {
  return revision.providerId === 'macro-calendar-bls' && revision.revisionKind === 'schedule' &&
    revision.descriptorId === macroCalendarCurrentStatePolicy.manualBlsDescriptorId &&
    revision.eventFamily !== 'cpi' && revision.eventFamily !== 'core-cpi'
}

export function currentRecordPriority(revision: MacroCalendarRevision): number {
  if (isAutomaticBlsRecord(revision) && (revision.revisionKind === 'official-release' || revision.revisionKind === 'official-revision')) return 3
  if (isAutomaticBlsRecord(revision)) return 2
  return 1
}

/**
 * **写修订行前先算我们的档**（R44 S1）：`appendIfNew` / `appendManyIfNew` 两条写路都经过这里，
 * 所以「某条采集路径没判档」结构上不可能发生。`importance`（旧列，源给的）保持原样写入不动。
 */
export function prepareRevision(revision: MacroCalendarRevision): MacroCalendarRevision {
  if (persistedEpochTime(revision.detectedAt) === undefined) throw new Error('invalid detectedAt')
  const importanceGrade = gradeCalendarEvent({ countryCode: revision.countryCode,
    eventKey: revision.eventKey, eventFamily: revision.eventFamily })?.tier
  return { ...revision, ...(importanceGrade === undefined ? {} : { importanceGrade }),
    snapshotHash: macroCalendarSnapshotHash(revision) }
}

export function values(revision: MacroCalendarRevision): Array<string | number | null> {
  const detectedAtMs = persistedEpochTime(revision.detectedAt)
  if (detectedAtMs === undefined) throw new Error('invalid detectedAt')
  return [revision.revisionId, revision.eventKey, revision.releaseGroupKey, revision.eventFamily, revision.eventNameKey, revision.countryCode, revision.importance ?? null, revision.periodKey, revision.lifecycleState, revision.revisionKind, revision.scheduledDate, revision.scheduledAt ?? null, revision.publishedAt ?? null, revision.detectedAt, detectedAtMs, revision.recordedAt, json(revision.actual), json(revision.previous), json(revision.consensus), revision.providerId, revision.descriptorId, revision.sourceUrl, revision.rawRecordId ?? null, revision.evidenceHash, JSON.stringify(revision.evidenceRefs), revision.snapshotHash, revision.replacesRevisionId ?? null, revision.parserVersion, JSON.stringify(revision.caveats), MACRO_CALENDAR_SCHEMA_VERSION,
    revision.importanceGrade ?? null]
}

export function effective(rows: Row[]): MacroCalendarRevision[] {
  const seen = new Set<string>()
  return rows.map(fromRow).filter((revision) => !seen.has(revision.eventKey) && Boolean(seen.add(revision.eventKey)))
}

export function fromRow(row: Row): MacroCalendarRevision {
  const importance = readImportance(row.importance)
  return { revisionId: required(row, 'revision_id'), eventKey: required(row, 'event_key'), releaseGroupKey: required(row, 'release_group_key'), eventFamily: required(row, 'event_family') as MacroCalendarRevision['eventFamily'], eventNameKey: required(row, 'event_name_key'), countryCode: 'US', ...(importance === undefined ? {} : { importance }), periodKey: required(row, 'period_key'), lifecycleState: required(row, 'lifecycle_state') as MacroCalendarRevision['lifecycleState'], revisionKind: required(row, 'revision_kind') as MacroCalendarRevision['revisionKind'], scheduledDate: required(row, 'scheduled_date'), scheduledAt: row.scheduled_at ?? undefined, publishedAt: row.published_at ?? undefined, detectedAt: required(row, 'detected_at'), recordedAt: required(row, 'recorded_at'), actual: parseValue(row.actual_json), previous: parseValue(row.previous_json), consensus: parseValue(row.consensus_json), providerId: required(row, 'provider_id') as MacroCalendarRevision['providerId'], descriptorId: required(row, 'descriptor_id'), sourceUrl: required(row, 'source_url'), rawRecordId: row.raw_record_id ?? undefined, evidenceHash: required(row, 'evidence_hash'), evidenceRefs: JSON.parse(required(row, 'evidence_refs_json')), snapshotHash: required(row, 'snapshot_hash'), replacesRevisionId: row.replaces_revision_id ?? undefined,
    ...(row.importance_grade === undefined || row.importance_grade === null
      ? {} : { importanceGrade: row.importance_grade as MacroCalendarRevision['importanceGrade'] }), parserVersion: required(row, 'parser_version'), caveats: JSON.parse(required(row, 'caveats_json')) }
}

function required(row: Row, name: string): string { return row[name] ?? '' }
/** 读记录自己的重要性：只认三档，读到别的文本就是「没有值」，不挑一档顶上。 */
function readImportance(value: string | null): MacroCalendarRevision['importance'] {
  return value === 'high' || value === 'medium' || value === 'low' ? value : undefined
}
function json(value: MacroCalendarValue | undefined): string | null { return value ? JSON.stringify(value) : null }
function parseValue(value: string | null): MacroCalendarValue | undefined { return value ? JSON.parse(value) : undefined }
function normalizeEvidenceRef(value: MacroCalendarRevision['evidenceRefs'][number]): Omit<MacroCalendarRevision['evidenceRefs'][number], 'rawRecordId'> {
  const { rawRecordId: _rawRecordId, ...stable } = value
  return { ...stable, fieldKinds: [...stable.fieldKinds].sort() }
}
function evidenceIdentity(value: Omit<MacroCalendarRevision['evidenceRefs'][number], 'rawRecordId'>): string {
  return JSON.stringify([value.providerId, value.descriptorId, value.sourceUrl, value.evidenceHash, value.detectedAt, value.fieldKinds])
}
export function epochTime(value: string): number | undefined { return isValidIsoTime(value) ? Date.parse(value) : undefined }
export function persistedEpochTime(value: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return undefined
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value ? milliseconds : undefined
}


/** 快照里的值存成 `{displayValue}` 的 JSON，读回来只取那个字符串。 */
export function valueOf(value: unknown): string | undefined {
  if (typeof value !== 'string' || value === '') return undefined
  try {
    const parsed = JSON.parse(value) as { displayValue?: unknown }
    return typeof parsed.displayValue === 'string' ? parsed.displayValue : undefined
  } catch { return undefined }
}

export function toReleaseRow(row: StoredRow): NarwhalReleaseRow {
  const basis = String(row.date_basis)
  return {
    releaseId: String(row.release_id), providerId: String(row.provider_id), countryCode: String(row.country_code),
    scheduledDate: String(row.scheduled_date),
    ...(typeof row.scheduled_at === 'string' ? { scheduledAt: row.scheduled_at } : {}),
    dateBasis: basis === 'indicative' ? basis : 'exact',
    ...(typeof row.status === 'string' ? { status: row.status } : {}),
    values: JSON.parse(String(row.values_json)) as NarwhalReleaseValue[],
    detectedAt: String(row.detected_at), recordedAt: String(row.recorded_at)
  }
}
