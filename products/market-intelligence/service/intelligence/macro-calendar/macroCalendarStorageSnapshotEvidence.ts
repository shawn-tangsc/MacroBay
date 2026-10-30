import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { macroCalendarEvidenceArchivePolicy as limits, type MacroCalendarEvidenceArchive } from './macroCalendarEvidenceArchive'
import type { RawIntelligenceRecord } from '../schema/intelligenceRecord'
import { MACRO_CALENDAR_SCHEMA_VERSION } from './macroCalendarContracts'
import { getMacroCalendarEvidenceSourceDescriptor } from './macroCalendarOfficialSourceRegistry'
import { zeroXRouterCalendarStoragePolicy as market } from './0xrouter-calendar/marketCalendarStorageValidation'
import { blsEmploymentMvpRefreshPolicy as bls } from './bls-employment-refresh/blsEmploymentMvpRefreshService'
import { blsEmploymentMvpEvidencePolicy as blsEvidence } from './bls-employment-refresh/blsEmploymentMvpEvidence'
import { beaOfficialReleaseRevisionPolicy as bea } from './bea-official-release/beaOfficialReleaseRevisionFactory'
import { beaOfficialReleaseEvidencePolicy as beaEvidence } from './bea-official-release/beaOfficialReleaseEvidence'
import { fedFomcDecisionRefreshPolicy as fed } from './fed-statements/fedFomcDecisionRefreshService'
import { fedFomcDecisionEvidencePolicy as fedEvidence } from './fed-statements/fedFomcDecisionEvidence'

// CalendarBackupPolicy, owned by product design 121; no identity inference or repair.
export const calendarSnapshotEvidencePolicy = Object.freeze({
  pageSize: 100,
  officialTables: ['mi_macro_calendar_migrations', 'mi_macro_calendar_revisions', 'mi_bea_release_observation_state'],
  marketTables: ['mi_macro_calendar_market_event_collections', 'mi_macro_calendar_market_event_observations', 'mi_macro_calendar_provider_indicator_links'],
  migrationVersions: [1, 2, 3, 4, 5, 6], hashPattern: /^[a-f0-9]{64}$/,
  canonicalMarketProvider: '0xrouter', archiveMarketProvider: 'macro-calendar-0xrouter'
})
export type SnapshotFailureCode = 'schema-invalid' | 'evidence-invalid' | 'evidence-unresolved' | 'capacity' | 'path-invalid' | 'bundle-invalid' | 'incomplete' | 'io-failure'
export class CalendarSnapshotFailure extends Error {
  constructor(readonly code: SnapshotFailureCode) { super(code) }
}
export function snapshotReject(code: SnapshotFailureCode): never { throw new CalendarSnapshotFailure(code) }
export function snapshotHash(body: string | Uint8Array): string { return createHash('sha256').update(body).digest('hex') }
type Ref = { rawRecordId?: string; descriptorId: string; providerId: string; evidenceHash: string; sourceUrl?: string; fieldKinds?: string[] }
type Official = Ref & { parserVersion: string; refs: Ref[] }
type Expected = Ref & { sourceId: string; parserVersion?: string; metadata?: string }
type Row = Record<string, unknown>
export type SnapshotEvidence = { referenceCount: number; bodyCount: number; bodyBytes: number; records: RawIntelligenceRecord[] }

