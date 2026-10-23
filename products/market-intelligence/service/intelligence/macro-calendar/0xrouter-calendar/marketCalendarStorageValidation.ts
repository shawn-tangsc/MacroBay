import { createHash } from 'node:crypto'
import { zeroXRouterCalendarTransportPolicy } from '../../application/zeroXRouterSourcePolicy'
import {
  calendarRecord, zeroXRouterCalendarParserPolicy,
  type ZeroXRouterCalendarDraft
} from './zeroXRouterCalendarContracts'

// Product repository policy, from Accepted design 119/120. Changes require product
// acceptance. No retention deletion, identity promotion or runtime mapping learning.
export const zeroXRouterCalendarStoragePolicy = Object.freeze({
  maximumRows: zeroXRouterCalendarParserPolicy.maximumRows,
  observationBytes: 8 * 1024,
  collectionPageDefault: 20, observationPageDefault: 50, pageMaximum: 100,
  collectionPageBytes: 256 * 1024, observationPageBytes: 1024 * 1024,
  marketBytes: 20 * 1024 ** 3, walBytes: 256 * 1024 ** 2, minimumFreeBytes: 2 * 1024 ** 3,
  deadlineMs: 1000, schemaVersion: 1, cursorKeyBytes: 32, cursorBytes: 8192,
  // Accepted 100% index/page reserve plus per-transaction B-tree roots and WAL frames.
  indexReserveMultiplier: 2, transactionReservePages: 16, walFrameHeaderBytes: 24,
  metadataCharacters: 128, hashPattern: /^[a-f0-9]{64}$/,
  canonicalInstantPattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  descriptorKinds: Object.freeze({
    'macro-calendar-0xrouter-economic-data': 'economic-indicator',
    'macro-calendar-0xrouter-financial-events': 'financial-event',
    'macro-calendar-0xrouter-central-bank-activities': 'central-bank-activity'
  }),
  draftFields: Object.freeze(['providerId', 'descriptorId', 'kind', 'locale', 'sourceEventId', 'marketFactKey',
    'identityState', 'localeMerge', 'officialLink', 'displayName', 'countryCode', 'countryName', 'importance',
    'scheduledDate', 'scheduledAt', 'indicatorId', 'consensus', 'providerPrevious', 'providerActual', 'providerImpact']),
  valueFields: Object.freeze(['consensus', 'providerPrevious', 'providerActual'] as const),
  skipReasons: Object.freeze(['invalid-identity', 'invalid-date', 'invalid-row'] as const),
  caveats: Object.freeze(['identity-unverified', 'locale-merge-disabled', 'official-link-disabled'])
})

/**
 * The business fields whose change is a new observation, in a fixed order.
 *
 * `scheduled_at` carries the provider's publish time, so a rescheduled or newly
 * timetabled release counts as a change. Identity/display-only fields (name, country,
 * importance on its own, caveats) are deliberately absent: rewriting a label must not
 * manufacture an observation the provider never made.
 */
export const marketCalendarObservationStateFields = Object.freeze(
  ['scheduled_at', 'consensus_json', 'provider_previous_json', 'provider_actual_json',
    'provider_impact_json', 'importance'] as const)

export function marketObservationStateKey(row: MarketRow): string {
  return JSON.stringify(marketCalendarObservationStateFields.map((field) => {
    const value = row[field]
    return value === undefined || value === null ? null : String(value)
  }))
}

/**
 * Bytes the shared calendar may still charge for: allocated pages minus the pages
 * SQLite already returned to its freelist.
 *
 * The admission charge used to be `page_count * page_size`, so a deleted row kept
 * occupying quota until the file itself shrank — and with `auto_vacuum = off` it never
 * did, which is how a library that had been trimmed into a smaller logical footprint
 * stayed refused. `freelist_count` is free space already inside the file, so it is no
 * longer charged.
 *
 * Fail-closed direction: anything unreadable, non-integer, negative or internally
 * inconsistent falls back to the full `page_count * page_size`, never to a credit.
 */
