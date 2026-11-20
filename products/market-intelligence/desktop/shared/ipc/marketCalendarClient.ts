import { isMarketCalendarFreshness, isMarketCalendarPage, isMarketCalendarQuery, isMarketCalendarRefreshNowResult,
  isMarketCalendarRefreshResult, isMarketCalendarScope, marketCalendarPublicPolicy, type MarketCalendarFreshness,
  type MarketCalendarPage, type MarketCalendarQuery, type MarketCalendarRefreshNowResult,
  type MarketCalendarRefreshResult, type MarketCalendarScope } from '../../../contracts/macro/marketCalendarQueryContracts'
import type { UnmappedCalendarObservation } from '../../../service/intelligence/macro-calendar/rendering/marketCalendarUnmappedMonthRead'
import type {
  CalendarEventIndexRead, CalendarEventIndexRow
} from '../../../service/intelligence/macro-calendar/rendering/marketCalendarEventIndexRead'
import type { MappingRulesRead } from '../../../service/intelligence/macro-calendar/rendering/marketCalendarMappingRulesRead'
import type {
  CalendarEventListRead, CalendarEventRow
} from '../../../service/intelligence/macro-calendar/rendering/marketCalendarEventListRead'
import type {
  EventSourceWritesRead, EventSourceWriteRow
} from '../../../service/intelligence/macro-calendar/rendering/marketCalendarEventSourceWritesRead'
import type {
  CodeTableRead, CodeTableReadRow
} from '../../../service/intelligence/macro-calendar/rendering/marketCalendarCodeTableRead'
/**
 * **数值修订审计的三态**（渲染层只认这四种）：
 * - `recorded`：有记录，带按字段分组的并列条目与「更新于」；
 * - `not-recorded`：历史期次**没有**审计记录（界面写「未记录」）；
 * - `unreadable`：这次读不到（错误态 + 重试，**不许写成「未记录」**）；
 * - `unavailable`：IPC 形状不合或端口未通（同样是错误态）。
 */
export type CalendarValueRevisionEntry = Readonly<{
  field: string
  valueBefore: string | null
  valueAfter: string | null
  decision: string
  providerId: string
  observedAt: string
}>
export type CalendarValueRevisionRead =
  | Readonly<{ state: 'recorded'; revisions: readonly CalendarValueRevisionEntry[]
    byField: Readonly<Record<string, readonly CalendarValueRevisionEntry[]>>
    updatedAt: string | null; latestWriteProviderId: string | null }>
  | Readonly<{ state: 'not-recorded' }>
  | Readonly<{ state: 'unreadable' }>
  | Readonly<{ state: 'unavailable'; reasonCode: 'query-input-invalid' | 'query-unavailable' }>

