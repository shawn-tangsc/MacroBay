import type { DatabaseSync } from 'node:sqlite'

import { narwhalCanonicalIdentityKey } from './marketCalendarMetricIdentity'
import { eventCodeBySourceType } from './marketCalendarEventCodeTable'
import { nameByMetricKey } from './marketCalendarCodeNames'

/** 事件型身份的第二段：不是指标码，`evt.*` 映射还没接。 */
const EVENT_KINDS: readonly string[] = ['central-bank-activity', 'financial-event']
import { calendarStandardTablePolicy, findCalendarStandardRowBySource, promoteCalendarStandardRowToCode,
  recordCalendarSourceId, recordCalendarUnmapped, upsertCalendarStandardRow,
  type CalendarIdentityKind, type CalendarReleaseStatus, type CalendarUnmappedReason } from './marketCalendarStandardTable'

/**
 * 观测行 → 标准行的**双写**（S1：只写不读，读取路径一个字节不动）。
 *
 * 三条边界：
 * 1. 身份解析成功 → upsert 标准行（`values_json` 覆盖，首发布两列与 `first_seen_at` 冻结）；
 * 2. 解析失败 → 写 `unmapped` + `reason`（闭集），**不进日历**；
 * 3. **任何失败都不许拖停采集**：写标准表失败只记日志 + 计数，旧路径照走。
 *
 * 「写标准表失败」与「映射不上」是两件事，分开计数——前者说明代码/存储有问题，
 * 后者说明缺映射，混成一个数就没法判断该修哪边。
 */
export type DualWriteCounts = Readonly<{
  written: number
  unmapped: Readonly<Record<CalendarUnmappedReason, number>>
  failed: number
  /**
   * 同一身份、同一天被**两份不同发布**写进来的次数（源重发）。
   * 不算失败也不算丢行：值取并集（空值不覆盖有值）、两个 `source_event_id` 都留在映射表里。
   * 但**必须数出来**——今天能合，明天换个期次就可能露出来。
   */
  mergedSameDay: number
}>

/**
 * **按 measure 拆行**的写入（S1 正式路径）：一次发布里的每个 measure 各一行，身份各算各的。
 * （旧形状回放那条 `dualWriteObservationBatch` 已删除：全仓 0 个生产调用者、且没有零值判据，
 * 留着就是绕过零值规则的第二个写入入口。）
 */