export function marketCalendarEffectiveLogicalBytes(reading: { pageSize: unknown; pageCount: unknown; freelistCount: unknown }): number {
  const pageSize = Number(reading.pageSize)
  const pageCount = Number(reading.pageCount)
  const freelistCount = Number(reading.freelistCount)
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0 || !Number.isSafeInteger(pageCount) || pageCount <= 0) return Number.NaN
  const allocated = pageCount * pageSize
  if (!Number.isSafeInteger(freelistCount) || freelistCount < 0 || freelistCount > pageCount) return allocated
  const effective = (pageCount - freelistCount) * pageSize
  return Number.isSafeInteger(effective) ? effective : allocated
}

export type MarketCollectionContext = Readonly<{
  providerId: string; descriptorId: string; locale: string; month: string; detectedAt: string
  evidence: Readonly<{ providerId: string; descriptorId: string; rawRecordId: string; evidenceHash: string }>
}>
export type MarketCapacity = Readonly<{ marketBytes: number; walBytes: number; freeBytes: number; archiveAvailable: boolean }>
export type MarketRow = Record<string, string | number | null>
export type MarketFailureCode = 'invalid-input' | 'collection-conflict' | 'storage-unavailable' |
  'storage-pressure' | 'context-unavailable' | 'invalid-cursor' | 'cancelled' | 'deadline-exceeded' | 'row-too-large'
export class MarketStorageFailure extends Error {
  constructor(readonly failureCode: MarketFailureCode) { super(failureCode) }
}
export function reject(failureCode: MarketFailureCode): never { throw new MarketStorageFailure(failureCode) }
export function exact(record: Record<string, unknown>, fields: readonly string[]): boolean {
  return Object.keys(record).every((key) => fields.includes(key))
}
export function instant(value: unknown): value is string {
  if (typeof value !== 'string' || !zeroXRouterCalendarStoragePolicy.canonicalInstantPattern.test(value)) return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}
// Storage accepts only MC2's canonical strings. Recognize that fixed point without
// allocating trim/replace results or a temporary UTF-8 array for every field.
// Buffer.byteLength matches TextEncoder's replacement encoding of lone surrogates.
const nonCanonicalCalendarWhitespace = /^ | $| {2}|[^\S ]/u
function isCanonicalCalendarText(value: unknown): value is string {
  const policy = zeroXRouterCalendarParserPolicy
  return typeof value === 'string' && value.length > 0 && value.length <= policy.maximumTextCharacters &&
    Buffer.byteLength(value, 'utf8') <= policy.maximumTextBytes && !policy.controlCharacters.test(value) &&
    !nonCanonicalCalendarWhitespace.test(value)
}
function isCanonicalCalendarIdentity(value: unknown): value is string {
  const policy = zeroXRouterCalendarParserPolicy
  return isCanonicalCalendarText(value) && value.length <= policy.maximumIdentityCharacters &&
    policy.identityPattern.test(value) && !value.startsWith('redacted-')
}
export function metadata(value: unknown): value is string {
  return typeof value === 'string' && value.length <= zeroXRouterCalendarStoragePolicy.metadataCharacters &&
    isCanonicalCalendarIdentity(value)
}
export function marketScope(input: Record<string, unknown>) {
  if (input.providerId !== '0xrouter' || typeof input.descriptorId !== 'string' ||
    !Object.hasOwn(zeroXRouterCalendarTransportPolicy.descriptorPaths, input.descriptorId) ||
    !zeroXRouterCalendarTransportPolicy.locales.some((locale) => locale === input.locale) ||
    typeof input.month !== 'string' || !zeroXRouterCalendarTransportPolicy.monthPattern.test(input.month)) reject('invalid-input')
  const start = new Date(`${input.month}-01T00:00:00.000Z`)
  if (!Number.isFinite(start.valueOf())) reject('invalid-input')
  const end = new Date(start)
  end.setUTCMonth(end.getUTCMonth() + 1)
  return { provider_id: input.providerId as string, descriptor_id: input.descriptorId as string,
    locale: input.locale as string, window_start: start.toISOString(), window_end: new Date(end.valueOf() - 1).toISOString() }
}

