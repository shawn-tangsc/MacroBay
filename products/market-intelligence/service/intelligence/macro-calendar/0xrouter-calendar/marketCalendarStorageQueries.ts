import { createHmac, timingSafeEqual } from 'node:crypto'
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import { calendarRecord } from './zeroXRouterCalendarContracts'
import { exact, instant, marketScope, metadata, reject, MarketStorageFailure,
  zeroXRouterCalendarStoragePolicy as policy, type MarketRow, type MarketFailureCode } from './marketCalendarStorageValidation'
import { marketCalendarRetentionPolicy } from './marketCalendarStorageReclaim'

export type MarketPage = { state: 'succeeded'; rows: MarketRow[]; highWater: string; nextCursor?: string } |
  { state: 'unavailable'; failureCode: MarketFailureCode }
export type MarketOperationControl = { signal?: AbortSignal }
type Operation = 'collections' | 'observations'
type Cursor = { binding: string; highWater: string; last: string[] }
const queryFields = ['providerId', 'descriptorId', 'locale', 'month', 'asOf', 'limit', 'cursor']
const scopePredicate = 'provider_id = ? and descriptor_id = ? and locale = ? and window_start = ? and window_end = ?'
const identityScopePredicate = scopePredicate.split(' and ').map((term) => `c2.${term}`).join(' and ')
const sequencePattern = /^(?:0|[1-9][0-9]*)$/
const maximumSequence = 9223372036854775807n

export function operationGuard(control: MarketOperationControl | undefined, monotonicNow: () => number) {
  const started = monotonicNow()
  return () => {
    if (control?.signal?.aborted) reject('cancelled')
    if (monotonicNow() - started >= policy.deadlineMs) reject('deadline-exceeded')
  }
}

