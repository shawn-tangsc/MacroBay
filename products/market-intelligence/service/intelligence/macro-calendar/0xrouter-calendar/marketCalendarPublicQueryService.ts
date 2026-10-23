import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { isMarketCalendarEvent, isMarketCalendarPage, isMarketCalendarQuery, marketCalendarPublicPolicy as policy,
  type MarketCalendarEvent, type MarketCalendarPage, type MarketCalendarQuery, type MarketCalendarSource, type MarketCalendarScope, type MarketCalendarRefreshAttempt
} from '../../../../contracts/macro/marketCalendarQueryContracts'
import type { createMarketCalendarEventRepository } from './marketCalendarEventRepository'
import type { MarketRow } from './marketCalendarStorageValidation'

// Ephemeral main-only page positions, not durable identity or a cache of event history.
export const marketCalendarPublicPagingPolicy = Object.freeze({ maximumContexts: 128, contextLifetimeMs: 10 * 60 * 1000,
  /** Batches scanned to find the newest one that stored observations. */
  selectionScanLimit: 20 })
const emptyStatuses = ['success-empty', 'all-skipped']
export type MarketCalendarLinkEvidence = Readonly<{ providerId: string; descriptorId: string; locale: string;
  evidenceHash: string; sourceEventId: string; indicatorId: string | null }>
