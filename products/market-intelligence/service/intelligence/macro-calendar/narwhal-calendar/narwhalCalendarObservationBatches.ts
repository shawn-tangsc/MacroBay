import { narwhalEventSourceEventId, narwhalMeasureMetricKeys, narwhalSourceEventIdForIdentity } from '../marketCalendarMetricIdentity'
import { eventCodeBySourceType } from '../marketCalendarEventCodeTable'
import type { NarwhalParsedRelease } from './narwhalCalendarParser'

/**
 * Narwhal 的一次采集 → 日历观测批次（`appendCollection` 的输入）。
 *
 * 两条口径分开写死：
 * - **有值发布**：身份 = `(国家, metric_key, period_key)`，`period` 直接取来源给的
 *   `period` 字段——不按发布月反推（滞后序列与当月调查会算错）。算不出身份就退回
 *   `release_id`，读回来是 `unmapped`，不进日历但行在库里。
 * - **事件型发布**（讲话、资产负债表、能源报告这类没有数值格的）：身份 =
 *   `(国家, 类型, 时刻)`，同样入库；显示侧的配对规则另定。
 *
 * 一次调用写三类身份（经济指标 / 财经事件 / 央行活动），`collection` 只记一条。
 */

export type NarwhalCalendarLocale = 'zh' | 'en'

const feedByKind = Object.freeze({
  'economic-indicator': 'macro-calendar-narwhal-economic-data',
  'financial-event': 'macro-calendar-narwhal-financial-events',
  'central-bank-activity': 'macro-calendar-narwhal-central-bank-activities'
} as const)
type NarwhalEventKind = keyof typeof feedByKind

/** 事件型的分型：讲话/央行沟通归央行活动，其余（资产负债表、能源报告等）归财经事件。 */
function eventKindOf(topic: string | undefined): NarwhalEventKind {
  return topic === 'policy_communication' ? 'central-bank-activity' : 'financial-event'
}

/**
 * 存储层认的国家码是两位（`US` / `DE`），身份口径是三位（ISO alpha-3）。写入时按存储归一，
 * 身份串里保留三位——两处各用各的口径，读取侧再归一，不然同一个国家会出现两个 key。
 */
const storageCountryCode: Readonly<Record<string, string>> = Object.freeze({
  USA: 'US', CAN: 'CA', DEU: 'DE', GBR: 'GB', JPN: 'JP', CHN: 'CN', EUR: 'EU'
})

function storageCodeOf(country: string): string | undefined {
  return storageCountryCode[country]
}

/** 有值发布的主测度：优先 `measure === concept`，否则取第一个登记过的测度。 */
function primaryMappedValue(release: NarwhalParsedRelease) {
  const mapped = release.values.filter((value) => narwhalMeasureMetricKeys[value.measure] !== undefined)
  return mapped.find((value) => value.measure === value.concept) ?? mapped[0]
}

export type NarwhalCalendarBatch = Readonly<{
  collectionId: string
  providerId: 'narwhal'
  descriptorId: string
  locale: NarwhalCalendarLocale
  month: string
  parserVersion: string
  parseResult: Readonly<{
    state: 'succeeded'
    drafts: readonly Readonly<Record<string, unknown>>[]
    diagnostics: Readonly<{ inputRows: number; skippedRows: number; reasons: Readonly<Record<string, number>> }>
  }>
}>

const emptyReasons = Object.freeze({ 'invalid-identity': 0, 'invalid-date': 0, 'invalid-row': 0 })

/**
 * 按 (月, 类型, locale) 切批次。**一条发布只进一个批次**：月份取发布时刻所在月，
 * 类型按是否有值分，locale 由调用方给（一次采集要为两种语言各写一份，查询按 locale 读）。
 */
export function narwhalObservationBatches(
  releases: readonly NarwhalParsedRelease[],
  options: Readonly<{ locale: NarwhalCalendarLocale; parserVersion: string; collectionIdPrefix: string }>
): readonly NarwhalCalendarBatch[] {
  const grouped = new Map<string, { month: string; kind: NarwhalEventKind; drafts: Record<string, unknown>[] }>()
  for (const release of releases) {
    const month = release.eventDate.slice(0, 7)
    if (!/^\d{4}-\d{2}$/.test(month) || !release.at.startsWith(month)) continue
    const valued = primaryMappedValue(release)
    // 「有没有数值格」决定它是不是事件型；**有值但测度没登记不是事件**，那是有值但算不出身份。
    const kind: NarwhalEventKind = release.values.length === 0 ? eventKindOf(release.topic) : 'economic-indicator'
    const bucket = grouped.get(`${month}|${kind}`) ?? { month, kind, drafts: [] }
    // 同一次发布被来源拆成两条 release（非农、失业率、JOLTS…）时，两条算出**同一个身份**，
    // 一个批次里同一个身份只能有一行——留信息最全的那条（有 actual 的优先），其余计为跳过。
    const draft = draftOf(release, kind, options.locale)
    const factKey = String(draft.marketFactKey)
    const existing = bucket.drafts.findIndex((item) => String(item.marketFactKey) === factKey)
    if (existing < 0) bucket.drafts.push(draft)
    else if (draft.providerActual !== undefined && bucket.drafts[existing]!.providerActual === undefined) {
      bucket.drafts[existing] = draft
    }
    grouped.set(`${month}|${kind}`, bucket)
  }
  return [...grouped.values()].map((bucket) => ({
    collectionId: `${options.collectionIdPrefix}-${bucket.month}-${bucket.kind}-${options.locale}`,
    providerId: 'narwhal' as const,
    descriptorId: feedByKind[bucket.kind],
    locale: options.locale,
    month: bucket.month,
    parserVersion: options.parserVersion,
    parseResult: {
      state: 'succeeded' as const,
      drafts: bucket.drafts,
      diagnostics: { inputRows: bucket.drafts.length, skippedRows: 0, reasons: emptyReasons }
    }
  }))
}