export function createMarketCalendarStorageQueries(database: DatabaseSync, cursorKey: Uint8Array | undefined,
  monotonicNow: () => number) {
  // Key is main-process injected and stable across restarts; no implicit ephemeral
  // key or secret persistence. Missing key fails closed; MC4 owns composition.
  const key = cursorKey ? Buffer.from(cursorKey) : undefined
  function signature(body: string) {
    if (!key || key.byteLength < policy.cursorKeyBytes) reject('context-unavailable')
    return createHmac('sha256', key).update(body).digest('base64url')
  }
  function encode(cursor: Cursor) {
    const body = Buffer.from(JSON.stringify(cursor)).toString('base64url')
    return `${body}.${signature(body)}`
  }
  function decode(input: unknown, binding: string, operation: Operation): Cursor {
    if (typeof input !== 'string' || input.length > policy.cursorBytes) reject('invalid-cursor')
    const pieces = input.split('.')
    if (pieces.length !== 2) reject('invalid-cursor')
    const [body, mac] = pieces as [string, string]
    const expected = Buffer.from(signature(body))
    const supplied = Buffer.from(mac)
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) reject('invalid-cursor')
    let value: Record<string, unknown> | undefined
    try { value = calendarRecord(JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))) } catch { reject('invalid-cursor') }
    if (!value || !exact(value, ['binding', 'highWater', 'last']) || value.binding !== binding ||
      typeof value.highWater !== 'string' || !sequencePattern.test(value.highWater) ||
      BigInt(value.highWater) > maximumSequence || !Array.isArray(value.last) ||
      value.last.length !== (operation === 'collections' ? 2 : 1) || value.last.some((item) => typeof item !== 'string') ||
      (operation === 'collections' && (!instant(value.last[0]) || !metadata(value.last[1])))) reject('invalid-cursor')
    return value as Cursor
  }
  function read(sql: string, parameters: SQLInputValue[]) {
    const statement = database.prepare(sql)
    statement.setReadBigInts(true)
    return statement.all(...parameters).map((row): MarketRow => Object.fromEntries(Object.entries(row).map(([name, value]) =>
      [name, typeof value === 'bigint' ? name === 'collection_sequence' ? String(value) : Number(value) : value])) as MarketRow)
  }
  function list(operation: Operation, input: unknown, control?: MarketOperationControl, latest = false): MarketPage {
    let transaction = false
    try {
      const check = operationGuard(control, monotonicNow)
      check()
      const query = calendarRecord(input)
      // A latest-state read is scoped by provider/descriptor/locale/month/asOf; only the
      // collection-scoped read names one batch.
      const required = operation === 'collections' || latest ? queryFields : [...queryFields, 'collectionId']
      const optional = operation === 'observations' && latest ? ['collectionId'] : []
      if (!query || !exact(query, required) || Object.keys(query).some((key) => !required.includes(key) && !optional.includes(key)) ||
        !instant(query.asOf) || (!latest && operation === 'observations' && !metadata(query.collectionId))) reject('invalid-input')
      const scope = marketScope(query)
      const parameters = Object.values(scope)
      const limit = query.limit ?? (operation === 'collections' ? policy.collectionPageDefault : policy.observationPageDefault)
      if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit <= 0 || limit > policy.pageMaximum) reject('invalid-input')
      if (!key || key.byteLength < policy.cursorKeyBytes) reject('context-unavailable')
      const binding = JSON.stringify([operation, ...parameters, query.month, query.asOf, latest ? 'latest' : query.collectionId ?? null,
        query.contentOnly === true])
      const cursor = query.cursor === undefined ? undefined : decode(query.cursor, binding, operation)
      database.exec('begin')
      transaction = true
      check()
      const highWater = cursor?.highWater ?? String(read(`select collection_sequence from mi_macro_calendar_market_event_collections
        where ${scopePredicate} order by collection_sequence desc limit 1`, parameters)[0]?.collection_sequence ?? '0')
      let rows: MarketRow[]
      if (operation === 'collections') {
        rows = read(`select * from mi_macro_calendar_market_event_collections where ${scopePredicate}
          and detected_at <= ? and collection_sequence <= ?
          ${cursor ? 'and (detected_at, collection_id) < (?, ?)' : ''}
          order by detected_at desc, collection_id desc limit ?`,
        [...parameters, query.asOf as string, BigInt(highWater), ...(cursor?.last ?? []), limit + 1])
      } else if (latest) {
        // One row per event identity, taken from the collection that last *stored* a row for
        // it, not from the newest batch: a batch that only resampled an unchanged value stores
        // no row of its own, and one that returned nothing at all is a statement about the
        // provider's response rather than evidence that the events ceased to exist.
        //
        // Identity is the page key. The subquery walks the visible rows by `candidate_key`
        // (the identity index direction) and reduces each identity to its greatest
        // `collection_sequence` in this scope/asOf/high-water snapshot; the join then reads
        // exactly that row. Every identity therefore contributes one row and the order is
        // `candidate_key`, so a `candidate_key > cursor` walk partitions the identities: the
        // union of `limit=N` pages equals one large-`limit` read, with no identity returned
        // twice or skipped. A previous formulation sampled `limit*2+1` rows newest-collection-
        // first and advanced the cursor to the largest key in that sample, which permanently
        // excluded identities whose newest row lived in an older collection.
        rows = read(`select o.*, c.detected_at as last_observed_at, c.evidence_hash as collection_evidence_hash
          from (select o2.candidate_key as candidate_key, max(c2.collection_sequence) as collection_sequence
            from mi_macro_calendar_market_event_observations as o2 indexed by ${marketCalendarRetentionPolicy.identityScanIndex}
            join mi_macro_calendar_market_event_collections as c2 on c2.collection_id = o2.collection_id
            where ${identityScopePredicate} and c2.detected_at <= ? and c2.collection_sequence <= ?
              ${cursor ? 'and o2.candidate_key collate binary > ?' : ''}
            group by o2.candidate_key
            order by o2.candidate_key collate binary asc limit ?) as current
          join mi_macro_calendar_market_event_observations as o on o.candidate_key = current.candidate_key
          join mi_macro_calendar_market_event_collections as c on c.collection_id = o.collection_id
            and c.collection_sequence = current.collection_sequence
          order by current.candidate_key collate binary asc limit ?`,
        [...parameters, query.asOf as string, BigInt(highWater), ...(cursor?.last ?? []), limit + 1, limit + 1])
      } else {
        const parent = read(`select collection_id from mi_macro_calendar_market_event_collections where collection_id = ?
          and ${scopePredicate} and detected_at <= ? and collection_sequence <= ? limit 1`,
        [query.collectionId as string, ...parameters, query.asOf as string, BigInt(highWater)])
        if (!parent.length) reject('invalid-input')
        rows = read(`select * from mi_macro_calendar_market_event_observations where collection_id = ?
          ${cursor ? 'and candidate_key collate binary > ?' : ''} order by candidate_key collate binary limit ?`,
        [query.collectionId as string, ...(cursor?.last ?? []), limit + 1])
      }
      check()
      const budget = operation === 'collections' ? policy.collectionPageBytes : policy.observationPageBytes
      const result: MarketRow[] = []
      let nextCursor: string | undefined
      for (const row of rows.slice(0, limit)) {
        const last = operation === 'collections' ? [String(row.detected_at), String(row.collection_id)] : [String(row.candidate_key)]
        const prospectiveCursor = encode({ binding, highWater, last })
        const bytes = Buffer.byteLength(JSON.stringify({ state: 'succeeded', rows: [...result, row], highWater, nextCursor: prospectiveCursor }))
        if (bytes > budget) {
          if (!result.length) reject('row-too-large')
          break
        }
        result.push(row)
        nextCursor = prospectiveCursor
      }
      if (result.length === rows.length) nextCursor = undefined
      check()
      database.exec('commit')
      transaction = false
      check()
      return { state: 'succeeded', rows: result, highWater, ...(nextCursor ? { nextCursor } : {}) }
    } catch (error) {
      if (transaction) database.exec('rollback')
      return { state: 'unavailable', failureCode: error instanceof MarketStorageFailure ? error.failureCode : 'storage-unavailable' }
    }
  }
  return {
    listCollections: (input: unknown, control?: MarketOperationControl) => list('collections', input, control),
    listObservations: (input: unknown, control?: MarketOperationControl) => list('observations', input, control),
    /** The current sample of every event in scope, whichever stored batch first saw that value. */
    listObservationStates: (input: unknown, control?: MarketOperationControl) => list('observations', input, control, true)
  }
}
