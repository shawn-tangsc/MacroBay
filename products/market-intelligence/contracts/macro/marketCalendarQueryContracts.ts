// Product-owned public boundary for design 122. No storage/provider-native identities.
export const marketCalendarPublicPolicy = Object.freeze({
  /**
   * 覆盖口径的**闭集**：只有这两档，一处定义。
   * 加一档 = 改这里 + 补齐所有消费侧的显式分支；`coverageClosedSet.test.ts` 会盯着
   * 「档位与消费点是否同步」，避免新档位在抽屉里悄悄变成「整行不收」。
   */
  coverage: ['available', 'observed-unverified'] as const,
  maximumEvents: 100, pageBytes: 256 * 1024, eventBytes: 8 * 1024, textCharacters: 512, textBytes: 1024,
  /** Bound on the stable observation identity a projection may carry. */
  maximumObservationKeyChars: 256,
  monthPattern: /^\d{4}-(?:0[1-9]|1[0-2])$/,
  instantPattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  opaquePattern: /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,
  kinds: ['economic-indicator', 'financial-event', 'central-bank-activity'],
  importance: ['high', 'medium', 'low'],
  /** 发布状态闭集（六值）：**唯一定义在这里**，别处只许引用，不许再写一遍字面量。 */
  releaseStatuses: ['scheduled', 'published', 'cancelled', 'unknown', 'backfilling', 'missing'], countryCodePattern: /^[A-Z]{2,3}$/, forbiddenCountryCodes: ['ZZ'],
  /**
   * `no-locale-rows`：这条来源**根本不发布该语言**（今天：`financial-events` /
   * `central-bank-activities` 的 en 请求永远返回空数组）。它与 `success-empty`
   * （这个月确实没有事件）是两件事，不能合成一句——前者去换语言或换来源，后者就是没有。
   */
  statuses: ['success', 'success-empty', 'all-skipped', 'partial', 'unavailable', 'no-locale-rows'],
  /** Batch-level verdicts. `storage-pressure` is a refused write (the shared calendar is full),
   *  not a transport failure, so a reader can tell "wait" from "storage is down". */
  refreshFailures: ['input-invalid', 'disabled', 'credential-not-configured', 'readiness-unavailable', 'busy', 'storage-unavailable', 'storage-pressure'],
  /** The verdicts and origins one individual source attempt may carry. */
  attemptFailures: ['input-invalid', 'credential-not-configured', 'response-unavailable',
    'archive-unavailable', 'parse-unavailable', 'storage-unavailable', 'storage-pressure'],
  attemptTriggers: ['manual', 'automatic'],
  /**
   * 事件类型 → 该类型事件的来源身份，**按位置与 `kinds` 对齐**。
   *
   * 位置必须是三个：读回时靠它把每一行观测反查回它的事件类型（经济指标 / 财经事件 /
   * 央行活动），压成一条会让另两类事件反查不到源。三条都指向同一次采集产出的那三类身份，
   * 所以它是「映射」，不是「采集清单」——采集清单见 `collectionFeeds`。
   */
  feedByKind: ['macro-calendar-narwhal-economic-data', 'macro-calendar-narwhal-financial-events',
    'macro-calendar-narwhal-central-bank-activities'],
  /**
   * 真正被采集、被调用方清单列出的来源：**一条**。
   *
   * 一次 `economics/calendar` 调用返回全部 releases，三类事件由我们按 series 自己分；
   * 另两条 feed 带 `coveredBy` 指向它。调用方（简报补跑、按需刷新）只列这一条，列三条就是
   * 同一个端点请求三次。
   */
  collectionFeeds: ['macro-calendar-narwhal-economic-data'],
  /**
   * 一条事件可以来自哪些**源 feed**。`source` 原来只有 `'Narwhal' | '0xRouter'` 两档，
   * 表达不了「官方 BLS 发的」，于是官方行被标成旧源。现在以 feed id 为真值，
   * 两个旧值保留只为兼容还没迁移的旧行，**新写入不许再用旧值**。
   */
  sourceFeeds: [
    'macro-calendar-narwhal-economic-data', 'macro-calendar-narwhal-financial-events',
    'macro-calendar-narwhal-central-bank-activities',
    // 0xRouter 三路 2026-11-16 接回采集后进标准表：它们**也是真来源**，读侧必须能指名道姓，
    // 否则新进来的每一行都落 `unspecified`（界面把来源画成「未知」）。
    'macro-calendar-0xrouter-economic-data', 'macro-calendar-0xrouter-financial-events',
    'macro-calendar-0xrouter-central-bank-activities',
    'macro-calendar-bls', 'macro-calendar-bea',
    'macro-calendar-fed'
  ],
  /**
   * 来源认不出时的值。**不许退回旧源**（`0xRouter` 删掉之后那会是个不存在的来源），
   * 也不许把这条发布藏起来——「不知道来源」不等于「没有这次发布」。
   */
  unspecifiedSource: 'unspecified',
  /**
   * 0xRouter 的三个事件身份：**只描述旧来源自己能采什么**（它的采集器、它的尝试台账、
   * 以及按需补跑时能点名的那三个端点）。它不是当前读取来源，也不是按事件类型的映射表
   * ——映射表是 `feedByKind`，采集清单是 `collectionFeeds`。
   */
  descriptors: ['macro-calendar-0xrouter-economic-data', 'macro-calendar-0xrouter-financial-events',
    'macro-calendar-0xrouter-central-bank-activities'],
  /** Bounded catch-up for the daily briefing: one collection, one shared deadline. */
  refreshNow: { defaultTimeoutMs: 90_000, minimumTimeoutMs: 1_000, maximumTimeoutMs: 120_000 },
  methods: { refresh: 'intelligence.macro.marketCalendar.refreshManual', query: 'intelligence.macro.marketCalendar.queryMonth',
    getCollectionFreshness: 'intelligence.macro.marketCalendar.getCollectionFreshness',
    refreshNow: 'intelligence.macro.marketCalendar.refreshNow' }
} as const)
export type MarketCalendarScope = Readonly<{ month: string; locale: 'zh' | 'en' }>
export type MarketCalendarQuery = MarketCalendarScope & Readonly<{ asOf: string; cursor?: string }>
export type MarketCalendarValue = Readonly<{ displayValue: string }> | null
// Query-only link, never a promotion of the provider observation's revision identity.
export type MarketCalendarOfficialLink = Readonly<{
  officialEventKey: string; officialPeriodKey: string; officialScheduledDate: string
  officialScheduledAt: string | null; officialDetectedAt: string
  timeDisplaySource: 'official-scheduled' | 'provider-scheduled' | 'date-only'
  displayScheduledAt: string | null
  officialActual: Readonly<{ displayValue: string }> | null
  officialPrevious: Readonly<{ displayValue: string }> | null
}>
export type MarketCalendarEvent = Readonly<{
  eventKey: string; title: string; countryCode: string | null; countryName?: string
  /**
   * Stable identity of the underlying observation.
   *
   * `eventKey` is an HMAC of the per-batch `observation_id`, so it changes on every
   * collection and cannot identify the same event across refreshes. This key comes
   * from the stored `market_fact_key`, which is verified stable across batches, so a
   * consumer that needs to track an event over time (the analysis facts) can rely on
   * it. Optional on the wire: a service that does not supply it keeps working.
   */
  observationKey?: string
  /**
   * 这条事件对应的规范指标键（`US.CPI.NSA.YOY`），**从写入时定下的身份里搬出来**，
   * 投影不重算。没有身份的行（讲话、旧源未登记的行）不带这个字段。
   */
  eventNameKey?: string
  /** 新源给的事件类型标识（`usa-policy-rate-decision` 这类）。行上没有就不带字段，不填空串。 */
  seriesId?: string
  /**
   * 这条发布覆盖的全部指标 key（一次发布可能包含多个 measure）。**与 `eventNameKey` 是两个
   * 含义**：前者是「它还包含哪些指标」，后者是「这条事件叫什么」。
   */
  measureKeys?: readonly string[]
  eventType: typeof marketCalendarPublicPolicy.kinds[number]
  /**
   * 重要度：**可缺省**（Chief 2026-11-14 定）。源没有这个字段就不写，读侧拿到「没有值」表达「未提供」；
   * 不新增 `unknown` 枚举值——缺失优先改类型，让「缺失」根本没有可写的值。
   */
  importance?: typeof marketCalendarPublicPolicy.importance[number]
  scheduledAt: string; consensus: MarketCalendarValue; providerPrevious: MarketCalendarValue; providerActual: MarketCalendarValue
  /**
   * 这条观测由哪个来源给出：`Narwhal` 是当前采集来源；`0xRouter` 只在 Narwhal 这个月的
   * 这一类事件里一行都没有时回落出现（库里还留着切换前的行）。
   */
  /**
   * 来源。**新写入一律给 feed id**（`marketCalendarPublicPolicy.sourceFeeds`）；
   * `'Narwhal' | '0xRouter'` 是旧行兼容值，读侧应按「feed id 优先、旧值兜底」判。
   */
  source: typeof marketCalendarPublicPolicy.sourceFeeds[number] | 'unspecified' | 'Narwhal' | '0xRouter'
  sourceObservedAt: string
  /**
   * `observed-unverified`＝数据商观测、未经官方核验；`available`＝官方来源这一行本身就是核验过的。
   * 标准表适配器按 `officialFeedIdOf(sourceProviderId)` 分流：官方行不再被统一降级成未核验。
   */
  coverage: typeof marketCalendarPublicPolicy.coverage[number]
  /**
   * 这条数据的**真实来源 feed id**（`macro-calendar-bls`、`macro-calendar-narwhal-economic-data`…）。
   * `source` 那两个值表达不了「官方 BLS 发的」——它只有市场/旧源两档，官方行会被标成旧源。
   * 这个字段先给真值；`source` 的枚举迁移要配文案映射，单独一笔做。
   */
  sourceFeedId?: string
  /**
   * 这条发布到什么精度：`minute` 有时刻、`date` 只有日期。
   * **少了它，日期型事件会被画成 00:00 一条**（README 里那句「缺字段会静默失效」）。
   * 可选：旧的投影不产出它，读侧要按「没有就按时刻渲染」保持兼容。
   */
  timePrecision?: 'minute' | 'date'
  /**
   * 源给的发布状态：读侧分「已发布 / 排期 / 待补值 / 未提供 / 取消」**只许读它，不按日期推**。
   *
   * **这条联合是唯一定义**（渲染模型、适配器、校验都从它派生）：`scheduled` 只用于「还没到发布日」；
   * 过期无值在 24h 补值窗口内是 `backfilling`（界面「待补值」），窗口外是 `missing`（「未提供」）；
   * `unknown` 是旧行的读兼容，读侧按 `missing` 处理，不单开第六态。
   */
  releaseStatus?: (typeof marketCalendarPublicPolicy.releaseStatuses)[number]
  /**
   * 行类型：`estimate` 是**随时更新的估算**（GDP 即时预测那类），不是一次发布。
   * 日历页的查询里正常不会有它；分析侧按身份取「最新估算」时要靠它分辨。
   * 可选：旧的投影不产出，缺了就是「不知道」，按发布对待。
   */
  rowKind?: 'release' | 'estimate'
  officialLink?: MarketCalendarOfficialLink
}>
/**
 * The most recent refresh attempt for one source, whichever path ran it.
 *
 * `failureCode` and `trigger` are optional so a service that only knows "failed at T"
 * keeps working. They exist because an automatic run that was refused by the shared
 * calendar ceiling is invisible otherwise: the page can show stale data and look like
 * the source simply has not published yet.
 */
