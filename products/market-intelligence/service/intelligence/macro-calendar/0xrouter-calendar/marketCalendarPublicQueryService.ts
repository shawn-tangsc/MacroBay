import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { isMarketCalendarEvent, isMarketCalendarPage, isMarketCalendarQuery, marketCalendarPublicPolicy as policy,
  type MarketCalendarEvent, type MarketCalendarPage, type MarketCalendarQuery, type MarketCalendarSource, type MarketCalendarScope, type MarketCalendarRefreshAttempt
} from '../../../../contracts/macro/marketCalendarQueryContracts'
import { marketCalendarSourceStatus } from './marketCalendarSourceStatus'
import type { createMarketCalendarEventRepository } from './marketCalendarEventRepository'
import type { MarketRow } from './marketCalendarStorageValidation'
import { preferredObservation, type MarketObservationCandidate } from './marketCalendarObservationPrecedence'
import { marketCalendarDisplayTitle } from '../marketCalendarDisplayNames'
import { marketCalendarCountryNames } from '../marketCalendarDisplayNameTables'
import { eventPairVerdict } from '../marketCalendarEventPairing'
import { narwhalCanonicalIdentityKey, toAlpha3Country, zeroXRouterCanonicalIdentity,
  type MarketCalendarCanonicalIdentity } from '../marketCalendarMetricIdentity'

// Ephemeral main-only page positions, not durable identity or a cache of event history.
export const marketCalendarPublicPagingPolicy = Object.freeze({ maximumContexts: 128, contextLifetimeMs: 10 * 60 * 1000,
  /** Batches scanned to find the newest one that stored observations. */
  selectionScanLimit: 20 })
/**
 * 市场日历现在只有一个采集来源：Narwhal 的 `economics/calendar`。
 *
 * 写入端与读取端必须用同一个 provider id——此前写入落 `release_rows`、读取按 `0xrouter`
 * 取 `market_event_observations`，两边都正确却永远对不上，读者看到的就是「一条都没有」。
 */
export const marketCalendarProviderId = 'narwhal'
/** 切换前的来源。它的行留在库里：读者看到的空月里，历史仍按这一类事件回落读出。 */
export const marketCalendarLegacyProviderId = '0xrouter'
/** 读者可见的来源名。与 provider id 分开：一个是存储键，一个是界面上的词。 */
export const marketCalendarSourceName = 'Narwhal'
const emptyStatuses = ['success-empty', 'all-skipped']
export type MarketCalendarLinkEvidence = Readonly<{ providerId: string; descriptorId: string; locale: string;
  evidenceHash: string; sourceEventId: string; indicatorId: string | null }>
export type MarketCalendarEvidenceObserver = (event: MarketCalendarEvent, evidence: MarketCalendarLinkEvidence) => void
type Selection = { collectionId: string; evidenceHash: string; providerId: string; descriptorId: string
  source: MarketCalendarSource } | undefined
type Pair = { selection: Selection }
type Position = { query: Omit<MarketCalendarQuery, 'cursor'>; pairs: Pair[]; sources: MarketCalendarSource[]; index: number; storageCursor?: string; created: number;
  /** 这一页已经占住的身份（`country|metric_key` → 发布日），旧源按 ±1 天比对后让位。 */
  covered: Map<string, string[]>;
  /** 算不出身份、因而不进日历的 Narwhal 行数（行仍在库里，可查）。 */
  unmappedNarwhal: number;
  /** 事件型 Narwhal 的时刻，按 `国家|类型` 归组：旧源的讲话按 60 分钟窗口让位。 */
  eventInstants: Map<string, string[]>;
  /** 旧源「只有日期没有时刻」的行，按 `国家|类型|日` 计数：只有唯一候选才允许配对。 */
  dateLevelCounts: Map<string, number>;
  /**
   * 事件型配对计数。**放在一个对象里**：翻页时 `position` 是浅拷贝，数字会被按值复制走，
   * 只有对象引用能跨页累加——否则最后一页永远只报最后一页的数。
   */
  tally: { paired: number; ambiguous: number; rows: number };
  /** 已经投影出去的事件按身份归位：同一身份再来一行时按优先级替换，而不是按顺序留第一行。 */
  chosen: Map<string, { index: number; candidate: MarketObservationCandidate; collectionId: string; observationId: string }> }