export function dualWriteMeasureRows(
  database: DatabaseSync,
  input: Readonly<{ providerId: string; parserVersion: string; observedAt: string
    rows: readonly Readonly<{ countryCode: string; metricKey: string; periodKey: string
      scheduledDate: string
      /** 源没给时刻就**不写**（`time_precision = 'date'`）——绝不推算一个「惯例的 8:30」。 */
      scheduledAt?: string
      sourceEventId: string
      timePrecision?: 'minute' | 'date'
      rowKind?: 'release' | 'estimate'
      identityKind?: CalendarIdentityKind
      /** `source` 身份行要带源原文名（标准码去名表查，源内 id 查不到）。 */
      sourceLabel?: string
      /** 源的 series_id（转正时重算身份用）。 */
      seriesId?: string
      /** 源给的重要性；没有就不写（读侧显示「未分级」）。 */
      importance?: 'high' | 'medium' | 'low'
      status?: CalendarReleaseStatus
      /** 由值自己算出来：有 actual/previous/consensus 之一即 present。 */
      valueState?: 'present' | 'missing'
      previous?: string; consensus?: string; actual?: string }>[] }>,
  options?: Readonly<{ onError?: (message: string) => void }>
): DualWriteCounts {
  const reasons = emptyReasons()
  let written = 0
  let failed = 0
  let mergedSameDay = 0
  for (const row of input.rows) {
    try {
      // 源内身份的行没有标准码可查：它是「源里确实有这次发布」，不是缺映射。
      const isSourceIdentity = row.identityKind === 'source'
      const isEventCode = row.metricKey.startsWith('evt.')
      if (!isSourceIdentity && !isEventCode && nameByMetricKey[row.metricKey] === undefined) {
        reasons['unknown-measure'] += 1
        recordCalendarUnmapped(database, { providerId: input.providerId, sourceKey: row.sourceEventId,
          detectedAt: input.observedAt, rawJson: JSON.stringify({ metricKey: row.metricKey }), reason: 'unknown-measure' })
        continue
      }
      const existing = findCalendarStandardRowBySource(database, {
        sourceProviderId: input.providerId, sourceEventId: row.sourceEventId
      })
      // 同身份同日的**另一份发布**：先数出来再写（值取并集、两个 id 都留痕）。
      if (existing === undefined) {
        const collision = database.prepare(`select source_event_id from ${calendarStandardTablePolicy.eventsTable}
          where country_code = ? and metric_key = ? and period_key = ? and first_scheduled_date = ?
            and source_event_id <> ? limit 1`)
          .get(row.countryCode, row.metricKey, row.periodKey, row.scheduledDate, row.sourceEventId) as
          { source_event_id: string } | undefined
        if (collision !== undefined) mergedSameDay += 1
      }
      /**
       * **空值不写、占位 0 当缺失、真 0 照写**（用户口径 2026-11-15）。
       *
       * 判据必须落在这一处：字段缺席 / 空串 → 不写（不清空已有值）；值是 0 且该来源这一行还没发布
       * （`status !== 'published'`）→ 当成占位，不写；**已发布行的 0 是合法值**（新增就业 0K、
       * 环比 0.0%），照常写入——否则真实的零增长永远显示成「未提供」。
       */
      const existingValues = existing === undefined ? {} : readValuesJson(database, existing)
      const writable = {
        // 状态门只作用于 `actual`：只有「这一行还没发布却带了实际值」才是占位。
        // `previous` / `consensus` 在未发布行上是**已知真值**（上一期 0K、预期 0.0%），
        // 把它们也塞进状态门，会把「预期 0.0%」这种最常见的情况丢掉。
        actual: writableActual(row.actual, row.status, existingValues.actual),
        previous: writableValue(row.previous, existingValues.previous),
        consensus: writableValue(row.consensus, existingValues.consensus)
      }
      // **原地转正**：原来用源内 id 撑着的那一行，现在有标准码了 → 改这一行的码，不新增行。
      if (existing !== undefined && existing.identityKind === 'source' && row.identityKind !== 'source'
        && existing.metricKey !== row.metricKey) {
        promoteCalendarStandardRowToCode(database, { sourceProviderId: input.providerId,
          sourceEventId: row.sourceEventId, metricKey: row.metricKey })
      }
      upsertCalendarStandardRow(database, {
        countryCode: row.countryCode, metricKey: row.metricKey, periodKey: row.periodKey,
        scheduledDate: row.scheduledDate,
        ...(row.scheduledAt === undefined ? {} : { scheduledAt: row.scheduledAt }),
        ...(existing === undefined ? {} : { firstScheduledDate: existing.firstScheduledDate }),
        timePrecision: row.timePrecision ?? (row.scheduledAt === undefined || row.scheduledAt.endsWith('T00:00:00.000Z') ? 'date' : 'minute'),
        ...(row.rowKind === undefined ? {} : { rowKind: row.rowKind }),
        ...(row.status === undefined ? {} : { status: row.status }),
        ...(row.identityKind === undefined ? {} : { identityKind: row.identityKind }),
        ...(row.sourceLabel === undefined ? {} : { sourceLabel: row.sourceLabel }),
        ...(row.seriesId === undefined ? {} : { seriesId: row.seriesId }),
        ...(row.importance === undefined ? {} : { importance: row.importance }),
        // **由这份值本身算**，不从调用方传：物化列一旦允许调用方随便传，就会漂。
        valueState: writable.actual === undefined && writable.previous === undefined && writable.consensus === undefined
          ? 'missing' as const : 'present' as const,
        valuesJson: JSON.stringify({
          ...(writable.consensus === undefined ? {} : { consensus: writable.consensus }),
          ...(writable.previous === undefined ? {} : { previous: writable.previous }),
          ...(writable.actual === undefined ? {} : { actual: writable.actual })
        }),
        sourceProviderId: input.providerId, sourceEventId: row.sourceEventId,
        parserVersion: input.parserVersion, observedAt: input.observedAt, firstSeenAt: input.observedAt,
        ...(row.actual === undefined ? {} : { firstPublishedActual: row.actual }),
        ...(row.previous === undefined ? {} : { firstPublishedPrevious: row.previous })
      })
      // 记下「这次发布落到了哪一行」：同一行被源重发时前一个 id 会被覆盖，
      // 但溯源清单要能查到每一次发布。
      recordCalendarSourceId(database, { providerId: input.providerId, sourceEventId: row.sourceEventId,
        countryCode: row.countryCode, metricKey: row.metricKey, periodKey: row.periodKey,
        firstScheduledDate: existing?.firstScheduledDate ?? row.scheduledDate, observedAt: input.observedAt })
      written += 1
    } catch (error) {
      failed += 1
      options?.onError?.((error as Error)?.message ?? 'unknown')
    }
  }
  return { written, unmapped: reasons, failed, mergedSameDay }
}

