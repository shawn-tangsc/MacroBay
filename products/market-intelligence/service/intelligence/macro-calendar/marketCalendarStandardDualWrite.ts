import type { DatabaseSync } from 'node:sqlite'

import { narwhalCanonicalIdentityKey } from './marketCalendarMetricIdentity'
import { eventCodeBySourceType } from './marketCalendarEventCodeTable'
import { nameByMetricKey } from './marketCalendarCodeNames'

/** 事件型身份的第二段：不是指标码，`evt.*` 映射还没接。 */
const EVENT_KINDS: readonly string[] = ['central-bank-activity', 'financial-event']
import { calendarStandardTablePolicy, findCalendarStandardRowBySource, promoteCalendarStandardRowToCode,
  recordCalendarUnmapped, upsertCalendarStandardRow,
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
}>

/**
 * **按 measure 拆行**的写入（S1 正式路径）：一次发布里的每个 measure 各一行，身份各算各的。
 * 观测草稿那条 `dualWriteObservationBatch` 保留给「从旧形状回放」的对账用，**日常采集走这条**。
 */
export function dualWriteMeasureRows(
  database: DatabaseSync,
  input: Readonly<{ providerId: string; parserVersion: string; observedAt: string
    rows: readonly Readonly<{ countryCode: string; metricKey: string; periodKey: string
      scheduledDate: string; scheduledAt: string; sourceEventId: string
      timePrecision?: 'minute' | 'date'
      rowKind?: 'release' | 'estimate'
      identityKind?: CalendarIdentityKind
      /** `source` 身份行要带源原文名（标准码去名表查，源内 id 查不到）。 */
      sourceLabel?: string
      /** 源的 series_id（转正时重算身份用）。 */
      seriesId?: string
      status?: CalendarReleaseStatus
      /** 由值自己算出来：有 actual/previous/consensus 之一即 present。 */
      valueState?: 'present' | 'missing'
      previous?: string; consensus?: string; actual?: string }>[] }>,
  options?: Readonly<{ onError?: (message: string) => void }>
): DualWriteCounts {
  const reasons = emptyReasons()
  let written = 0
  let failed = 0
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
      // **原地转正**：原来用源内 id 撑着的那一行，现在有标准码了 → 改这一行的码，不新增行。
      if (existing !== undefined && existing.identityKind === 'source' && row.identityKind !== 'source'
        && existing.metricKey !== row.metricKey) {
        promoteCalendarStandardRowToCode(database, { sourceProviderId: input.providerId,
          sourceEventId: row.sourceEventId, metricKey: row.metricKey })
      }
      upsertCalendarStandardRow(database, {
        countryCode: row.countryCode, metricKey: row.metricKey, periodKey: row.periodKey,
        scheduledDate: row.scheduledDate, scheduledAt: row.scheduledAt,
        ...(existing === undefined ? {} : { firstScheduledDate: existing.firstScheduledDate }),
        timePrecision: row.timePrecision ?? (row.scheduledAt.endsWith('T00:00:00.000Z') ? 'date' : 'minute'),
        ...(row.rowKind === undefined ? {} : { rowKind: row.rowKind }),
        ...(row.status === undefined ? {} : { status: row.status }),
        ...(row.identityKind === undefined ? {} : { identityKind: row.identityKind }),
        ...(row.sourceLabel === undefined ? {} : { sourceLabel: row.sourceLabel }),
        ...(row.seriesId === undefined ? {} : { seriesId: row.seriesId }),
        // **由这份值本身算**，不从调用方传：物化列一旦允许调用方随便传，就会漂。
        valueState: row.actual === undefined && row.previous === undefined && row.consensus === undefined
          ? 'missing' as const : 'present' as const,
        valuesJson: JSON.stringify({
          ...(row.consensus === undefined ? {} : { consensus: row.consensus }),
          ...(row.previous === undefined ? {} : { previous: row.previous }),
          ...(row.actual === undefined ? {} : { actual: row.actual })
        }),
        sourceProviderId: input.providerId, sourceEventId: row.sourceEventId,
        parserVersion: input.parserVersion, observedAt: input.observedAt, firstSeenAt: input.observedAt,
        ...(row.actual === undefined ? {} : { firstPublishedActual: row.actual }),
        ...(row.previous === undefined ? {} : { firstPublishedPrevious: row.previous })
      })
      written += 1
    } catch (error) {
      failed += 1
      options?.onError?.((error as Error)?.message ?? 'unknown')
    }
  }
  return { written, unmapped: reasons, failed }
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