/**
 * 这一行要不要进日历。
 *
 * - Narwhal 的行：**算不出 `(国家, 指标, 期间)` 就不进**（行仍在库里、可查，映射补齐后自然出现）。
 *   算得出就记下它占住的 (国家|指标 → 发布日)，供旧源让位。
 * - 旧源的行：同一 (国家, 指标)、发布日相差 ≤1 天时让位——**配对只在这一步用时间窗，身份
 *   仍是 (国家, 指标, 期间)**。没有指标身份的讲话/会议行原样保留。
 */
function rowsShowsThisRow(position: { covered: Map<string, string[]>
  unmappedNarwhal: number; eventInstants: Map<string, string[]>; dateLevelCounts: Map<string, number>
  tally: { paired: number; ambiguous: number; rows: number } },
  row: Record<string, unknown>): boolean {
  const scheduledAt = String(row.scheduled_at)
  const day = scheduledAt.slice(0, 10)
  if (String(row.provider_id) === marketCalendarProviderId) {
    const identityKey = narwhalCanonicalIdentityKey(String(row.candidate_key))
    if (!identityKey) { position.unmappedNarwhal += 1; return false }
    const [countryCode, metricKey] = identityKey.split('|') as [string, string]
    if (eventKinds.includes(metricKey)) {
      // 事件型：时刻记进窗口表，旧源的讲话/金融事件按 60 分钟（或日期级唯一候选）让位。
      const bucket = `${countryCode}|${metricKey}`
      const instants = position.eventInstants.get(bucket)
      if (instants === undefined) position.eventInstants.set(bucket, [scheduledAt])
      else instants.push(scheduledAt)
      position.tally.rows += 1
      return true
    }
    const bucket = `${countryCode}|${metricKey}`
    const dates = position.covered.get(bucket)
    if (dates === undefined) position.covered.set(bucket, [day])
    else if (!dates.includes(day)) dates.push(day)
    return true
  }
  const countryCode = row.country_code === null ? '' : toAlpha3Country(String(row.country_code))
  const identity = zeroXRouterCanonicalIdentity({
    countryCode: row.country_code === null ? null : countryCode,
    indicatorId: row.indicator_id === null ? null : String(row.indicator_id),
    scheduledAt
  })
  if (identity !== undefined) return !coveredWithinADay(position.covered, identity, day)
  // 没有指标身份的行：讲话、金融事件。同国家 + 同类型 + 时刻差 ≤ 60 分钟算同一件事；
  // 旧源只有日期时放宽到同一 UTC 日，但只在**当天该国家该类型只有一条候选**时才配。
  const kind = String(row.event_kind)
  if (!eventKinds.includes(kind)) return true
  const instants = position.eventInstants.get(`${countryCode}|${kind}`) ?? []
  if (instants.length === 0) return true
  const verdict = eventPairVerdict({ scheduledAt, narwhalInstants: instants,
    dateLevelCandidateCount: position.dateLevelCounts.get(`${countryCode}|${kind}|${day}`) ?? 0 })
  if (verdict === 'covered-by-narwhal') { position.tally.paired += 1; return false }
  if (verdict === 'ambiguous-day') position.tally.ambiguous += 1
  return true
}

/** 同国家 + 同指标，发布日相差 ≤1 天即视为同一件事已由新源覆盖。 */
function coveredWithinADay(covered: ReadonlyMap<string, readonly string[]>,
  identity: MarketCalendarCanonicalIdentity, day: string): boolean {
  const dates = covered.get(`${identity.countryCode}|${identity.metricKey}`)
  if (dates === undefined) return false
  const at = Date.parse(`${day}T00:00:00.000Z`)
  return dates.some((date) => Math.abs(Date.parse(`${date}T00:00:00.000Z`) - at) <= 86_400_000)
}