export type MarketCalendarRefreshAttempt = Readonly<{ state: 'succeeded' | 'failed'; attemptedAt: string
  failureCode?: typeof marketCalendarPublicPolicy.attemptFailures[number]
  trigger?: typeof marketCalendarPublicPolicy.attemptTriggers[number] }>
export type MarketCalendarSource = Readonly<{ eventType: MarketCalendarEvent['eventType']; status: typeof marketCalendarPublicPolicy.statuses[number]; sourceObservedAt: string | null;
  latestAttempt?: MarketCalendarRefreshAttempt }>
export type MarketCalendarPage = Readonly<{ state: 'available'; month: string; locale: 'zh' | 'en'; asOf: string;
  events: readonly MarketCalendarEvent[]; sources: readonly MarketCalendarSource[];
  /**
   * 库里最早一天有数据的日期（`YYYY-MM-DD`）。**空月要说清是「没有事件」还是「早于数据起点」**
   * ——两者对读者是两件事：一个是那天确实没发布，一个是我们还没有那段数据。
   * 没有数据时是 `null`（事实）；字段缺席＝这条写入路径没带上（当成「不知道」，不许当成起点）。
   */
  dataStartDate?: string | null; nextCursor?: string }> |
  Readonly<{ state: 'unavailable'; failureCode: 'input-invalid' | 'query-unavailable' }>