export type MarketCalendarClient = {
  queryMonth: (input: MarketCalendarQuery) => Promise<MarketCalendarPage>
  refresh: (input: MarketCalendarScope) => Promise<MarketCalendarRefreshResult>
  /** How old the calendar actually is; `unavailable` means "cannot tell", never "nothing". */
  getCollectionFreshness: () => Promise<MarketCalendarFreshness>
  /**
   * 未映射观测（进不了标准表的那批）的月读：**渲染专用，不进简报、不进 AI 分析**。
   *
   * 出参必须能分清「读到空」和「读不到」——`state: 'unavailable'` 是后者，**不许拿空数组顶替**。
   */
  queryUnmappedMonth: (input: Readonly<{ month: string; locale: 'zh-CN' | 'en-US' }>) => Promise<UnmappedMonthView>
  /**
   * 事件目录（一行一个事件身份，渲染专用）：全量清单，按「最近一次发布」倒序。
   *
   * 出参两态：`available` 带 `rows`/`total`/`nextCursor`，`unavailable` 带原因码。
   * **空数组只表示「没有匹配」**，不表示读不到——这一条与未映射月读同一个规矩。
   */
  queryEvents: (input: Readonly<{ cursor?: string; pageSize: number; nameQuery?: string; countryCode?: string }>) => Promise<CalendarEventIndexRead>
  /**
   * 映射规则（源内 id ↔ 我们的指标码）与库里还没映射的 id：**只读、全量下发**。
   * 数据量很小（85 条规则 + 数百个 id），一次给完，前端本地筛选与分页。
   */
  /**
   * 映射规则表。**带 `locale`**（用户 2026-11-21）：未映射那列的国家名与码表同一口径，
   * 英文下是两位代码、全名在 `countryNameFull`；不传则默认 `zh`（向后兼容）。
   */
  queryMappingRules: (input?: Readonly<{ locale?: 'zh' | 'en' }>) => Promise<MappingRulesRead>
  /**
   * 某一期、某个指标身份下**各来源写了什么**（只读，渲染专用）：`#47` 详情分块用。
   *
   * 入参必须带 `scheduledDate`：不带就会拿到这个指标所有月份，几十期混成一块。
   */
  queryEventSourceWrites: (input: Readonly<{ metricKey: string; scheduledDate: string }>) => Promise<EventSourceWritesRead>
  /**
   * **数值修订审计**（只读，渲染专用）：某一格历次被谁在什么时候改成什么。
   * 三态由读口给（有记录 / 没记录 / 读不到），界面只负责分开展示。
   */
  queryValueRevisions: (input: Readonly<{ countryCode: string; metricKey: string
    periodKey: string; firstScheduledDate: string }>) => Promise<CalendarValueRevisionRead>
  /** 码表（只读整表，渲染专用）：一个码一行，带分级 · 口径 · 官网页 · 状态 · 认得它的源内 id 数。 */
  /** 码表整表。`locale` 同上：英文下 Country 列是两位代码（全名在 `countryNameFull`）。 */
  queryCodeTable: (input?: Readonly<{ locale?: 'zh' | 'en' }>) => Promise<CodeTableRead>
  /**
   * **事件清单**（只读、渲染专用）：一行 = 一场事件，不参与映射。
   * 与经济指标分开取数——事件没有统计期，混进未映射表会让人以为它们该建码。
   */
  queryEventList: () => Promise<CalendarEventListRead>
  /** Bounded catch-up: `timeout` is its own answer and is never reported as a failure. */
  refreshNow: (input: Readonly<{ sourceIds?: readonly string[]; timeoutMs?: number }>) => Promise<MarketCalendarRefreshNowResult>
}
export const marketCalendarClient: MarketCalendarClient = {
  async queryMonth(input) {
    if (!isMarketCalendarQuery(input)) return { state: 'unavailable', failureCode: 'input-invalid' }
    const value = await invoke(marketCalendarPublicPolicy.methods.query, input)
    return isMarketCalendarPage(value, input) ? value : { state: 'unavailable', failureCode: 'query-unavailable' }
  },
  async refresh(input) {
    if (!isMarketCalendarScope(input)) return { state: 'unavailable', sources: [], failureCode: 'input-invalid' }
    const value = await invoke(marketCalendarPublicPolicy.methods.refresh, input)
    return isMarketCalendarRefreshResult(value) ? value : { state: 'unavailable', sources: [], failureCode: 'readiness-unavailable' }
  },
  async getCollectionFreshness() {
    const value = await invoke(marketCalendarPublicPolicy.methods.getCollectionFreshness, {})
    return isMarketCalendarFreshness(value) ? value : { state: 'unavailable', failureCode: 'query-unavailable' }
  },
  async queryMappingRules(input) {
    const value = await invoke(marketCalendarPublicPolicy.methods.queryMappingRules,
      input?.locale === undefined ? {} : { locale: input.locale })
    return mappingRulesReadOf(value)
  },
  async queryCodeTable(input) {
    return codeTableReadOf(await invoke(marketCalendarPublicPolicy.methods.queryCodeTable,
      input?.locale === undefined ? {} : { locale: input.locale }))
  },
  async queryEventList() {
    return eventListReadOf(await invoke(marketCalendarPublicPolicy.methods.queryEventList, {}))
  },
  async queryEventSourceWrites(input) {
    const value = await invoke(marketCalendarPublicPolicy.methods.queryEventSourceWrites, {
      metricKey: input.metricKey, scheduledDate: input.scheduledDate
    })
    return eventSourceWritesReadOf(value)
  },  async queryValueRevisions(input) {
    return valueRevisionsReadOf(await invoke(marketCalendarPublicPolicy.methods.queryValueRevisions, {
      countryCode: input.countryCode, metricKey: input.metricKey,
      periodKey: input.periodKey, firstScheduledDate: input.firstScheduledDate
    }))
  },

  async queryEvents(input) {
    return eventIndexReadOf(await invoke(marketCalendarPublicPolicy.methods.queryEvents, input))
  },
  async queryUnmappedMonth(input) {
    const value = await invoke(marketCalendarPublicPolicy.methods.queryUnmappedMonth, { month: input.month, locale: input.locale })
    return unmappedMonthViewOf(value)
  },
  async refreshNow(input) {
    const value = await invoke(marketCalendarPublicPolicy.methods.refreshNow, input)
    return isMarketCalendarRefreshNowResult(value) ? value : { state: 'failed', failureCode: 'readiness-unavailable' }
  }
}
export type UnmappedMonthView =
  | Readonly<{ state: 'available'; items: readonly UnmappedCalendarObservation[]; undated: number; superseded: number }>
  | Readonly<{ state: 'unavailable' }>