export type MarketCalendarEvidenceObserver = (event: MarketCalendarEvent, evidence: MarketCalendarLinkEvidence) => void
type Selection = { collectionId: string; evidenceHash: string; source: MarketCalendarSource } | undefined
type Position = { query: Omit<MarketCalendarQuery, 'cursor'>; selections: Selection[]; sources: MarketCalendarSource[]; index: number; storageCursor?: string; created: number; seen: Set<string> }
export function createMarketCalendarPublicQueryService(deps: {
  repository: Pick<ReturnType<typeof createMarketCalendarEventRepository>, 'listCollections' | 'listObservationStates'>
  now?: () => number
  readRefreshAttempt?: (scope: MarketCalendarScope, kind: MarketCalendarSource['eventType']) => MarketCalendarRefreshAttempt | undefined
}) {
  const contexts = new Map<string, Position>()
  const identityKey = randomBytes(32)
  const now = deps.now ?? Date.now
  const unavailable = (): MarketCalendarPage => ({ state: 'unavailable', failureCode: 'query-unavailable' })
  function remember(position: Position): string {
    while (contexts.size >= marketCalendarPublicPagingPolicy.maximumContexts) contexts.delete(contexts.keys().next().value!)
    const key = randomUUID(); contexts.set(key, position); return key
  }
  function event(row: MarketRow): MarketCalendarEvent {
    const hash = createHmac('sha256', identityKey).update(String(row.observation_id)).digest('hex').slice(0, 32)
    const value = (raw: unknown) => raw === null ? null : JSON.parse(String(raw))
    const result = { eventKey: `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}`,
      // `eventKey` above is an HMAC of the stored `observation_id`. `market_fact_key` is stable
      // across batches, so it is the identity a consumer tracking the observation over time
      // must use. `sourceObservedAt` is when the batch that stored this row observed it: a later
      // batch that deduplicated the same value is not this observation's time.
      observationKey: String(row.market_fact_key),
      title: row.display_name, countryCode: row.country_code, ...(row.country_name === null ? {} : { countryName: String(row.country_name) }), eventType: row.event_kind, importance: row.importance,
      scheduledAt: row.scheduled_at, consensus: value(row.consensus_json), providerPrevious: value(row.provider_previous_json),
      providerActual: value(row.provider_actual_json), source: '0xRouter',
      sourceObservedAt: String(row.last_observed_at), coverage: 'observed-unverified' }
    if (!isMarketCalendarEvent(result)) throw new Error('projection-unavailable')
    return result
  }
  return Object.freeze({
    queryMonth(input: unknown, observe?: MarketCalendarEvidenceObserver): MarketCalendarPage {
      if (!isMarketCalendarQuery(input)) return { state: 'unavailable', failureCode: 'input-invalid' }
      try {
        const { month, locale, asOf } = input
        const timestamp = now()
        for (const [key, context] of contexts) if (timestamp - context.created >= marketCalendarPublicPagingPolicy.contextLifetimeMs) contexts.delete(key)
        let position: Position
        if (input.cursor) {
          const context = contexts.get(input.cursor)
          if (!context || context.query.month !== month || context.query.locale !== locale || context.query.asOf !== asOf) return unavailable()
          position = { ...context }
        } else {
          // `selections` picks the newest batch that actually carries observations, because a
          // later empty or all-skipped batch is a statement about the provider's response, not
          // evidence that the events ceased to exist. A batch that stored nothing because every
          // sample was an unchanged resample is the same case: the last stored sample is still
          // this event's current value, and it is the row whose evidence the observer receives.
          const batches = policy.descriptors.map((descriptorId) => {
            const result = deps.repository.listCollections({ providerId: '0xrouter', descriptorId, month, locale, asOf,
              limit: marketCalendarPublicPagingPolicy.selectionScanLimit })
            if (result.state !== 'succeeded') throw new Error('selection-unavailable')
            return result.rows
          })
          const selections = batches.map((rows, index): Selection => {
            const row = rows.find((candidate) => !emptyStatuses.includes(String(candidate.status)))
            return row ? { collectionId: String(row.collection_id), evidenceHash: String(row.evidence_hash), source: { eventType: policy.kinds[index]!,
              status: row.status as MarketCalendarSource['status'], sourceObservedAt: String(row.detected_at) } } : undefined
          })
          const sources = batches.map((rows, index): MarketCalendarSource => {
            const eventType = policy.kinds[index]!
            // The newest batch is what the source status reports, even when it stored nothing.
            const newest = rows[0]
            const attempt = deps.readRefreshAttempt?.({ month, locale }, eventType)
            return { ...(newest ? { eventType, status: newest.status as MarketCalendarSource['status'],
              sourceObservedAt: String(newest.detected_at) } : { eventType, status: 'unavailable' as const, sourceObservedAt: null }),
              ...(attempt && attempt.attemptedAt <= asOf ? { latestAttempt: attempt } : {}) }
          })
          position = { query: { month, locale, asOf }, selections, sources, index: 0, created: timestamp, seen: new Set() }
        }
        const sources = position.sources
        const events: MarketCalendarEvent[] = []
        const envelope = { state: 'available' as const, month, locale, asOf, events, sources }
        // Per descriptor the storage layer answers with current identities, one row each, in
        // pages. A batch that only resampled an unchanged value stored no row of its own, and an
        // empty batch stored nothing at all, so the walk follows the storage cursor until the
        // page's byte budget or event bound is reached. The continuation keeps the same cursor
        // and the same event keys, so a later page never repeats or skips an identity.
        while (position.index < policy.descriptors.length && events.length < policy.maximumEvents) {
          const selected = position.selections[position.index]
          if (!selected || selected.source.status === 'success-empty' || selected.source.status === 'all-skipped') {
            position.index++; position.storageCursor = undefined; continue
          }
          const page = deps.repository.listObservationStates({ providerId: '0xrouter', descriptorId: policy.descriptors[position.index],
            month, locale, asOf, limit: policy.maximumEvents, ...(position.storageCursor ? { cursor: position.storageCursor } : {}) })
          if (page.state !== 'succeeded') return unavailable()
          let full = false
          for (const row of page.rows) {
            const key = String(row.market_fact_key)
            if (position.seen.has(key)) continue
            const projected = event(row)
            if (!projected.scheduledAt.startsWith(month + '-')) continue
            if (events.length >= policy.maximumEvents ||
              Buffer.byteLength(JSON.stringify({ ...envelope, events: [...events, projected], nextCursor: randomUUID() })) > policy.pageBytes) {
              if (!events.length) return unavailable()
              full = true
              break
            }
            position.seen.add(key)
            events.push(projected)
            observe?.(projected, { providerId: String(row.provider_id), descriptorId: String(row.descriptor_id), locale: String(row.locale),
              evidenceHash: String(row.collection_evidence_hash), sourceEventId: String(row.source_event_id),
              indicatorId: row.indicator_id === null ? null : String(row.indicator_id) })
          }
          // A full page ends this request before it consumed the whole storage page. Leave the
          // storage cursor on the page that was only partly read: advancing it would skip every
          // identity after the row that hit the public bound. The next request re-reads that
          // page and `seen` drops the identities already projected, so no identity is lost and
          // none is returned twice.
          if (full) break
          position.storageCursor = page.nextCursor
          if (!page.nextCursor) { position.index++; position.storageCursor = undefined }
        }
        const result = { ...envelope, ...(position.index < policy.descriptors.length ? { nextCursor: remember(position) } : {}) }
        return isMarketCalendarPage(result, input) ? result : unavailable()
      } catch { return unavailable() }
    },
    dispose() { contexts.clear() }
  })
}
