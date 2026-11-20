import { narwhalEventSourceEventId, narwhalMeasureMetricKeys, narwhalSourceEventIdForIdentity } from '../marketCalendarMetricIdentity'
import { narwhalStandardSourceEventId } from '../marketCalendarSourceEventId'
import { eventCodeBySourceType } from '../marketCalendarEventCodeTable'
import type { CalendarIdentityKind, CalendarReleaseStatus, CalendarUnmappedReason } from '../marketCalendarStandardTable'
import { narwhalPrimaryMetricBySeriesId } from './narwhalSeriesPrimaryMetric'
import { marketCalendarCountrySourceMappings } from '../marketCalendarCountrySourceMappings'
import type { NarwhalParsedRelease } from './narwhalCalendarParser'
import { draftsOf, eventKindOf, feedByKind, type NarwhalCalendarLocale, type NarwhalEventKind } from './narwhalCalendarDrafts'

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
 * 一次调用写三类身份（经济指标 / 金融事件 / 央行活动），`collection` 只记一条。
 */

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
    // 「有没有数值格」决定它是不是事件型；**有值但测度没登记不是事件**，那是有值但算不出身份。
    const kind: NarwhalEventKind = release.values.length === 0 ? eventKindOf(release.topic) : 'economic-indicator'
    const bucket = grouped.get(`${month}|${kind}`) ?? { month, kind, drafts: [] }
    // 同一次发布被来源拆成两条 release（非农、失业率、JOLTS…）时，两条算出**同一个身份**，
    // 一个批次里同一个身份只能有一行——留信息最全的那条（有 actual 的优先），其余计为跳过。
    // 一个 release 现在可能产出**多条** draft（按 measure 拆，见 `draftsOf`），逐条走同一套去重。
    for (const draft of draftsOf(release, kind, options.locale)) {
      const factKey = String(draft.marketFactKey)
      const existing = bucket.drafts.findIndex((item) => String(item.marketFactKey) === factKey)
      if (existing < 0) bucket.drafts.push(draft)
      else if (draft.providerActual !== undefined && bucket.drafts[existing]!.providerActual === undefined) {
        bucket.drafts[existing] = draft
      }
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

/** 源的状态串 → 闭集。认不出的**不猜**，落 `unknown`。 */
function releaseStatusOf(raw: string): CalendarReleaseStatus {
  return raw === 'scheduled' || raw === 'published' || raw === 'cancelled' ? raw : 'unknown'
}

/**
 * `published` 的定义是**有实际值**（用户 2026-11-16 报的帝国大厦那条）。
 *
 * 源把一条标成 `published` 却只给了预期与前值时，原样落库会让「已发布优先」的取舍逻辑选中它——
 * 那条就是这样成为权威的（预期 10，官方 18）。所以这类行退回 `backfilling`：值区照旧说
 * 「未提供」，而 24 小时窗口过后由 `reconcileExpiredReleaseStatuses` 落成 `missing`。
 *
 * 判据只看**这一行自己的**实际值，不看同一条发布里别的 measure：一条发布里某个测度有值、
 * 另一个没有，两行本来就该各自算。
 */
function publishedNeedsActual(raw: CalendarReleaseStatus, actual: string | undefined): CalendarReleaseStatus {
  return raw === 'published' && (actual === undefined || actual.trim() === '') ? 'backfilling' : raw
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
  rowKind?: 'release' | 'estimate'
  /**
   * 行种类：指标行带一个 measure，事件行没有 measure。
   * **显式字段，不用 `metricKey.startsWith('evt.')` 嗅探**——换个命名就失效，而且那是拿字符串猜语义。
   */
  kind: 'indicator' | 'event'
  /** `code`＝标准码身份（可跨源合并）；`source`＝源内身份（照常显示，不跨源合并）。 */
  identityKind: CalendarIdentityKind
  /** `source` 身份要带源原文名：标准码的显示名去名表查，源内 id 查不到。 */
  sourceLabel?: string
  /** 源的 `series_id`（转正时重算身份用）。 */
  seriesId?: string
  /** 源给的发布状态（闭集）：读侧分「已发布/排期/取消」只许读它，不按日期推。 */
  status: CalendarReleaseStatus
  /** 这一行是由**源的某个 measure** 生成的（测度层对账只数它们）。 */
  fromMeasure?: true
  /**
   * **源内发布 id**（`release_id`）：判别「同一发布改了排期」与「同期的第二次真实发布」的唯一依据
   * （架构师 2026-11-21 批 (b)）。事件行与源内身份行不带——它们本来就不按码认行。
   */
  sourceReleaseId?: string
  /** 源标了已发布、却一个值都没给：值区显示「未提供」（读侧按 status + 无值判）。 */
  valueState?: 'missing'
  previous?: string
  consensus?: string
  actual?: string
}>

/**
 * **不是发布的序列**：不进日历，也不进 `unmapped`。
 *
 * `usa-gdp-nowcast` 是**随时更新的估算**，不是「什么时候有一次发布」。按日期键它会按更新日
 * 一天一行（11 月三天三行），读者会把三次估算看成三次 GDP 发布。判定按**数据清单**（series id），
 * 不按名字。它该出现在 GDP 卡片与分析里——那里「最新值」的语义是对的，同一个数在日历里错、在卡片里对。
 */
export const narwhalNotAReleaseSeriesIds: readonly string[] = Object.freeze(['usa-gdp-nowcast'])

/**
 * 行 + **没映射上的**（不静默丢）。
 *
 * 没有 `period`、类型串又不在 22 号表里的行，以前在构造器里 `continue` 掉了——结果是
 * `unmapped` 表永远空，而「空表」会被当成「没有未映射」。**映射不上是事实，必须交出去记下来**，
 * 否缺口统计就是假的。
 */
export function narwhalStandardRowInputsDetailed(releases: readonly NarwhalParsedRelease[]): Readonly<{
  rows: readonly NarwhalStandardRowInput[]
  unmapped: readonly Readonly<{ sourceKey: string; name: string
    /** 闭集来自标准表策略（**不在这里再抄一份**：两份闭集必然漂移，`no-values` 就是这么漏的）。 */
    reason: CalendarUnmappedReason
    /** 这个发布里没映射上的 measure（测度层对账用；空表也能看出缺哪些）。 */
    measureKeys?: readonly string[] }>[]
}> {
/**
 * **源内 id → 码**（按国家建的那张映射表），**落行前**就要查（2026-11-18 Chief 定）。
 *
 * 以前：采集先写 `identity_kind='source'`，指望事后转正。可 23:00 那批采集把 746 行源内身份
 * 又写了回来，`source` 从 1045 涨回 1785——「补完又被新数据冲掉」，因为写入端根本没查映射表。
 * 判据：**采集一轮之后 `identity_kind='source'` 不再增长**。转正脚本只处理历史存量。
 *
 * 只认同国家的码：跨国家的映射是数据错误，写进去就是把一国的发布挂到另一国名下。
 */
function countryMappedMetricKey(releaseId: string, country: string): string | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(releaseId)
  } catch {
    return undefined
  }
  if (!Array.isArray(parsed) || (typeof parsed[0] !== 'string' && typeof parsed[0] !== 'number')) return undefined
  const entry = marketCalendarCountrySourceMappings[String(parsed[0])]
  if (entry === undefined) return undefined
  return entry.metricKey.startsWith(`${country}.`) ? entry.metricKey : undefined
}