async function invoke(method: string, payload: unknown): Promise<unknown> {
  try { return await window.platform?.products?.invoke('market-intelligence', method, payload) } catch { return undefined }
}

/**
 * IPC 回来的一律当 `unknown`：形状不合就判「读不到」，**不许放行半条**给列表——
 * 一条残行会变成一条编出来的日程。`entries` 的类型与读口一致，这里只做运行时校验。
 */
export function unmappedMonthViewOf(value: unknown): UnmappedMonthView {
  if (value === null || typeof value !== 'object') return { state: 'unavailable' }
  const record = value as Record<string, unknown>
  if (record.state !== 'available' || !Array.isArray(record.items)) return { state: 'unavailable' }
  const items: UnmappedCalendarObservation[] = []
  for (const entry of record.items) {
    if (entry === null || typeof entry !== 'object') return { state: 'unavailable' }
    const row = entry as Record<string, unknown>
    if (typeof row.key !== 'string' || row.key === '') return { state: 'unavailable' }
    if (typeof row.providerId !== 'string' || typeof row.sourceKey !== 'string') return { state: 'unavailable' }
    if (typeof row.scheduledDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(row.scheduledDate)) return { state: 'unavailable' }
    if (row.timePrecision !== 'minute' && row.timePrecision !== 'date') return { state: 'unavailable' }
    if (row.timePrecision === 'minute' && (typeof row.scheduledAt !== 'string' || !Number.isFinite(Date.parse(row.scheduledAt)))) return { state: 'unavailable' }
    if (typeof row.title !== 'string' || row.title === '') return { state: 'unavailable' }
    if (row.countryCode !== undefined && typeof row.countryCode !== 'string') return { state: 'unavailable' }
    if (typeof row.reason !== 'string' || typeof row.detectedAt !== 'string') return { state: 'unavailable' }
    items.push(row as unknown as UnmappedCalendarObservation)
  }
  return {
    state: 'available',
    items,
    undated: typeof record.undated === 'number' ? record.undated : 0,
    superseded: typeof record.superseded === 'number' ? record.superseded : 0
  }
}

/**
 * IPC 回来的东西一律当 `unknown`：形状不合就判「读不到」。
 *
 * 与未映射月读同一条边界——**一条残行混进清单就是一条编出来的事件**；而把「读不到」说成
 * 「没有匹配」同样是撒谎。国家这一列只要原码（名字由渲染层那张表补：归一只有一处）。
 */