export function validateSnapshotSchema(database: DatabaseSync): boolean {
  try {
    const integrity = database.prepare('pragma integrity_check').iterate()
    for (const row of integrity) if (row.integrity_check !== 'ok') snapshotReject('schema-invalid')
    if (!database.prepare('pragma foreign_key_check').iterate().next().done) snapshotReject('schema-invalid')
    const exists = (name: string) => Boolean(database.prepare("select 1 from sqlite_schema where type='table' and name=?").get(name))
    const policy = calendarSnapshotEvidencePolicy
    if (!policy.officialTables.every(exists)) snapshotReject('schema-invalid')
    const versions = database.prepare('select version from mi_macro_calendar_migrations order by version').all()
    if (JSON.stringify(versions.map(row => row.version)) !== JSON.stringify(policy.migrationVersions)) snapshotReject('schema-invalid')
    if (database.prepare('select 1 from mi_macro_calendar_revisions where schema_version != ? or schema_version is null limit 1').get(MACRO_CALENDAR_SCHEMA_VERSION)) snapshotReject('schema-invalid')
    const present = policy.marketTables.filter(exists).length
    if (present !== 0 && present !== policy.marketTables.length) snapshotReject('schema-invalid')
    if (present) for (const table of policy.marketTables.slice(1)) {
      if (database.prepare(`select 1 from ${table} where schema_version != ? or schema_version is null limit 1`).get(market.schemaVersion)) snapshotReject('schema-invalid')
    }
    return present > 0
  } catch { return snapshotReject('schema-invalid') }
}

export async function collectSnapshotEvidence(database: DatabaseSync,
  archive: Pick<MacroCalendarEvidenceArchive, 'getRecord' | 'readBody'>,
  acceptBody: (record: RawIntelligenceRecord, body: string) => Promise<void>): Promise<SnapshotEvidence> {
  const hasMarket = validateSnapshotSchema(database)
  const records = new Map<string, RawIntelligenceRecord>()
  const identities = new Map<string, string>()
  const bodies = new Set<string>()
  let referenceCount = 0; let bodyBytes = 0; let metadataBytes = limits.metadataEnvelopeOverheadBytes
  async function accept(ref: Expected) {
    referenceCount++
    if (typeof ref.rawRecordId !== 'string' || !ref.rawRecordId) snapshotReject('evidence-unresolved')
    const id = ref.rawRecordId
    const identity = JSON.stringify([ref.sourceId, ref.evidenceHash, ref.sourceUrl])
    if (identities.has(id) && identities.get(id) !== identity) snapshotReject('evidence-invalid')
    let record: RawIntelligenceRecord | undefined
    try { record = archive.getRecord(id) } catch { snapshotReject('evidence-invalid') }
    if (!record || record.rawRecordId !== id || record.processingOwner !== limits.processingOwner || record.sourceId !== ref.sourceId ||
      !calendarSnapshotEvidencePolicy.hashPattern.test(ref.evidenceHash) || record.payloadHash !== ref.evidenceHash ||
      (ref.sourceUrl !== undefined && record.sourceUrl !== ref.sourceUrl) ||
      (ref.parserVersion !== undefined && record.parserVersion !== ref.parserVersion) ||
      (ref.metadata !== undefined && record.payloadMetaJson !== ref.metadata) ||
      !Number.isSafeInteger(record.payloadSizeBytes) || record.payloadSizeBytes! < 0 || record.payloadSizeBytes! > limits.maximumArchiveBytes) snapshotReject('evidence-invalid')
    if (record.payloadRefType !== 'inline' && (record.payloadRefType !== 'file' || record.payloadCodec !== 'plain' || record.payloadFileRef !== `${record.payloadHash}.bin`)) snapshotReject('evidence-invalid')
    if (records.has(id)) {
      if (JSON.stringify(records.get(id)) !== JSON.stringify(record)) snapshotReject('evidence-invalid')
      return
    }
    const encoded = JSON.stringify(record)
    const size = Buffer.byteLength(encoded)
    metadataBytes += size + 1
    if (size > limits.maximumRecordMetadataBytes || metadataBytes > limits.maximumMetadataBytes) snapshotReject('capacity')
    let body: string | undefined
    try { body = archive.readBody(record) } catch { snapshotReject('evidence-invalid') }
    if (typeof body !== 'string' || Buffer.byteLength(body) !== record.payloadSizeBytes || snapshotHash(body) !== ref.evidenceHash ||
      (record.payloadRefType === 'inline' && record.payloadBody !== body)) snapshotReject('evidence-invalid')
    if (!bodies.has(ref.evidenceHash)) {
      bodyBytes += record.payloadSizeBytes!
      if (bodyBytes > limits.maximumArchiveBytes) snapshotReject('capacity')
      bodies.add(ref.evidenceHash)
    }
    await acceptBody(record, body)
    identities.set(id, identity); records.set(id, JSON.parse(encoded) as RawIntelligenceRecord)
  }
  for (const row of pages(database, 'mi_macro_calendar_revisions', 'revision_id', 'revision_id,provider_id,descriptor_id,source_url,raw_record_id,evidence_hash,evidence_refs_json,parser_version')) {
    const top = reference(row)
    let refs: Ref[]
    try {
      if (typeof row.evidence_refs_json !== 'string' || Buffer.byteLength(row.evidence_refs_json) > limits.maximumMetadataBytes) snapshotReject('evidence-invalid')
      const value: unknown = JSON.parse(row.evidence_refs_json as string)
      if (!Array.isArray(value)) snapshotReject('evidence-invalid')
      refs = value.map(ref => parseRef(ref))
    } catch { snapshotReject('evidence-invalid') }
    const official: Official = { ...top, parserVersion: String(row.parser_version), refs: refs! }
    for (const expected of officialReferences(official)) await accept(expected)
  }
  if (hasMarket) for (const row of pages(database, 'mi_macro_calendar_market_event_collections', 'collection_id', 'collection_id,provider_id,descriptor_id,raw_record_id,evidence_hash')) {
    const ref = reference(row)
    const descriptor = getMacroCalendarEvidenceSourceDescriptor(ref.descriptorId)
    if (ref.providerId !== calendarSnapshotEvidencePolicy.canonicalMarketProvider || descriptor?.providerId !== calendarSnapshotEvidencePolicy.archiveMarketProvider) snapshotReject('evidence-invalid')
    await accept({ ...ref, sourceUrl: descriptor.sourceUrl, sourceId: descriptor.descriptorId })
  }
  return { referenceCount, bodyCount: bodies.size, bodyBytes, records: [...records.values()] }
}