/**
 * **指标行用四段身份**（方案 §2.4）：`国家|指标码|期|首次排期日`，与观测层那个三段串**不是同一个**。
 *
 * 为什么不复用 `release.releaseId`（uuid）：一次发布拆 N 行共用一个 uuid 时，台账主键
 * `(provider_id, source_event_id)` 只能认领一行，其余永远「台账里没有」；四段身份让
 * 「行键 = 身份」，台账 1:1。事件行与源内身份行没有码，仍用 `(国家, 类型, 时刻)` / `releaseId`。
 */
function codeRowIdentity(release: NarwhalParsedRelease, metricKey: string, periodKey: string): string {
  return narwhalStandardSourceEventId({
    countryCode: release.country, metricKey, periodKey, firstScheduledDate: release.eventDate
  })
}

  const rows: NarwhalStandardRowInput[] = []
  const unmapped: { sourceKey: string; name: string
    reason: CalendarUnmappedReason; measureKeys?: string[] }[] = []
  for (const release of releases) {
    // 不是「排除」，是**写进去并标记**：分析侧只读标准表一个入口，不写表它就彻底不存在；
    // 而日历按 `row_kind = 'release'` 过滤，所以三次估算不会变成三次「GDP 发布」。
    const isEstimate = narwhalNotAReleaseSeriesIds.includes(release.seriesId)
    const status = releaseStatusOf(release.status)
    const period = release.period
    const primaryMetric = narwhalPrimaryMetricBySeriesId[release.seriesId]
    const eventCode = eventCodeBySourceType[release.name]
    // **映射表里有就直接写码**：这一行不该先记成源内身份再等转正。
    const countryMetric = countryMappedMetricKey(release.releaseId, release.country)
    const first = release.values[0]
    const values = {
      ...(first?.previous === undefined ? {} : { previous: first.previous }),
      ...(first?.consensus === undefined ? {} : { consensus: first.consensus }),
      ...(first?.actual === undefined ? {} : { actual: first.actual })
    }

    // —— 一、有期间、有值：按 measure 拆行（身份来自 measure 映射）——
    if (period !== undefined && period.length > 0 && release.values.length > 0) {
      let anyMapped = false
      for (const value of release.values) {
        const metricKey = narwhalMeasureMetricKeys[value.measure]
        if (metricKey === undefined) {
          // 有期间、但 measure 不在映射表里——**按发布层守恒算不出来**，必须在这里交出。
          const existing = unmapped.find((item) => item.sourceKey === release.releaseId)
          if (existing === undefined) {
            unmapped.push({ sourceKey: release.releaseId, name: release.name, reason: 'unknown-measure',
              measureKeys: [value.measure] })
          } else {
            existing.measureKeys = [...(existing.measureKeys ?? []), value.measure]
          }
          continue
        }
        anyMapped = true
        rows.push({
          kind: 'indicator', identityKind: 'code', status: publishedNeedsActual(status, value.actual), fromMeasure: true,
          sourceReleaseId: release.releaseId,
          ...(isEstimate ? { rowKind: 'estimate' as const } : {}),
          countryCode: release.country, metricKey, periodKey: period,
          scheduledDate: release.eventDate, scheduledAt: release.at,
          sourceEventId: codeRowIdentity(release, metricKey, period),
          ...(value.previous === undefined ? {} : { previous: value.previous }),
          ...(value.consensus === undefined ? {} : { consensus: value.consensus }),
          ...(value.actual === undefined ? {} : { actual: value.actual })
        })
      }
      // 一个 measure 都没映射上 ≠ 这条发布不存在：它已经记进工作清单，**但读者不该因此看不见它**。
      if (anyMapped) continue
    }

    // —— 二、有期间、没有值：按「发布组主测度」给它一条空值指标行（和官方日程展开同一套规则）——
    if (period !== undefined && period.length > 0 && release.values.length === 0) {
      if (primaryMetric !== undefined) {
        rows.push({
          kind: 'indicator', identityKind: 'code', status: publishedNeedsActual(status, undefined),
          sourceReleaseId: release.releaseId,
          ...(status === 'published' ? { valueState: 'missing' as const } : {}),
          ...(isEstimate ? { rowKind: 'estimate' as const } : {}),
          countryCode: release.country, metricKey: primaryMetric, periodKey: period,
          scheduledDate: release.eventDate, scheduledAt: release.at,
          sourceEventId: codeRowIdentity(release, primaryMetric, period)
        })
        continue
      }
      // 映射表里有这一条的码 → 直接按指标行写（不再写源内身份等转正）。
      if (countryMetric !== undefined) {
        rows.push({
          kind: 'indicator', identityKind: 'code', status: publishedNeedsActual(status, undefined),
          sourceReleaseId: release.releaseId,
          ...(status === 'published' ? { valueState: 'missing' as const } : {}),
          ...(isEstimate ? { rowKind: 'estimate' as const } : {}),
          countryCode: release.country, metricKey: countryMetric, periodKey: period,
          scheduledDate: release.eventDate, scheduledAt: release.at,
          sourceEventId: codeRowIdentity(release, countryMetric, period)
        })
        continue
      }
      // 没有测度依据、但源名登记过事件类型 → 事件型行（照常显示，值区交给「未提供」）。
      if (eventCode !== undefined) {
        rows.push({
          kind: 'event', identityKind: 'code', status: publishedNeedsActual(status, undefined),
          ...(status === 'published' ? { valueState: 'missing' as const } : {}),
          countryCode: release.country, metricKey: eventCode, periodKey: release.at.slice(0, 16),
          scheduledDate: release.eventDate, scheduledAt: release.at, sourceEventId: release.releaseId
        })
        continue
      }
    }

    // —— 三、没有期间（事件型）——
    if (period === undefined || period.length === 0) {
      if (eventCode !== undefined) {
        rows.push({
          kind: 'event', identityKind: 'code', status: publishedNeedsActual(status, first?.actual),
          countryCode: release.country, metricKey: eventCode, periodKey: release.at.slice(0, 16),
          scheduledDate: release.eventDate, scheduledAt: release.at, sourceEventId: release.releaseId,
          timePrecision: 'minute',
          ...(first?.previous === undefined ? {} : { previous: first.previous }),
          ...(first?.consensus === undefined ? {} : { consensus: first.consensus }),
          ...(first?.actual === undefined ? {} : { actual: first.actual })
        })
        continue
      }
      // 连事件类型都没登记：**照样显示**，身份用源内 id。它没有共同身份，所以不参与跨源合并；
      // 记一笔工作清单，补上映射后**原地转正**成标准码，不新增行。
      unmapped.push({ sourceKey: release.releaseId, name: release.name, reason: 'unknown-event-type' })
      rows.push({
        kind: 'event', identityKind: 'source', status, sourceLabel: release.name, seriesId: release.seriesId,
        countryCode: release.country, metricKey: release.releaseId,
        periodKey: release.at.slice(0, 16), scheduledDate: release.eventDate, scheduledAt: release.at,
        sourceEventId: release.releaseId, timePrecision: 'minute',
        ...(release.values.length === 1 ? values : {})
      })
      continue
    }

    // —— 四、有期间、没有值、且没有测度依据也没有事件码：先查映射表，查不到才用源内身份 ——
    if (countryMetric !== undefined) {
      rows.push({
        kind: 'indicator', identityKind: 'code', status: publishedNeedsActual(status, undefined),
        sourceReleaseId: release.releaseId,
        ...(status === 'published' ? { valueState: 'missing' as const } : {}),
        ...(isEstimate ? { rowKind: 'estimate' as const } : {}),
        countryCode: release.country, metricKey: countryMetric, periodKey: period,
        scheduledDate: release.eventDate, scheduledAt: release.at,
        sourceEventId: codeRowIdentity(release, countryMetric, period),
        ...(release.values.length === 1 ? values : {})
      })
      continue
    }
    rows.push({
      kind: 'event', identityKind: 'source', status: publishedNeedsActual(status, undefined), sourceLabel: release.name,
      ...(status === 'published' ? { valueState: 'missing' as const } : {}),
      countryCode: release.country, metricKey: release.releaseId, periodKey: period,
      scheduledDate: release.eventDate, scheduledAt: release.at, sourceEventId: release.releaseId,
      timePrecision: 'minute',
      ...(release.values.length === 1 ? values : {})
    })
  }
  return { rows, unmapped }
}