export function eventIndexReadOf(value: unknown): CalendarEventIndexRead {
  if (value === null || typeof value !== 'object') return { state: 'unavailable', reasonCode: 'query-unavailable' }
  const record = value as Record<string, unknown>
  if (record.state !== 'available' || !Array.isArray(record.rows) || typeof record.total !== 'number') {
    return { state: 'unavailable', reasonCode: 'query-unavailable' }
  }
  for (const entry of record.rows) {
    if (entry === null || typeof entry !== 'object') return { state: 'unavailable', reasonCode: 'query-unavailable' }
    const row = entry as Record<string, unknown>
    if (typeof row.key !== 'string' || row.key === '') return { state: 'unavailable', reasonCode: 'query-unavailable' }
    if (typeof row.countryCode !== 'string' || row.countryCode === '') return { state: 'unavailable', reasonCode: 'query-unavailable' }
    if (typeof row.titleIsSourceLabel !== 'boolean') return { state: 'unavailable', reasonCode: 'query-unavailable' }
    if (row.importance !== undefined && !['high', 'medium', 'low'].includes(String(row.importance))) {
      return { state: 'unavailable', reasonCode: 'query-unavailable' }
    }
  }
  return {
    state: 'available',
    rows: record.rows as unknown as readonly CalendarEventIndexRow[],
    total: record.total,
    ...(typeof record.nextCursor === 'string' ? { nextCursor: record.nextCursor } : {})
  }
}

/** IPC 形状不合就判「读不到」：一份缺字段的规则表会让人以为「没有这条规则」。 */
export function mappingRulesReadOf(value: unknown): MappingRulesRead {
  if (value === null || typeof value !== 'object') return { state: 'unavailable', reasonCode: 'query-unavailable' }
  const record = value as Record<string, unknown>
  if (record.state !== 'available' || !Array.isArray(record.mapped) || !Array.isArray(record.unmapped)) {
    return { state: 'unavailable', reasonCode: 'query-unavailable' }
  }
  /**
   * 已映射：**一个码一行**（用户 2026-11-17 合并两个页签）。`sourceIds` 是字符串数组——空数组表示
   * 「它本来就是码身份进来的」，不是读失败；`periodRule` 可以为 `null`（没有规则）。
   */
  for (const entry of record.mapped) {
    if (entry === null || typeof entry !== 'object') return { state: 'unavailable', reasonCode: 'query-unavailable' }
    const row = entry as Record<string, unknown>
    if (typeof row.metricKey !== 'string' || row.metricKey === '') return { state: 'unavailable', reasonCode: 'query-unavailable' }
    if (!Array.isArray(row.sourceIds) || row.sourceIds.some((id) => typeof id !== 'string' || id === '')) {
      return { state: 'unavailable', reasonCode: 'query-unavailable' }
    }
    if (row.periodRule !== null && typeof row.periodRule !== 'string') {
      return { state: 'unavailable', reasonCode: 'query-unavailable' }
    }
    if (typeof row.rowCount !== 'number') return { state: 'unavailable', reasonCode: 'query-unavailable' }
    // 层级字段可缺（旧载荷没有）；有就必须自洽——否则界面会画出一个不属于任何母项的子项。
    if (row.kind !== undefined && row.kind !== 'parent' && row.kind !== 'child') {
      return { state: 'unavailable', reasonCode: 'query-unavailable' }
    }
    if (row.parentMetricKey !== undefined && row.parentMetricKey !== null
      && (typeof row.parentMetricKey !== 'string' || row.parentMetricKey === '')) {
      return { state: 'unavailable', reasonCode: 'query-unavailable' }
    }
    if (row.childOrder !== undefined && (typeof row.childOrder !== 'number' || !Number.isInteger(row.childOrder))) {
      return { state: 'unavailable', reasonCode: 'query-unavailable' }
    }
    // `names` 是名称格里的唯一来源：形状不对就别放行，否则格子会拼出半句。
    if (row.names !== undefined && row.names !== null) {
      const names = row.names as { zh?: unknown; en?: unknown }
      if (typeof names.zh !== 'string' || typeof names.en !== 'string') {
        return { state: 'unavailable', reasonCode: 'query-unavailable' }
      }
    }
  }
  /** 未映射：仍是**源内 id 一行**（它没有码，只有 id）。 */
  for (const entry of record.unmapped) {
    if (entry === null || typeof entry !== 'object') return { state: 'unavailable', reasonCode: 'query-unavailable' }
    const row = entry as Record<string, unknown>
    if (typeof row.sourceId !== 'string' || row.sourceId === '') return { state: 'unavailable', reasonCode: 'query-unavailable' }
    if (typeof row.rowCount !== 'number') return { state: 'unavailable', reasonCode: 'query-unavailable' }
  }
  if (record.counts === null || typeof record.counts !== 'object') return { state: 'unavailable', reasonCode: 'query-unavailable' }
  return record as unknown as MappingRulesRead
}