function* pages(database: DatabaseSync, table: string, key: string, fields: string): Generator<Row> {
  let after: string | null = null
  while (true) {
    const rows = database.prepare(`select ${fields} from ${table} ${after === null ? '' : `where ${key} > ?`} order by ${key} limit ?`)
      .all(...(after === null ? [] : [after]), calendarSnapshotEvidencePolicy.pageSize)
    if (!rows.length) return
    for (const row of rows) yield row
    const last = rows.at(-1)![key]
    if (typeof last !== 'string' || last === after) snapshotReject('schema-invalid')
    after = last
  }
}
function reference(row: Row): Ref {
  return parseRef({ rawRecordId: row.raw_record_id ?? undefined, providerId: row.provider_id,
    descriptorId: row.descriptor_id, evidenceHash: row.evidence_hash, sourceUrl: row.source_url })
}
function parseRef(value: unknown): Ref {
  if (!value || typeof value !== 'object' || Array.isArray(value)) snapshotReject('evidence-invalid')
  const ref = value as Ref
  if (typeof ref.descriptorId !== 'string' || typeof ref.providerId !== 'string' || typeof ref.evidenceHash !== 'string' ||
    (ref.sourceUrl !== undefined && typeof ref.sourceUrl !== 'string') ||
    (ref.fieldKinds !== undefined && (!Array.isArray(ref.fieldKinds) || ref.fieldKinds.some(kind => typeof kind !== 'string')))) snapshotReject('evidence-invalid')
  return ref
}
function role(ref: Ref, kind: string): boolean { return ref.fieldKinds?.length === 1 && ref.fieldKinds[0] === kind }
function officialReferences(top: Official): Expected[] {
  if (!top.rawRecordId) snapshotReject('evidence-unresolved')
  if (top.descriptorId === bea.descriptorId && top.parserVersion === bea.parserVersion) {
    const rss = top.refs.filter(ref => ref.descriptorId === beaEvidence.rssSourceId)
    const page = top.refs.filter(ref => ref.descriptorId === beaEvidence.pageSourceId)
    if (top.providerId !== bea.providerId || top.refs.length !== 2 || rss.length !== 1 || page.length !== 1 ||
      !role(rss[0]!, 'actual') || !role(page[0]!, 'actual')) snapshotReject('evidence-invalid')
    composite(top, rss[0]!, page[0]!, page[0]!.sourceUrl)
    return top.refs.map(ref => mapped(ref, 'bea'))
  }
  if (top.descriptorId === fed.statementDescriptorId && top.parserVersion === fed.parserVersion) {
    if (top.providerId !== fed.providerId) snapshotReject('evidence-invalid')
    const current = top.refs.filter(ref => ref.descriptorId === fed.statementDescriptorId && role(ref, 'actual'))
    const anchor = current.some(ref => ref.rawRecordId === top.rawRecordId && ref.evidenceHash === top.evidenceHash && ref.sourceUrl === top.sourceUrl)
    if (!anchor) {
      const prior = top.refs.filter(ref => ref.descriptorId === fed.statementDescriptorId && role(ref, 'previous'))
      if (top.refs.length !== 2 || current.length !== 1 || prior.length !== 1) snapshotReject('evidence-invalid')
      composite(top, current[0]!, prior[0]!, current[0]!.sourceUrl)
    }
    return top.refs.map(ref => mapped(ref, 'fed'))
  }
  if (top.descriptorId === bls.descriptorId && top.parserVersion !== bls.parserVersion) snapshotReject('evidence-invalid')
  return [mapped(top), ...top.refs.map(ref => mapped(ref))]
}
function composite(top: Ref, first: Ref, second: Ref, url: string | undefined) {
  if (!first.rawRecordId || !second.rawRecordId) snapshotReject('evidence-unresolved')
  if (first.rawRecordId === second.rawRecordId || top.rawRecordId !== first.rawRecordId || !url || top.sourceUrl !== url ||
    top.evidenceHash !== snapshotHash(`${first.evidenceHash}\n${second.evidenceHash}`)) snapshotReject('evidence-invalid')
}
function mapped(ref: Ref, context?: 'bea' | 'fed'): Expected {
  if (ref.descriptorId === bls.descriptorId) {
    if (ref.providerId !== 'macro-calendar-bls' || ref.sourceUrl !== bls.sourceUrl) snapshotReject('evidence-invalid')
    return { ...ref, sourceId: blsEvidence.sourceId, parserVersion: blsEvidence.parserVersion }
  }
  if (context === 'bea' && [beaEvidence.rssSourceId, beaEvidence.pageSourceId].includes(ref.descriptorId)) {
    if (ref.providerId !== bea.providerId || !ref.sourceUrl || (ref.descriptorId === beaEvidence.rssSourceId && ref.sourceUrl !== beaEvidence.rssUrl)) snapshotReject('evidence-invalid')
    return { ...ref, sourceId: ref.descriptorId, parserVersion: beaEvidence.parserVersion, metadata: beaEvidence.payloadMetadata }
  }
  if (context === 'fed' && ref.descriptorId === fed.statementDescriptorId) {
    if (ref.providerId !== fed.providerId || !ref.sourceUrl || (!role(ref, 'actual') && !role(ref, 'previous'))) snapshotReject('evidence-invalid')
    const current = role(ref, 'actual')
    return { ...ref, sourceId: current ? fedEvidence.currentSourceId : fedEvidence.priorSourceId,
      parserVersion: fedEvidence.parserVersion, metadata: current ? fedEvidence.currentPayloadMetadata : fedEvidence.priorPayloadMetadata }
  }
  const descriptor = getMacroCalendarEvidenceSourceDescriptor(ref.descriptorId)
  if (!descriptor || descriptor.providerId !== ref.providerId || descriptor.sourceUrl !== ref.sourceUrl || descriptor.providerId === calendarSnapshotEvidencePolicy.archiveMarketProvider) snapshotReject('evidence-invalid')
  return { ...ref, sourceId: descriptor.descriptorId }
}
