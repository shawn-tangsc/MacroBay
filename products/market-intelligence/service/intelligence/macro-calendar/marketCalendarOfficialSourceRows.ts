import type { DatabaseSync } from 'node:sqlite'

import type { MacroCalendarRevision } from './macroCalendarContracts'
import { macroCalendarReleaseValueMappings } from './macroCalendarReleaseValueMappingPolicy'
import { nameByMetricKey } from './marketCalendarCodeNames'
import { dualWriteMeasureRows } from './marketCalendarStandardDualWrite'
import type { CalendarReleaseStatus } from './marketCalendarStandardTable'

/**
 * 官方发布（Fed / BLS / BEA）也写进标准表——**先以 `source` 身份**。
 *
 * 为什么不等映射表：官方发布现在压根不在标准表里，切读侧那天 CPI、非农、FOMC 会直接消失。
 * 先按源内身份写进去，读者一条不少；等「官方发布键 → 标准码」的映射到位，
 * `promoteSourceIdentities` 按 `source_event_id` **原地转正**并与市场行合并，不用重写历史。
 *
 * 三条口径：
 * 1. 身份 = 源内发布键（`US.CPI.RELEASE.2026-M10` 这种），**不编码、不猜码**；
 * 2. `source_label` 存源的名称键（`eventNameKey`）——官方事件的标题本来就由这个键解析给读者，
 *    和 Narwhal 那些「源原文名」是同一件事：**读者看到的是源怎么叫它**；
 * 3. 状态从源的生命周期映射到闭集，认不出的落 `unknown`，**不按日期推**。
 */
/**
 * 官方期间写法 → 标准期间写法：`2026-M10` → `2026-10`，季度 `2026-Q3` 原样。
 * 这不是「算期间」，是把同一期间换一种写法——不换的话官方行和市场行永远合不成一行。
 */
export function normalizeOfficialPeriodKey(periodKey: string): string {
  const month = /^(\d{4})-M(\d{2})$/.exec(periodKey)
  return month === null ? periodKey : `${month[1]}-${month[2]}`
}

/**
 * 官方 revision 的国家码是 `US`，标准表用的是 `USA`（市场源就这么写）。
 * **不统一就永远合不成一行**：同一发布会以两个国家码各存一行，日历上看着像两条，
 * 而折叠规则也按 (国家, 指标, 期间) 分组，同样合不到一起。
 */
export function normalizeOfficialCountryCode(countryCode: string): string {
  return countryCode === 'US' ? 'USA' : countryCode
}

/** 这条官方发布对应的标准码；拼不出来就是 `undefined`（**不许猜**）。 */
export function officialMetricKeyFor(eventKey: string): string | undefined {
  const mapping = macroCalendarReleaseValueMappings.find((row) => eventKey.startsWith(row.eventKeyPrefix))
  if (mapping === undefined) return undefined
  // 码在名表里还没有条目时也不硬写进去：写进去会被当成未知码退回工作清单，读者就看不见了。
  // 这时退回源内身份——**先让读者看到**，等名称补上，转正入口会把它原地改成标准码。
  return nameByMetricKey[mapping.metricKey] === undefined ? undefined : mapping.metricKey
}

export function officialLifecycleToReleaseStatus(state: MacroCalendarRevision['lifecycleState']): CalendarReleaseStatus {
  return state === 'released' ? 'published' : state === 'scheduled' ? 'scheduled' : state === 'cancelled' ? 'cancelled' : 'unknown'
}

