import type { DatabaseSync } from 'node:sqlite'

import { narwhalCanonicalIdentityKey } from './marketCalendarMetricIdentity'
import { nameByMetricKey } from './marketCalendarCodeNames'
import { recordCalendarUnmapped, upsertCalendarStandardRow,
  type CalendarUnmappedReason } from './marketCalendarStandardTable'

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
  ({ 'unknown-measure': 0, 'unknown-event-type': 0, 'bad-period': 0, 'bad-identity': 0 })

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
        reasons['unknown-measure'] += 1
        recordCalendarUnmapped(database, { providerId: batch.providerId, sourceKey: String(draft.marketFactKey),
          detectedAt: batch.observedAt, rawJson: JSON.stringify({ metricKey }), reason: 'unknown-measure' })
        continue
      }
      const scheduledAt = String(draft.scheduledAt ?? '')
      const scheduledDate = String(draft.scheduledDate ?? scheduledAt.slice(0, 10))
      upsertCalendarStandardRow(database, {
        countryCode, metricKey, periodKey, scheduledDate, scheduledAt,
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