const emptyReasons = (): Record<CalendarUnmappedReason, number> =>
  ({ 'unknown-measure': 0, 'unknown-event-type': 0, 'bad-period': 0, 'bad-identity': 0,
    'unknown-release-group': 0, 'ambiguous-same-day': 0, 'no-values': 0 })

export function dualWriteObservationBatch(
  database: DatabaseSync,
  batch: Readonly<{ providerId: string; parserVersion: string; observedAt: string
    drafts: readonly ObservationLike[] }>,
  options?: Readonly<{ onError?: (message: string) => void }>
): DualWriteCounts {
  const reasons = emptyReasons()
  let written = 0
  let failed = 0
  for (const draft of batch.drafts) {
    try {
      const identity = narwhalCanonicalIdentityKey(String(draft.marketFactKey))
      const parts = identity?.split('|') ?? []
      if (identity === undefined || parts.length !== 3) {
        reasons['bad-identity'] += 1
        recordCalendarUnmapped(database, { providerId: batch.providerId, sourceKey: String(draft.marketFactKey),
          detectedAt: batch.observedAt, rawJson: JSON.stringify({ name: draft.displayName ?? '' }), reason: 'bad-identity' })
        continue
      }
      const [countryCode, metricKey, periodKey] = parts as [string, string, string]
      const named = nameByMetricKey[metricKey]
      if (named === undefined) {
        // 事件型行的身份第二段是**事件类型**（`central-bank-activity`），不是指标码——它们的
        // `evt.*` 映射还没接，所以记 `unknown-event-type`，别混进「缺指标映射」里：
        // 两者该修的地方不同（一个补事件类型表，一个补指标码）。
        const eventType = EVENT_KINDS.includes(metricKey)
        if (eventType) {
          // 事件型：用**源给的类型串**翻成 `evt.*` 码（不按名字猜）。类型串是显示名，但它在
          // 这张表里是**键**，不是匹配依据——未知串照旧落 unmapped。
          const code = eventCodeBySourceType[String(draft.displayName ?? '')]
          if (code !== undefined) {
            const minute = String(draft.scheduledAt ?? '').slice(0, 16)
            upsertCalendarStandardRow(database, {
              countryCode, metricKey: code, periodKey: minute,
              scheduledDate: String(draft.scheduledDate ?? ''), scheduledAt: String(draft.scheduledAt ?? ''),
              timePrecision: 'minute', valuesJson: '{}', sourceProviderId: batch.providerId,
              sourceEventId: String(draft.marketFactKey), parserVersion: batch.parserVersion,
              observedAt: batch.observedAt, firstSeenAt: batch.observedAt
            })
            written += 1
            continue
          }
        }
        const reason: CalendarUnmappedReason = eventType ? 'unknown-event-type' : 'unknown-measure'
        reasons[reason] += 1
        recordCalendarUnmapped(database, { providerId: batch.providerId, sourceKey: String(draft.marketFactKey),
          detectedAt: batch.observedAt, rawJson: JSON.stringify({ metricKey }), reason })
        continue
      }
      const scheduledAt = String(draft.scheduledAt ?? '')
      const scheduledDate = String(draft.scheduledDate ?? scheduledAt.slice(0, 10))
      const existing = findCalendarStandardRowBySource(database, {
        sourceProviderId: batch.providerId, sourceEventId: String(draft.marketFactKey)
      })
      upsertCalendarStandardRow(database, {
        countryCode, metricKey, periodKey, scheduledDate, scheduledAt,
        ...(existing === undefined ? {} : { firstScheduledDate: existing.firstScheduledDate }),
        timePrecision: scheduledAt.endsWith('T00:00:00.000Z') ? 'date' : 'minute',
        valuesJson: JSON.stringify({
          ...(draft.consensus === undefined ? {} : { consensus: draft.consensus.displayValue }),
          ...(draft.providerPrevious === undefined ? {} : { previous: draft.providerPrevious.displayValue }),
          ...(draft.providerActual === undefined ? {} : { actual: draft.providerActual.displayValue })
        }),
        sourceProviderId: batch.providerId, sourceEventId: String(draft.marketFactKey),
        parserVersion: batch.parserVersion, observedAt: batch.observedAt, firstSeenAt: batch.observedAt,
        ...(draft.providerActual === undefined ? {} : { firstPublishedActual: draft.providerActual.displayValue }),
        ...(draft.providerPrevious === undefined ? {} : { firstPublishedPrevious: draft.providerPrevious.displayValue })
      })
      written += 1
    } catch (error) {
      // **不许拖停采集**：记一笔、继续下一行。
      failed += 1
      options?.onError?.((error as Error)?.message ?? 'unknown')
    }
  }
  return { written, unmapped: reasons, failed }
}