/** 观测行的最小形状（draft 与已落库行都能满足）。 */
type ObservationLike = Readonly<{
  marketFactKey: string
  kind?: string
  displayName?: string
  countryCode?: string
  scheduledAt?: string
  scheduledDate?: string
  consensus?: Readonly<{ displayValue: string }>
  providerPrevious?: Readonly<{ displayValue: string }>
  providerActual?: Readonly<{ displayValue: string }>
}>

/**
 * 字段缺席 / 空串 → 不写；**零值不覆盖已有的非空值**。
 *
 * 用户口径原话是「空值、零值不覆盖实际有的值」，而「真实的 0 是合法值」（新增就业 0K、环比 0.0%）：
 * 两者合起来就是——**没有既有值时，真 0 照写；已经有非空值时，0 不许把它盖掉**。
 * 来源的 `status` 只用来判「这一行还没发布」：未发布却带 0 的，按占位处理，不写。
 */
/** 非实际值字段（`previous` / `consensus`）：缺席与空串不写；零值不许盖掉已有非空值。 */
function writableValue(value: string | undefined, existing: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') return undefined
  if (!isZeroValue(value)) return value
  return existing === undefined || existing.trim() === '' ? value : undefined
}

/** 实际值：在上一行规则之外，**未发布行的 0 视为占位**（这一行还没有实际值可言）。 */
function writableActual(value: string | undefined, status: CalendarReleaseStatus | undefined,
  existing: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') return undefined
  if (isZeroValue(value) && status !== undefined && status !== 'published' && status !== 'unknown') return undefined
  return writableValue(value, existing)
}

/** 已有行里的值（逐字段合并前用来判断「零值会不会盖掉真值」）。 */
function readValuesJson(database: DatabaseSync, existing: Readonly<{ countryCode: string; metricKey: string
  periodKey: string; firstScheduledDate: string }>): Readonly<Record<string, string | undefined>> {
  try {
    const row = database.prepare(`select values_json from ${calendarStandardTablePolicy.eventsTable}
      where country_code = ? and metric_key = ? and period_key = ? and first_scheduled_date = ? limit 1`)
      .get(existing.countryCode, existing.metricKey, existing.periodKey, existing.firstScheduledDate) as
      { values_json: string } | undefined
    return row === undefined ? {} : JSON.parse(row.values_json) as Record<string, string | undefined>
  } catch { return {} }
}

/** `0` / `0.0` / `-0%` 这类：数值上是零，但要靠发布状态区分真零与占位零。 */
function isZeroValue(value: string): boolean {
  const numeric = Number(value.replace(/[%+,]/g, ''))
  return Number.isFinite(numeric) && numeric === 0
}

const emptyReasons = (): Record<CalendarUnmappedReason, number> =>
  ({ 'unknown-measure': 0, 'unknown-event-type': 0, 'bad-period': 0, 'bad-identity': 0,
    'unknown-release-group': 0, 'ambiguous-same-day': 0, 'no-values': 0 })