export type MarketCalendarRefreshResult = Readonly<{ state: 'completed' | 'partial' | 'unavailable';
  sources: readonly MarketCalendarSource[]; failureCode?: typeof marketCalendarPublicPolicy.refreshFailures[number] }>
/**
 * How old the calendar actually is, for a consumer that must tell "nothing happened" from
 * "we could not see anything".
 *
 * `lastCollectedAt` is the **oldest** latest-success among the enabled sources, so one live
 * source cannot hide a stopped one; `null` means no enabled source has ever collected, which
 * is a fact, not a failure. `latestAttempt` says why the last try ended, including a failure
 * that never moved `lastCollectedAt`.
 */
export type MarketCalendarCollectionFreshness = Readonly<{
  descriptorId: string
  lastCollectedAt: string | null
  latestAttempt?: MarketCalendarRefreshAttempt
}>
/**
 * Four outcomes, and `timeout` is its own: the reader must be told "we did not finish in
 * time", never "the collection failed" — the two sentences lead to different actions.
 * `collected` means the batch stored; the caller may then read the same query the page uses.
 */
export type MarketCalendarRefreshNowResult =
  | Readonly<{ state: 'collected'; sources: readonly string[] }>
  | Readonly<{ state: 'unchanged' }>
  | Readonly<{ state: 'failed'; failureCode: string }>
  | Readonly<{ state: 'timeout'; timeoutMs: number }>
