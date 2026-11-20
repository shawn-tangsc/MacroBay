import type { marketCalendarPublicPolicy, MarketCalendarValue } from './marketCalendarQueryContracts'

/**
 * **事件契约的类型块**（用户 2026-11-20）：从 `marketCalendarQueryContracts.ts` 抽出来，
 * 只为把那支文件拉回 500 行以内（体积门禁只减不增）。类型与校验仍是同一套口径，
 * 主文件 re-export，调用方 import 路径不变。
 *
 * 这里只放**类型**：`import type` 在编译后被擦除，所以与主文件之间不存在运行时循环依赖；
 * 形状守卫（`isMarketCalendarEvent` 等）仍留在主文件，因为它们要跑通用谓词。
 */
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
  eventKey: string; title: string; countryCode: string | null
  /** 给眼睛看的国家名（英文下是两位代码 `US`；中文是「美国」）。 */
  countryName?: string
  /**
   * **给读屏/悬停看的完整国家名**（用户 2026-11-20）：英文 `United States`、中文「美国」。
   * 与 `countryName` 是同一份数据的两种粒度（出处仍是显示名表），**没有国家时这个键不出现**（不是空串）。
   */
  countryNameFull?: string
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
  /**
   * 写入时定下的期次与首发布日（用户 2026-11-20）：详情抽屉要用它们去查来源审计表
   * （四元组 = countryCode + metricKey + periodKey + firstScheduledDate）。
   * **从写入时定下的身份里搬出来，投影不重算**；没有身份的行（讲话、旧源未登记）不带这两个字段。
   * 为什么不让界面按 scheduledAt 反推：真库 `(metric_key, scheduled_date)` 有 52 组/108 行重复，
   * 反推会挑错行，把「有记录」显示成「未记录」。
   */
  periodKey?: string
  firstScheduledDate?: string
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
  /**
   * 这一期发布过几次（>1 时界面要显示「本期 N 次」）。
   * 二读/三读不显示次数，读者就会把二读当初值——合并了不回显等于把「改过数据」藏起来。
   */
  releaseCount?: number
  /** 这一期的每一次排期（合并后要能点开看到「第 1 次 11-25、第 2 次 12-23」）。 */
  releaseDates?: readonly string[]
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
  /**
   * **指标层级**（用户 2026-11-17）：母指标拆出的分项，详情里要说清「它属于谁」或「它由哪些分项组成」。
   *
   * 名字（`parentName` / `childNames`）由服务端从层级表取，**渲染层不拼、不数点号**；
   * 普通指标没有这一层，`undefined` 时详情整行不显示（不画空标签）。`childNames` 按词表序。
   */
  hierarchy?: Readonly<{ kind: 'parent' | 'child'; parentName?: string; childNames?: readonly string[] }>
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