/** 一次官方月查询的结果 → 标准表的行（一家源一批，身份各算各的）。 */
export function officialRevisionsToSourceRows(revisions: readonly MacroCalendarRevision[]) {
  return revisions.map((revision) => {
    const metricKey = officialMetricKeyFor(revision.eventKey)
    return {
    kind: 'event' as const,
    identityKind: metricKey === undefined ? 'source' as const : 'code' as const,
    status: officialLifecycleToReleaseStatus(revision.lifecycleState),
    sourceLabel: revision.eventNameKey,
    // 官方的 revision 自己带重要性（今天恒 high），照搬，不在这里另判。
    importance: revision.importance,
    countryCode: normalizeOfficialCountryCode(revision.countryCode),
    metricKey: metricKey ?? revision.eventKey,
    periodKey: metricKey === undefined ? revision.periodKey : normalizeOfficialPeriodKey(revision.periodKey),
    scheduledDate: revision.scheduledDate,
    ...(revision.scheduledAt === undefined ? {} : { scheduledAt: revision.scheduledAt }),
    timePrecision: revision.scheduledAt === undefined ? 'date' as const : 'minute' as const,
    sourceEventId: revision.eventKey,
    ...(revision.previous === undefined ? {} : { previous: revision.previous.displayValue }),
    ...(revision.consensus === undefined ? {} : { consensus: revision.consensus.displayValue }),
    ...(revision.actual === undefined ? {} : { actual: revision.actual.displayValue })
    }
  })
}

/**
 * 按源分批写：一条 revision 一个身份；同一批里同一家源一个 `providerId`。
 * 返回写入条数与失败条数（失败不拖停别的源）。
 */
export function writeOfficialSourceRows(database: DatabaseSync, input: Readonly<{
  revisions: readonly MacroCalendarRevision[]
  observedAt: string
  parserVersion: string
  onError?: (message: string) => void
}>): Readonly<{ written: number; failed: number }> {
  const byProvider = new Map<string, ReturnType<typeof officialRevisionsToSourceRows>>()
  for (const revision of input.revisions) {
    const rows = byProvider.get(revision.providerId) ?? []
    rows.push(...officialRevisionsToSourceRows([revision]))
    byProvider.set(revision.providerId, rows)
  }
  let written = 0
  let failed = 0
  for (const [providerId, rows] of byProvider) {
    if (rows.length === 0) continue
    const counts = dualWriteMeasureRows(database, {
      providerId, parserVersion: input.parserVersion, observedAt: input.observedAt, rows
    }, input.onError === undefined ? undefined : { onError: input.onError })
    written += counts.written
    failed += counts.failed
  }
  return { written, failed }
}

/**
 * 把官方（Fed/BLS/BEA）某几个月写进标准表：**启动时跑一次**，之后每次官方发布刷新完也可以再跑。
 *
 * 为什么不挂在 Narwhal 采集里：官方与市场是两条采集线，谁先跑谁后跑不该决定读者看到什么。
 * 这里按「月份」读仓库的**当前有效版本**（`listEffectiveMonthAsOf`），幂等写法：同一发布键
 * 再写就是更新，不新增行。
 */
export function syncOfficialStandardRows(database: DatabaseSync, input: Readonly<{
  listEffectiveMonthAsOf: (query: { monthStart: string; monthEndExclusive: string; asOf: string; limit: number }) => MacroCalendarRevision[]
  months: readonly string[]
  asOf: string
  parserVersion: string
  limit?: number
  onError?: (message: string) => void
}>): Readonly<{ revisions: number; written: number; failed: number }> {
  let revisions = 0
  let written = 0
  let failed = 0
  for (const month of input.months) {
    const monthStart = `${month}-01T00:00:00.000Z`
    const monthEndExclusive = `${nextMonthKey(month)}-01T00:00:00.000Z`
    const rows = input.listEffectiveMonthAsOf({ monthStart, monthEndExclusive, asOf: input.asOf,
      limit: input.limit ?? 200 })
    revisions += rows.length
    const counts = writeOfficialSourceRows(database, { revisions: rows, observedAt: input.asOf,
      parserVersion: input.parserVersion, ...(input.onError === undefined ? {} : { onError: input.onError }) })
    written += counts.written
    failed += counts.failed
  }
  return { revisions, written, failed }
}

function nextMonthKey(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year!, (monthNumber ?? 1) - 1, 1))
  date.setUTCMonth(date.getUTCMonth() + 1)
  return date.toISOString().slice(0, 7)
}