function draftOf(release: NarwhalParsedRelease, kind: NarwhalEventKind, locale: NarwhalCalendarLocale): Record<string, unknown> {
  const descriptorId = feedByKind[kind]
  const sourceEventId = sourceEventIdOf(release, kind)
  const valued = kind === 'economic-indicator' ? primaryMappedValue(release) : undefined
  const measureKeys = [...new Set(release.values.map((value) => narwhalMeasureMetricKeys[value.measure])
    .filter((key): key is string => key !== undefined))]
  return {
    providerId: 'narwhal',
    descriptorId,
    kind,
    locale,
    sourceEventId,
    marketFactKey: JSON.stringify(['narwhal', descriptorId, locale, sourceEventId]),
    identityState: 'unverified',
    localeMerge: 'disabled',
    officialLink: 'disabled',
    displayName: release.name,
    ...(storageCodeOf(release.country) === undefined ? {} : { countryCode: storageCodeOf(release.country)! }),
    importance: 'medium',
    scheduledDate: release.eventDate,
    scheduledAt: release.at,
    ...(measureKeys.length === 0 ? {} : { measureKeys: measureKeys.join(',') }),
    ...(valued === undefined ? {} : {
      consensus: displayValueOf(valued.consensus),
      providerPrevious: displayValueOf(valued.previous),
      providerActual: displayValueOf(valued.actual)
    })
  }
}

/** 有值：规范身份；没有 `period` 或指标不在表里：来源自己的 `release_id`（读回来即 unmapped）。 */
function sourceEventIdOf(release: NarwhalParsedRelease, kind: NarwhalEventKind): string {
  if (kind === 'economic-indicator') {
    const valued = primaryMappedValue(release)
    const metricKey = valued === undefined ? undefined : narwhalMeasureMetricKeys[valued.measure]
    if (metricKey !== undefined && release.period !== undefined && release.period.length > 0) {
      return narwhalSourceEventIdForIdentity({ countryCode: release.country, metricKey, periodKey: release.period })
    }
  }
  if (kind !== 'economic-indicator') {
    // 事件型身份 = (国家, 类型, 时刻)。时刻取来源给的发布时刻，分钟级。
    return narwhalEventSourceEventId(release.country, kind, release.at)
  }
  return JSON.stringify([release.releaseId, 1])
}

function displayValueOf(raw: string | undefined): Record<string, string> | undefined {
  return raw === undefined || raw.length === 0 ? undefined : { displayValue: raw }
}

/**
 * 标准表用的**按 measure 拆行**：一次发布里的每个 measure 各一行，身份各算各的。
 *
 * 为什么不从观测草稿派生：观测草稿是「一次发布一行」，身份只取第一个映射得上的 measure
 * （`Consumer prices` 那行是核心 CPI 月率），整体 CPI 就永远配不上官方行。这里**直接从
 * `release.values` 生成**，一个 measure 一行；拆出来的行共享 `scheduledAt` / `sourceEventId`
 * （它们说的是「这次发布」），只有 `metricKey` 与值不同。
 */
export type NarwhalStandardRowInput = Readonly<{
  countryCode: string
  metricKey: string
  periodKey: string
  scheduledDate: string
  scheduledAt: string
  sourceEventId: string
  /** 指标型是 `minute`/`date`（按有没有时刻）；事件型按是否只有日期。 */
  timePrecision?: 'minute' | 'date'
  previous?: string
  consensus?: string
  actual?: string
}>

export function narwhalStandardRowInputs(releases: readonly NarwhalParsedRelease[]): readonly NarwhalStandardRowInput[] {
  const rows: NarwhalStandardRowInput[] = []
  for (const release of releases) {
    const period = release.period
    if (period === undefined || period.length === 0) {
      // **没有 `period` 不等于缺数据**：这些几乎全是事件型（讲话、声明、资产负债表、石油库存…），
      // 源本来就只给「什么时候、是什么类型」。它们走事件型身份 `(国家, evt.类型, 时刻/日期)`。
      // **带值也算事件型**（例：`policy_rate` 决议那条，值在 `values` 上而不是 release 上）：
      // 官方 FOMC 那边是事件型，市场这边若当指标型，同一个会议就分成两行。事件型行带值不矛盾。
      // 映射不到 `evt.*` 的才落 `unknown-event-type`（不是 `bad-period`——源里根本没有期间字段）。
      const code = eventCodeBySourceType[release.name]
      if (code === undefined) continue
      const first = release.values[0]
      rows.push({
        countryCode: release.country, metricKey: code, periodKey: release.at.slice(0, 16),
        scheduledDate: release.eventDate, scheduledAt: release.at, sourceEventId: release.releaseId,
        timePrecision: 'minute',
        ...(first?.previous === undefined ? {} : { previous: first.previous }),
        ...(first?.consensus === undefined ? {} : { consensus: first.consensus }),
        ...(first?.actual === undefined ? {} : { actual: first.actual })
      })
      continue
    }
    for (const value of release.values) {
      const metricKey = narwhalMeasureMetricKeys[value.measure]
      if (metricKey === undefined) continue
      rows.push({
        countryCode: release.country, metricKey, periodKey: period,
        scheduledDate: release.eventDate, scheduledAt: release.at, sourceEventId: release.releaseId,
        ...(value.previous === undefined ? {} : { previous: value.previous }),
        ...(value.consensus === undefined ? {} : { consensus: value.consensus }),
        ...(value.actual === undefined ? {} : { actual: value.actual })
      })
    }
  }
  return rows
}