function normalizedDraft(value: unknown, scope: ReturnType<typeof marketScope>): ZeroXRouterCalendarDraft {
  const draft = calendarRecord(value)
  const policy = zeroXRouterCalendarStoragePolicy
  if (!draft || !exact(draft, policy.draftFields) || draft.providerId !== scope.provider_id ||
    draft.descriptorId !== scope.descriptor_id || draft.locale !== scope.locale ||
    draft.kind !== policy.descriptorKinds[scope.descriptor_id as keyof typeof policy.descriptorKinds] ||
    draft.identityState !== 'unverified' || draft.localeMerge !== 'disabled' || draft.officialLink !== 'disabled' ||
    !instant(draft.scheduledAt) || draft.scheduledDate !== draft.scheduledAt.slice(0, 10) ||
    !isCanonicalCalendarText(draft.displayName) ||
    !Object.values(zeroXRouterCalendarParserPolicy.importance).includes(draft.importance as never) ||
    (draft.countryCode !== undefined && !Object.values(zeroXRouterCalendarParserPolicy.countryCodes).includes(draft.countryCode as never))) reject('invalid-input')
  for (const key of ['countryName', 'indicatorId'] as const) {
    if (draft[key] !== undefined && !(key === 'indicatorId' ? isCanonicalCalendarIdentity(draft[key]) : isCanonicalCalendarText(draft[key]))) reject('invalid-input')
  }
  let identity: unknown
  try { identity = JSON.parse(String(draft.sourceEventId)) } catch { reject('invalid-input') }
  if (!Array.isArray(identity) || identity.length !== 2 || !isCanonicalCalendarIdentity(identity[0]) ||
    typeof identity[1] !== 'number' || !Number.isSafeInteger(identity[1]) || identity[1] <= 0 ||
    JSON.stringify(identity) !== draft.sourceEventId ||
    JSON.stringify(['0xrouter', scope.descriptor_id, scope.locale, draft.sourceEventId]) !== draft.marketFactKey) reject('invalid-input')
  for (const key of policy.valueFields) {
    if (draft[key] === undefined) continue
    const value = calendarRecord(draft[key])
    if (draft.kind !== 'economic-indicator' || !value || !exact(value, ['displayValue']) ||
      !isCanonicalCalendarText(value.displayValue) ||
      zeroXRouterCalendarParserPolicy.placeholders.includes(String(value.displayValue).toLowerCase())) reject('invalid-input')
  }
  if (draft.providerImpact !== undefined) {
    const impact = calendarRecord(draft.providerImpact)
    if (draft.kind !== 'economic-indicator' || !impact || !exact(impact, ['label', 'code']) ||
      !isCanonicalCalendarText(impact.label) ||
      (impact.code !== undefined && !isCanonicalCalendarText(impact.code))) reject('invalid-input')
  }
  if (draft.kind !== 'economic-indicator' && draft.indicatorId !== undefined) reject('invalid-input')
  return draft as ZeroXRouterCalendarDraft
}