/** 有国家码没有国家名时，按码补一个本地化名字；码不认识就不补（不猜、不造）。 */
function resolvedCountryName(code: unknown, locale: unknown): string | undefined {
  if (typeof code !== 'string') return undefined
  const names = marketCalendarCountryNames[code]
  return names === undefined ? undefined : (locale === 'en' ? names.en : names.zh)
}

/** 完整国名：英文 `United States`、中文「美国」。给 `title` / `aria-label`，与显示值同一张表。 */
function countryNameFull(code: string | null): string | undefined {
  if (code === null) return undefined
  const names = marketCalendarCountryNames[code === 'EMU' ? 'EU' : code]
  return names === undefined ? undefined : names.enFull
}

/** 事件类型：这两个的配对走「同类型 + 时刻窗」，不走指标身份。 */
const eventKinds: readonly string[] = ['central-bank-activity', 'financial-event']

/**
 * 旧源「只有日期没有时刻」的行按 (国家|类型|日) 计数。
 *
 * 为什么要预扫：日期级的放宽只在**该日该国家该类型只有一条候选**时才允许配对，而走查是
 * 流式的——不先数一遍，读到第一条时根本不知道当天还有没有别的候选。
 */
function countDateLevelOldRows(batchesByKind: readonly (readonly { descriptorId: string
  providerId: string; rows: readonly Record<string, unknown>[] }[])[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const candidates of batchesByKind) {
    for (const candidate of candidates) {
      if (candidate.providerId === marketCalendarProviderId) continue
      for (const row of candidate.rows) {
        if (!eventKinds.includes(String(row.event_kind))) continue
        if (!String(row.scheduled_at).endsWith('T00:00:00.000Z')) continue
        const key = `${toAlpha3Country(String(row.country_code ?? ''))}|${String(row.event_kind)}|${String(row.scheduled_at).slice(0, 10)}`
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }
  }
  return counts
}

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
  function candidateOf(row: MarketRow): MarketObservationCandidate {
    return { eventIdentity: String(row.market_fact_key), hasActual: row.provider_actual_json !== null,
      visibleAt: String(row.last_observed_at), stableKey: String(row.observation_id) }
  }
  function event(row: MarketRow): MarketCalendarEvent {
    const hash = createHmac('sha256', identityKey).update(String(row.observation_id)).digest('hex').slice(0, 32)
    const value = (raw: unknown) => raw === null ? null : JSON.parse(String(raw))
    // 身份只搬运、不重算：写入端把它定死在 `candidate_key` 里，这里读出来原样带出去。
    const storedIdentity = String(row.provider_id) === marketCalendarProviderId
      ? narwhalCanonicalIdentityKey(String(row.candidate_key)) : undefined
    const metricKey = storedIdentity === undefined ? undefined : storedIdentity.split('|')[1]
    const eventNameKey = metricKey !== undefined && !eventKinds.includes(metricKey) ? metricKey : undefined
    const measureKeys = row.measure_keys_json === null || row.measure_keys_json === undefined
      ? undefined : JSON.parse(String(row.measure_keys_json)) as readonly string[]
    // 展示名是**纯展示**：指标名表 → 源类型名表 → 源原文，都不参与身份与标注资格。
    const title = marketCalendarDisplayTitle({ rawTitle: String(row.display_name),
      eventNameKey, ...(measureKeys === undefined ? {} : { measureKeys }), locale: row.locale === 'en' ? 'en' : 'zh' })
    const result = { eventKey: `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}`,
      // `eventKey` above is an HMAC of the stored `observation_id`. `market_fact_key` is stable
      // across batches, so it is the identity a consumer tracking the observation over time
      // must use. `sourceObservedAt` is when the batch that stored this row observed it: a later
      // batch that deduplicated the same value is not this observation's time.
      observationKey: String(row.market_fact_key),
      title, countryCode: row.country_code,
      // 有码没名就按码补本地化名字（新源只给码）；没码就不显示，不猜。
      ...(row.country_name !== null ? { countryName: String(row.country_name) }
        : resolvedCountryName(row.country_code, row.locale) === undefined ? {}
          : { countryName: resolvedCountryName(row.country_code, row.locale)! }),
      // 完整国名（给读屏/悬停）：与显示值同一份数据表，**没有国家时不带这个键**。
      ...(countryNameFull(row.country_code === null ? null : String(row.country_code)) === undefined ? {}
        : { countryNameFull: countryNameFull(row.country_code === null ? null : String(row.country_code))! }),
      eventType: row.event_kind, importance: row.importance,
      scheduledAt: row.scheduled_at, consensus: value(row.consensus_json), providerPrevious: value(row.provider_previous_json),
      providerActual: value(row.provider_actual_json), source: row.provider_id === marketCalendarLegacyProviderId ? '0xRouter' : marketCalendarSourceName,
      sourceObservedAt: String(row.last_observed_at), coverage: 'observed-unverified',
      ...(eventNameKey === undefined ? {} : { eventNameKey }),
      ...(measureKeys === undefined ? {} : { measureKeys }) }
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
          // 每一类事件先问 Narwhal，它在这个月这一类里**一行都没有**时才回落到旧来源的库。
          // 这是「以 Narwhal 为主」在读取侧的落点：不是把两源的行合并去重（那需要一张跨源
          // 指标身份映射，代码里还没有），而是同一类事件只认一个来源——同一身份因此不可能
          // 出现两行，条数也不会被重复计一次。
          const batchesByKind = policy.kinds.map((_, index) => [
            { providerId: marketCalendarProviderId, descriptorId: policy.feedByKind[index]! },
            { providerId: marketCalendarLegacyProviderId, descriptorId: policy.collectionFeeds[index]! }
          ].map((candidate) => {
            const result = deps.repository.listCollections({ ...candidate, month, locale, asOf,
              limit: marketCalendarPublicPagingPolicy.selectionScanLimit })
            if (result.state !== 'succeeded') throw new Error('selection-unavailable')
            return { ...candidate, rows: result.rows }
          }))
          // 每一类都把**两源的集合**都放进走查队列：Narwhal 在前，旧源在后。同一身份被
          // Narwhal 占住的旧行，在走过它时直接让位（规则见 `coversIdentity`）。
          const selections = batchesByKind.map((candidates, index): readonly Selection[] => {
            const found: Selection[] = []
            for (const candidate of candidates) {
              const row = candidate.rows.find((item) => !emptyStatuses.includes(String(item.status)))
              if (!row) continue
              found.push({ collectionId: String(row.collection_id), evidenceHash: String(row.evidence_hash),
                providerId: candidate.providerId, descriptorId: candidate.descriptorId,
                source: { eventType: policy.kinds[index]!, status: row.status as MarketCalendarSource['status'],
                  sourceObservedAt: String(row.detected_at) } })
            }
            return found
          })
          const sources = batchesByKind.map((candidates, index): MarketCalendarSource => {
            const eventType = policy.kinds[index]!
            // 状态跟着这个月真正被采用的那个来源走：有内容的那个，其次是有批次记录的那个。
            const reporting = candidates.find((candidate) => candidate.rows.some((item) => !emptyStatuses.includes(String(item.status)))) ??
              candidates.find((candidate) => candidate.rows.length > 0)
            const newest = reporting?.rows[0]
            const attempt = deps.readRefreshAttempt?.({ month, locale }, eventType)
            // 「这条来源不发布这种语言」与「这个月没有事件」分开说：前者是来源能力，后者是确实没有。
            return { ...(newest && reporting ? { eventType,
              status: marketCalendarSourceStatus(String(newest.status), reporting.descriptorId, locale),
              sourceObservedAt: String(newest.detected_at) } : { eventType, status: 'unavailable' as const, sourceObservedAt: null }),
              ...(attempt && attempt.attemptedAt <= asOf ? { latestAttempt: attempt } : {}) }
          })
          const pairs: Pair[] = selections.flatMap((found) => found.map((selection) => ({ selection })))
          position = { query: { month, locale, asOf }, pairs, sources, index: 0, created: timestamp, chosen: new Map(),
            covered: new Map(), unmappedNarwhal: 0, eventInstants: new Map(),
            dateLevelCounts: countDateLevelOldRows(batchesByKind), tally: { paired: 0, ambiguous: 0, rows: 0 } }
        }
        const sources = position.sources
        const events: MarketCalendarEvent[] = []
        const envelope = { state: 'available' as const, month, locale, asOf, events, sources }
        // Per descriptor the storage layer answers with current identities, one row each, in
        // pages. A batch that only resampled an unchanged value stored no row of its own, and an
        // empty batch stored nothing at all, so the walk follows the storage cursor until the
        // page's byte budget or event bound is reached. The continuation keeps the same cursor
        // and the same event keys, so a later page never repeats or skips an identity.
        let duplicatesInBatch = 0
        while (position.index < position.pairs.length && events.length < policy.maximumEvents) {
          const selected = position.pairs[position.index]?.selection
          if (!selected || selected.source.status === 'success-empty' || selected.source.status === 'all-skipped') {
            position.index++; position.storageCursor = undefined; continue
          }
          const page = deps.repository.listObservationStates({ providerId: selected.providerId, descriptorId: selected.descriptorId,
            month, locale, asOf, limit: policy.maximumEvents, ...(position.storageCursor ? { cursor: position.storageCursor } : {}) })
          if (page.state !== 'succeeded') return unavailable()
          let full = false
          for (const row of page.rows) {
            if (!rowsShowsThisRow(position, row)) continue
            const key = String(row.market_fact_key)
            const candidate = candidateOf(row)
            const seated = position.chosen.get(key)
            if (seated !== undefined) {
              // 同一身份的第二行：按 §3 的四级优先级换人，不按查询顺序留第一行。换掉的是整行，
              // 绝不把两行的字段拼成一条。
              //
              // 多行本身是设计：观测表 append-only，每次采集一行，当前状态读按批次取。只有
              // **同一批次内**同一身份出现两行才是异常（那正是唯一索引要防的），所以这里只计数，
              // 由本次请求末尾聚合成一行；逐身份打日志等于每次读取都在报「一切正常」。
              const projected = event(row)
              if (!projected.scheduledAt.startsWith(month + '-')) continue
              // 续读会重新扫到同一行：同一 observation 不是重复，只有同一批次里**另一行**才是。
              if (String(row.collection_id) === seated.collectionId &&
                String(row.observation_id) !== seated.observationId) duplicatesInBatch += 1
              if (preferredObservation(seated.candidate, candidate)) {
                events[seated.index] = projected
                seated.candidate = candidate
              }
              continue
            }
            const projected = event(row)
            if (!projected.scheduledAt.startsWith(month + '-')) continue
            if (events.length >= policy.maximumEvents ||
              Buffer.byteLength(JSON.stringify({ ...envelope, events: [...events, projected], nextCursor: randomUUID() })) > policy.pageBytes) {
              if (!events.length) return unavailable()
              full = true
              break
            }
            position.chosen.set(key, { index: events.length, candidate, collectionId: String(row.collection_id),
              observationId: String(row.observation_id) })
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
        // 一次请求最多一行，而且只在真异常时：同一批次里同一身份出现了两行。
        if (duplicatesInBatch > 0) {
          console.warn(`[macro-calendar] 同一批次内同一身份出现多行：${duplicatesInBatch} 处，读取按优先级取一行`)
        }
        const finished = position.index >= position.pairs.length
        if (finished && position.tally.rows > 0) {
          const { rows, paired, ambiguous } = position.tally
          console.warn(`[macro-calendar] 事件型配对：新源 ${rows} 条，配上 ${paired} 条、`
            + `新源独有 ${rows - paired} 条、因多候选放弃 ${ambiguous} 条`)
        }
        if (!input.cursor && position.unmappedNarwhal > 0) {
          // 可查的数：这些行**在库里**、只是算不出身份进不了日历；映射补齐后它们自动出现。
          console.warn(`[macro-calendar] ${position.unmappedNarwhal} 条 Narwhal 发布算不出 (国家, 指标, 期间)，本月不进日历`)
        }
        const result = { ...envelope, ...(position.index < position.pairs.length ? { nextCursor: remember(position) } : {}) }
        return isMarketCalendarPage(result, input) ? result : unavailable()
      } catch { return unavailable() }
    },
    dispose() { contexts.clear() }
  })
}