export type MarketCalendarFreshness =
  | Readonly<{ state: 'available'; asOf: string; lastCollectedAt: string | null
    sources: readonly MarketCalendarCollectionFreshness[] }>
  | Readonly<{ state: 'unavailable'; failureCode: 'query-unavailable' }>

export function marketExact(value: unknown, required: readonly string[], optional: readonly string[] = []): value is Record<string, unknown> {
  try {
    if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false
    const keys = Reflect.ownKeys(value)
    return required.every(key => keys.includes(key)) && keys.every(key => typeof key === 'string' &&
      (required.includes(key) || optional.includes(key)) && 'value' in Object.getOwnPropertyDescriptor(value, key)!)
  } catch { return false }
}
export function marketInstant(value: unknown): value is string {
  return typeof value === 'string' && marketCalendarPublicPolicy.instantPattern.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}
function scope(value: Record<string, unknown>): boolean {
  return typeof value.month === 'string' && marketCalendarPublicPolicy.monthPattern.test(value.month) && (value.locale === 'zh' || value.locale === 'en')
}
export function isMarketCalendarScope(value: unknown): value is MarketCalendarScope {
  return marketExact(value, ['month', 'locale']) && scope(value)
}
export function isMarketCalendarQuery(value: unknown): value is MarketCalendarQuery {
  return marketExact(value, ['month', 'locale', 'asOf'], ['cursor']) && scope(value) && marketInstant(value.asOf) &&
    (!Object.hasOwn(value, 'cursor') || typeof value.cursor === 'string' && marketCalendarPublicPolicy.opaquePattern.test(value.cursor))
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= marketCalendarPublicPolicy.textCharacters &&
    new TextEncoder().encode(value).length <= marketCalendarPublicPolicy.textBytes && !/[\u0000-\u001f\u007f]/u.test(value)
}
function display(value: unknown): value is MarketCalendarValue {
  return value === null || marketExact(value, ['displayValue']) && text(value.displayValue) && !['-', '--', '—', 'n/a', 'null'].includes(value.displayValue.toLowerCase())
}
export function isMarketCalendarOfficialLink(value: unknown, providerScheduledAt?: string): value is MarketCalendarOfficialLink {
  if (!marketExact(value, ['officialEventKey', 'officialPeriodKey', 'officialScheduledDate', 'officialScheduledAt',
    'officialDetectedAt', 'timeDisplaySource', 'displayScheduledAt']) || !text(value.officialEventKey) ||
    !text(value.officialPeriodKey) || !marketInstant(value.officialDetectedAt) ||
    typeof value.officialScheduledDate !== 'string' || !marketInstant(`${value.officialScheduledDate}T00:00:00.000Z`)) return false
  if (value.timeDisplaySource === 'official-scheduled') return marketInstant(value.officialScheduledAt) && value.displayScheduledAt === value.officialScheduledAt
  if (value.officialScheduledAt !== null) return false
  if (value.timeDisplaySource === 'provider-scheduled') return marketInstant(providerScheduledAt) && value.displayScheduledAt === providerScheduledAt
  return value.timeDisplaySource === 'date-only' && value.displayScheduledAt === null && providerScheduledAt === undefined
}
export function isMarketCalendarEvent(value: unknown): value is MarketCalendarEvent {
  return marketExact(value, ['eventKey', 'title', 'countryCode', 'eventType', 'scheduledAt', 'consensus',
    'providerPrevious', 'providerActual', 'source', 'sourceObservedAt', 'coverage'], [
    // `importance` 可选：源没说就没有这个字段（缺省 ≠ 某个更低的重要度）。
    'importance', 'officialLink', 'countryName', 'observationKey', 'eventNameKey', 'seriesId', 'measureKeys',
      // 切到标准表后适配器**每行都写**这四个（时间精度、生命周期、行类型、来源真值）。
      // 白名单里没有它们时，`marketExact` 判 false → 整页非法 → 读者看到「读不到」，
      // 而行级断言全绿（那一层不跑页面校验）。
      'timePrecision', 'releaseStatus', 'rowKind', 'sourceFeedId']) &&
    (!Object.hasOwn(value, 'timePrecision') || value.timePrecision === 'minute' || value.timePrecision === 'date') &&
    (!Object.hasOwn(value, 'releaseStatus') || (marketCalendarPublicPolicy.releaseStatuses as readonly string[]).includes(String(value.releaseStatus))) &&
    (!Object.hasOwn(value, 'rowKind') || value.rowKind === 'release' || value.rowKind === 'estimate') &&
    (!Object.hasOwn(value, 'sourceFeedId') ||
      (marketCalendarPublicPolicy as { sourceFeeds: readonly string[] }).sourceFeeds.includes(String(value.sourceFeedId)) ||
      value.sourceFeedId === marketCalendarPublicPolicy.unspecifiedSource) &&
    (!Object.hasOwn(value, 'measureKeys') || (Array.isArray(value.measureKeys) && value.measureKeys.length > 0 &&
      value.measureKeys.every((key) => typeof key === 'string' && key.length > 0 &&
        key.length <= marketCalendarPublicPolicy.maximumObservationKeyChars && !key.includes('|')))) &&
    (!Object.hasOwn(value, 'eventNameKey') || (typeof value.eventNameKey === 'string' && value.eventNameKey.length > 0 && value.eventNameKey.length <= marketCalendarPublicPolicy.maximumObservationKeyChars && !value.eventNameKey.includes('|'))) &&
    (!Object.hasOwn(value, 'seriesId') || (typeof value.seriesId === 'string' && value.seriesId.length > 0 && value.seriesId.length <= marketCalendarPublicPolicy.maximumObservationKeyChars)) &&
    (!Object.hasOwn(value, 'observationKey') || (typeof value.observationKey === 'string' && value.observationKey.length > 0 && value.observationKey.length <= marketCalendarPublicPolicy.maximumObservationKeyChars)) &&
    typeof value.eventKey === 'string' && marketCalendarPublicPolicy.opaquePattern.test(value.eventKey) && text(value.title) &&
    (value.countryCode === null || typeof value.countryCode === 'string' && marketCalendarPublicPolicy.countryCodePattern.test(value.countryCode) && !(marketCalendarPublicPolicy.forbiddenCountryCodes as readonly string[]).includes(value.countryCode)) &&
    (!Object.hasOwn(value, 'countryName') || text(value.countryName)) &&
    marketCalendarPublicPolicy.kinds.includes(value.eventType as never) &&
    (!Object.hasOwn(value, 'importance') || marketCalendarPublicPolicy.importance.includes(value.importance as never)) &&
    marketInstant(value.scheduledAt) && marketInstant(value.sourceObservedAt) && ((marketCalendarPublicPolicy as { sourceFeeds: readonly string[] }).sourceFeeds as readonly unknown[])
      .concat(['Narwhal', '0xRouter', marketCalendarPublicPolicy.unspecifiedSource]).includes(value.source) &&
    (marketCalendarPublicPolicy.coverage as readonly unknown[]).includes(value.coverage) &&
    [value.consensus, value.providerPrevious, value.providerActual].every(display) &&
    (value.eventType === 'economic-indicator' || [value.consensus, value.providerPrevious, value.providerActual].every(item => item === null)) &&
    (!Object.hasOwn(value, 'officialLink') || value.eventType === 'economic-indicator' &&
      isMarketCalendarOfficialLink(value.officialLink, value.scheduledAt as string)) &&
    new TextEncoder().encode(JSON.stringify(value)).length <= marketCalendarPublicPolicy.eventBytes
}
function refreshAttempt(value: unknown): value is MarketCalendarRefreshAttempt {
  return marketExact(value, ['state', 'attemptedAt'], ['failureCode', 'trigger']) &&
    ['succeeded', 'failed'].includes(value.state as string) && marketInstant(value.attemptedAt) &&
    // A reason belongs to a failure, and only to a verdict this boundary can name.
    (!Object.hasOwn(value, 'failureCode') || value.state === 'failed' &&
      marketCalendarPublicPolicy.attemptFailures.includes(value.failureCode as never)) &&
    (!Object.hasOwn(value, 'trigger') || marketCalendarPublicPolicy.attemptTriggers.includes(value.trigger as never))
}
function source(value: unknown): value is MarketCalendarSource {
  return marketExact(value, ['eventType', 'status', 'sourceObservedAt'], ['latestAttempt']) && marketCalendarPublicPolicy.kinds.includes(value.eventType as never) &&
    marketCalendarPublicPolicy.statuses.includes(value.status as never) &&
    (!Object.hasOwn(value, 'latestAttempt') || refreshAttempt(value.latestAttempt)) &&
    (value.status === 'unavailable' ? value.sourceObservedAt === null : marketInstant(value.sourceObservedAt))
}
function safeArray<T>(value: unknown, item: (value: unknown) => value is T): value is readonly T[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false
    const keys = Reflect.ownKeys(value)
    if (!keys.includes('length') || keys.some(key => key !== 'length' && (typeof key !== 'string' || !/^\d+$/.test(key)))) return false
    const length = value.length
    if (keys.length !== length + 1) return false
    for (let index = 0; index < length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable || !descriptor.writable || !descriptor.configurable || !item(descriptor.value)) return false
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
    return Boolean(lengthDescriptor && 'value' in lengthDescriptor && lengthDescriptor.value === length)
  } catch { return false }
}
export function isMarketCalendarPage(value: unknown, query: MarketCalendarQuery): value is MarketCalendarPage {
  if (marketExact(value, ['state', 'failureCode']) && value.state === 'unavailable') return value.failureCode === 'input-invalid' || value.failureCode === 'query-unavailable'
  return marketExact(value, ['state', 'month', 'locale', 'asOf', 'events', 'sources'], ['nextCursor', 'dataStartDate']) && value.state === 'available' &&
    (!Object.hasOwn(value, 'dataStartDate') || value.dataStartDate === null || typeof value.dataStartDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.dataStartDate)) &&
    value.month === query.month && value.locale === query.locale && value.asOf === query.asOf &&
    safeArray(value.events, isMarketCalendarEvent) && value.events.length <= marketCalendarPublicPolicy.maximumEvents && value.events.every(item =>
      isMarketCalendarEvent(item) && item.sourceObservedAt <= query.asOf && item.scheduledAt.startsWith(query.month + '-')) &&
    safeArray(value.sources, source) && value.sources.length === marketCalendarPublicPolicy.kinds.length && value.sources.every((item, i) =>
      source(item) && item.eventType === marketCalendarPublicPolicy.kinds[i] && (!item.sourceObservedAt || item.sourceObservedAt <= query.asOf) &&
      (!item.latestAttempt || item.latestAttempt.attemptedAt <= query.asOf)) &&
    (!Object.hasOwn(value, 'nextCursor') || typeof value.nextCursor === 'string' && marketCalendarPublicPolicy.opaquePattern.test(value.nextCursor)) &&
    new TextEncoder().encode(JSON.stringify(value)).length <= marketCalendarPublicPolicy.pageBytes
}
export function isMarketCalendarRefreshResult(value: unknown): value is MarketCalendarRefreshResult {
  return marketExact(value, ['state', 'sources'], ['failureCode']) && ['completed', 'partial', 'unavailable'].includes(value.state as string) &&
    safeArray(value.sources, source) && (value.sources.length === 0 && value.state === 'unavailable' ||
      value.sources.length === marketCalendarPublicPolicy.kinds.length && value.sources.every((item, i) => source(item) && item.eventType === marketCalendarPublicPolicy.kinds[i])) &&
    (!Object.hasOwn(value, 'failureCode') || marketCalendarPublicPolicy.refreshFailures.includes(value.failureCode as never))
}