const jsonValue = (value: unknown) => value === undefined ? null : JSON.stringify(value)
export function prepareMarketCollection(input: unknown, context: MarketCollectionContext | undefined,
  visit?: (row: MarketRow) => void, observedAt?: string) {
  const batch = calendarRecord(input)
  if (!batch || !exact(batch, ['providerId', 'descriptorId', 'locale', 'month', 'collectionId', 'parserVersion', 'parseResult']) ||
    !metadata(batch.collectionId) || !metadata(batch.parserVersion)) reject('invalid-input')
  const scope = marketScope(batch)
  if (!context || !instant(context.detectedAt)) reject('context-unavailable')
  if (context.providerId !== batch.providerId || context.descriptorId !== batch.descriptorId || context.locale !== batch.locale ||
    context.month !== batch.month || context.evidence.providerId !== batch.providerId || context.evidence.descriptorId !== batch.descriptorId ||
    !metadata(context.evidence.rawRecordId) || !zeroXRouterCalendarStoragePolicy.hashPattern.test(context.evidence.evidenceHash)) reject('invalid-input')
  const parsed = calendarRecord(batch.parseResult)
  const stats = calendarRecord(parsed?.diagnostics)
  const reasons = calendarRecord(stats?.reasons)
  const policy = zeroXRouterCalendarStoragePolicy
  if (parsed?.state !== 'succeeded' || !exact(parsed, ['state', 'drafts', 'diagnostics']) || !Array.isArray(parsed.drafts) ||
    !stats || !exact(stats, ['inputRows', 'skippedRows', 'reasons']) || !reasons || !exact(reasons, policy.skipReasons) ||
    !Number.isSafeInteger(stats.inputRows) || !Number.isSafeInteger(stats.skippedRows) ||
    Number(stats.inputRows) < 0 || Number(stats.inputRows) > policy.maximumRows || Number(stats.skippedRows) < 0 ||
    stats.inputRows !== parsed.drafts.length + Number(stats.skippedRows) ||
    policy.skipReasons.some((key) => !Number.isSafeInteger(reasons[key]) || Number(reasons[key]) < 0) ||
    policy.skipReasons.reduce((sum, key) => sum + Number(reasons[key]), 0) !== stats.skippedRows) reject('invalid-input')
  const collection: MarketRow = { collection_id: batch.collectionId, ...scope, detected_at: context.detectedAt,
    raw_record_id: context.evidence.rawRecordId, evidence_hash: context.evidence.evidenceHash, parser_version: batch.parserVersion,
    input_count: Number(stats.inputRows), skipped_count: Number(stats.skippedRows),
    skip_reasons_json: JSON.stringify(Object.fromEntries(policy.skipReasons.map((key) => [key, reasons[key]]))),
    status: !stats.inputRows ? 'success-empty' : stats.inputRows === stats.skippedRows ? 'all-skipped' : stats.skippedRows ? 'partial' : 'success' }
  const candidates = new Set<string>()
  let observationBytes = 0
  let observationCount = 0
  const observations: MarketRow[] = []
  for (const value of parsed.drafts) {
    const observation = buildObservation(value, scope, batch, candidates, policy)
    const serializedRowBytes = Buffer.byteLength(JSON.stringify(observation))
    if (serializedRowBytes > policy.observationBytes) reject('row-too-large')
    observationBytes += serializedRowBytes
    observationCount++
    // The write model's own bookkeeping column, never provider data: the storage layer
    // records when the row was last observed without rewriting the row on a resample.
    if (observedAt !== undefined) observation.last_seen_at = observedAt
    if (visit) visit(observation)
    else observations.push(observation)
  }
  // Exact bytes of the previous { collection, observations } serialization:
  // empty container + row bytes + commas. Do not retain serialized row strings.
  const serializedBytes = Buffer.byteLength(JSON.stringify({ collection, observations: [] })) +
    observationBytes + Math.max(0, observationCount - 1)
  return { collection, observations, serializedBytes }
}

function buildObservation(value: unknown, scope: ReturnType<typeof marketScope>, batch: Record<string, unknown>,
  candidates: Set<string>, policy: typeof zeroXRouterCalendarStoragePolicy): MarketRow {
  const draft = normalizedDraft(value, scope)
  if (candidates.has(draft.marketFactKey)) reject('invalid-input')
  candidates.add(draft.marketFactKey)
  const business = { event_kind: draft.kind, display_name: draft.displayName, indicator_id: draft.indicatorId ?? null,
    country_code: draft.countryCode ?? null, country_name: draft.countryName ?? null, importance: draft.importance,
    scheduled_date: draft.scheduledDate, scheduled_at: draft.scheduledAt,
    consensus_json: jsonValue(draft.consensus), provider_previous_json: jsonValue(draft.providerPrevious),
    provider_actual_json: jsonValue(draft.providerActual), provider_impact_json: jsonValue(draft.providerImpact ? { label: draft.providerImpact.label, ...(draft.providerImpact.code ? { code: draft.providerImpact.code } : {}) } : undefined), provider_time_status: null }
  const observation: MarketRow = { observation_id: JSON.stringify([batch.collectionId, draft.marketFactKey]), collection_id: batch.collectionId as string,
    provider_id: draft.providerId, descriptor_id: draft.descriptorId, locale: draft.locale, source_event_id: draft.sourceEventId,
    identity_state: draft.identityState, market_fact_key: draft.marketFactKey, ...business,
    business_snapshot_hash: createHash('sha256').update(JSON.stringify(business)).digest('hex'), caveats_json: JSON.stringify(policy.caveats), schema_version: policy.schemaVersion, candidate_key: draft.marketFactKey }
  return observation
}