/**
 * 各来源写入/观测的形状守卫：**半份数据放行比读不到更糟**——少一行来源，读者会以为「只有一家在报」。
 * 值允许 `null`（＝这一家没给），但字段必须在；`source` 只认两个值。
 */
export function eventSourceWritesReadOf(value: unknown): EventSourceWritesRead {
  const unavailable = { state: 'unavailable', reasonCode: 'query-unavailable' } as const
  if (value === null || typeof value !== 'object') return unavailable
  const record = value as Record<string, unknown>
  if (record.state === 'unavailable') {
    const reason = record.reasonCode
    return reason === 'query-input-invalid' || reason === 'query-unavailable'
      ? { state: 'unavailable', reasonCode: reason }
      : unavailable
  }
  if (record.state !== 'available' || !Array.isArray(record.rows)) return unavailable
  const rows: EventSourceWriteRow[] = []
  for (const entry of record.rows) {
    if (entry === null || typeof entry !== 'object') return unavailable
    const row = entry as Record<string, unknown>
    if (row.source !== 'revision' && row.source !== 'observation') return unavailable
    for (const field of ['providerId', 'observedAt', 'status', 'identityKey'] as const) {
      if (typeof row[field] !== 'string' || (row[field] as string) === '') return unavailable
    }
    for (const field of ['consensus', 'actual', 'previous'] as const) {
      if (row[field] !== null && typeof row[field] !== 'string') return unavailable
    }
    if (row.periodKey !== undefined && typeof row.periodKey !== 'string') return unavailable
    rows.push({
      ...(typeof row.periodKey === 'string' ? { periodKey: row.periodKey } : {}),
      source: row.source as EventSourceWriteRow['source'],
      providerId: row.providerId as string,
      observedAt: row.observedAt as string,
      status: row.status as string,
      consensus: row.consensus as string | null,
      actual: row.actual as string | null,
      previous: row.previous as string | null,
      identityKey: row.identityKey as string
    })
  }
  return {
    state: 'available',
    metricKey: String(record.metricKey ?? ''),
    rows,
    providerCount: rows.length === 0 ? 0 : new Set(rows.map((row) => row.providerId)).size,
    hasRevisionChain: rows.some((row) => row.source === 'revision')
  }
}

/**
 * 码表的形状守卫：**半份数据放行比读不到更糟**——少一行，读者会以为那个码不存在。
 *
 * 官网页两种形态都必须自洽：要么是机构页（`url` + 机构 + 依据齐全），要么是「待补 + 闭集理由」；
 * 出现 `pending` 却带 `url`、或者两者都没有，一律判读不到——**绝不放一个空链接过去**。
 */
export function codeTableReadOf(value: unknown): CodeTableRead {
  const unavailable = { state: 'unavailable', reasonCode: 'query-unavailable' } as const
  if (value === null || typeof value !== 'object') return unavailable
  const record = value as Record<string, unknown>
  if (record.state !== 'available' || !Array.isArray(record.rows)) return unavailable
  const rows: CodeTableReadRow[] = []
  for (const entry of record.rows) {
    if (entry === null || typeof entry !== 'object') return unavailable
    const row = entry as Record<string, unknown>
    if (typeof row.code !== 'string' || row.code === '') return unavailable
    if (row.kind !== 'metric' && row.kind !== 'event') return unavailable
    if (!['active', 'not-built', 'pending', 'retired'].includes(String(row.status))) return unavailable
    if (typeof row.sourceIdCount !== 'number' || !Number.isInteger(row.sourceIdCount) || row.sourceIdCount < 0) {
      return unavailable
    }
    // 国家现在**必填**（读口一定给）：缺字段或类型不对一律判读不到，不允许渲染层兜底。
    for (const field of ['countryCode', 'countryName'] as const) {
      if (row[field] !== null && typeof row[field] !== 'string') return unavailable
    }
    if (!Object.hasOwn(row, 'countryCode') || !Object.hasOwn(row, 'countryName')) return unavailable
    const names = row.names as { zhFull?: unknown; enFull?: unknown } | null
    if (names === null || typeof names !== 'object'
      || typeof names.zhFull !== 'string' || typeof names.enFull !== 'string') return unavailable
    const source = row.officialSource as Record<string, unknown> | null
    if (source === null || typeof source !== 'object') return unavailable
    if (source.pending === true) {
      if (typeof source.reason !== 'string' || source.reason === '') return unavailable
      if (source.url !== undefined) return unavailable
    } else {
      for (const field of ['agency', 'url', 'basis'] as const) {
        if (typeof source[field] !== 'string' || (source[field] as string) === '') return unavailable
      }
    }
    rows.push(row as unknown as CodeTableReadRow)
  }
  const counts = record.counts as Record<string, unknown> | null
  if (counts === null || typeof counts !== 'object') return unavailable
  if (typeof counts.total !== 'number' || typeof counts.metric !== 'number') return unavailable
  return { state: 'available', rows, counts: counts as unknown as Extract<CodeTableRead, { state: 'available' }>['counts'] }
}