export function isMarketCalendarFreshness(value: unknown): value is MarketCalendarFreshness {
  if (marketExact(value, ['state', 'failureCode']) && value.state === 'unavailable') return value.failureCode === 'query-unavailable'
  if (!marketExact(value, ['state', 'asOf', 'lastCollectedAt', 'sources']) || value.state !== 'available') return false
  if (!marketInstant(value.asOf)) return false
  if (value.lastCollectedAt !== null && !marketInstant(value.lastCollectedAt)) return false
  if (!safeArray(value.sources, sourceFreshness)) return false
  return value.sources.length === marketCalendarPublicPolicy.feedByKind.length &&
    value.sources.every((item, index) => item.descriptorId === marketCalendarPublicPolicy.feedByKind[index]) &&
    value.sources.every(item => item.lastCollectedAt === null || item.lastCollectedAt <= (value.asOf as string))
}
function sourceFreshness(value: unknown): value is MarketCalendarCollectionFreshness {
  return marketExact(value, ['descriptorId', 'lastCollectedAt'], ['latestAttempt']) &&
    typeof value.descriptorId === 'string' && (marketCalendarPublicPolicy.feedByKind as readonly string[]).includes(value.descriptorId) &&
    (value.lastCollectedAt === null || marketInstant(value.lastCollectedAt)) &&
    (!Object.hasOwn(value, 'latestAttempt') || refreshAttempt(value.latestAttempt))
}

export function isMarketCalendarRefreshNowResult(value: unknown): value is MarketCalendarRefreshNowResult {
  if (marketExact(value, ['state']) && value.state === 'unchanged') return true
  if (marketExact(value, ['state', 'sources']) && value.state === 'collected') {
    return Array.isArray(value.sources) && value.sources.length > 0 &&
      value.sources.every(item => typeof item === 'string' && (marketCalendarPublicPolicy.collectionFeeds as readonly string[]).includes(item))
  }
  if (marketExact(value, ['state', 'timeoutMs']) && value.state === 'timeout') {
    return value.timeoutMs === marketCalendarPublicPolicy.refreshNow.defaultTimeoutMs ||
      (typeof value.timeoutMs === 'number' && Number.isSafeInteger(value.timeoutMs) &&
        value.timeoutMs >= marketCalendarPublicPolicy.refreshNow.minimumTimeoutMs &&
        value.timeoutMs <= marketCalendarPublicPolicy.refreshNow.maximumTimeoutMs)
  }
  return marketExact(value, ['state', 'failureCode']) && value.state === 'failed' &&
    typeof value.failureCode === 'string' && value.failureCode.length > 0 && value.failureCode.length <= 64
}