/**
 * 事件清单的形状守卫：**只放行真事件**。
 *
 * 两处必须挡住：`eventType` 必须是那两档事件（混进经济指标等于把「不需要映射」这句话作废），
 * `scheduledDate` 必须是日期串（时间列没有它就是空白格，读者以为没排期）。
 * 其它可空字段（国家、标题、时刻）**允许 `null`**——那是「源没给」，不是坏载荷。
 */
export function eventListReadOf(value: unknown): CalendarEventListRead {
  const unavailable = { state: 'unavailable', reasonCode: 'query-unavailable' } as const
  if (value === null || typeof value !== 'object') return unavailable
  const record = value as Record<string, unknown>
  if (record.state !== 'available' || !Array.isArray(record.rows)) return unavailable
  const rows: CalendarEventRow[] = []
  for (const entry of record.rows) {
    if (entry === null || typeof entry !== 'object') return unavailable
    const row = entry as Record<string, unknown>
    if (typeof row.key !== 'string' || row.key === '') return unavailable
    if (row.eventType !== 'central-bank-activity' && row.eventType !== 'financial-event') return unavailable
    if (typeof row.scheduledDate !== 'string' || row.scheduledDate === '') return unavailable
    if (typeof row.sourceProviderId !== 'string' || row.sourceProviderId === '') return unavailable
    if (typeof row.status !== 'string' || row.status === '') return unavailable
    for (const field of ['scheduledAt', 'countryCode', 'countryName', 'title', 'titleEn'] as const) {
      if (row[field] !== null && typeof row[field] !== 'string') return unavailable
    }
    rows.push(row as unknown as CalendarEventRow)
  }
  if (typeof record.total !== 'number' || record.total !== rows.length) return unavailable
  return { state: 'available', rows, total: rows.length }
}

/**
 * 数值修订审计的形状守卫：**三态不许压成两态**。
 *
 * `recorded` 要带 `revisions`；`not-recorded` 是「历史期次没有记录」；`unreadable` 是「这次读不到」——
 * 后两者若都返回空数组，读者就分不清是没记录还是读失败。形状不合一律判读不到（留错误态）。
 */
export function valueRevisionsReadOf(value: unknown): CalendarValueRevisionRead {
  if (value === null || typeof value !== 'object') return { state: 'unavailable', reasonCode: 'query-unavailable' }
  const record = value as Record<string, unknown>
  if (record.state === 'unreadable') return { state: 'unreadable' }
  if (record.state === 'not-recorded') return { state: 'not-recorded' }
  if (record.state !== 'recorded' || !Array.isArray(record.revisions)) {
    return { state: 'unavailable', reasonCode: 'query-unavailable' }
  }
  const byField = record.byField !== null && typeof record.byField === 'object'
    ? record.byField as Record<string, readonly CalendarValueRevisionEntry[]> : {}
  return {
    state: 'recorded',
    revisions: record.revisions as readonly CalendarValueRevisionEntry[],
    byField,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : null,
    latestWriteProviderId: typeof record.latestWriteProviderId === 'string' ? record.latestWriteProviderId : null
  }
}
