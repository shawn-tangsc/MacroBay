import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { ensureCalendarStandardTables, upsertCalendarStandardRow } from './marketCalendarStandardTable'
import { readMacroIndicatorCardGap } from './macroIndicatorCardGapRead'

/**
 * 「这一格为什么没有数」的只读取数（产品 41 号文，Chief 2026-11-19）。
 *
 * 判据：
 * 1. 排期在 `asOf` 之后、状态 `scheduled` → **待发布**（不是「未提供」）；
 * 2. 到点但没值、`missing_reason='structural-no-source'` → **无此数据**，并带出库里那句依据；
 * 3. `source-no-value` → 未提供（由界面翻成固定一句）；
 * 4. 既没有待发布、也没有缺值原因 → 不给任何状态（卡上按原来的「未提供」走）；
 * 5. 读失败 → `undefined`（那一格走「读取失败」，不是「没有这一档」）。
 */
const now = '2026-11-19T00:00:00.000Z'

function seed(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  ensureCalendarStandardTables(database)
  const insert = (metricKey: string, periodKey: string, scheduledDate: string, extra: Readonly<{
    scheduledAt?: string; status?: 'scheduled' | 'published' | 'missing'
    missingReason?: 'structural-no-source' | 'source-no-value'; missingBasis?: string
  }>): void => {
    upsertCalendarStandardRow(database, {
      countryCode: 'US', metricKey, periodKey, scheduledDate,
      ...(extra.scheduledAt === undefined ? {} : { scheduledAt: extra.scheduledAt }),
      timePrecision: extra.scheduledAt === undefined ? 'date' as const : 'minute' as const,
      status: extra.status ?? 'published', valuesJson: '{}',
      sourceProviderId: 'narwhal', sourceEventId: `${metricKey}-${periodKey}`,
      parserVersion: 'v1', observedAt: now, firstSeenAt: now,
    })
    // 缺值原因三列由迁移/修复脚本写，不在写入端的契约里：夹具直接补上那一列，走同一条读路径。
    if (extra.missingReason !== undefined) {
      database.prepare(`update mi_calendar_events set missing_reason = ?, missing_basis = ?
        where metric_key = ? and period_key = ?`).run(
        extra.missingReason, extra.missingBasis ?? null, metricKey, periodKey)
    }
  }
  // PCE 10 月还没到（11-25 发布）→ 待发布。
  insert('US.CORE_PCE.SA.YOY', '2026-10', '2026-11-25', { status: 'scheduled', scheduledAt: '2026-11-25T13:30:00.000Z' })
  // CPI 10 月已发布但没有来源 → 无此数据，依据随行走。
  insert('US.CPI.NSA.YOY', '2026-10', '2026-11-10', {
    status: 'missing', missingReason: 'structural-no-source', missingBasis: '2025-10 的 CPI 从未发布，分母不存在'
  })
  // 零售那条：来源没给这一项。
  insert('US.RETAIL.SA.MOM', '2026-10', '2026-11-17', { status: 'missing', missingReason: 'source-no-value' })
  // 有值的普通行：不给任何状态。
  insert('US.PCE.SA.YOY', '2026-09', '2026-10-30', { status: 'published' })
  return database
}

describe('readMacroIndicatorCardGap', () => {
  it('reports a future scheduled release as pending', () => {
    const gap = readMacroIndicatorCardGap(seed(), { metricKey: 'US.CORE_PCE.SA.YOY', asOf: now })
    expect(gap).toEqual({ pending: { period: '2026-10', releaseAt: '2026-11-25T13:30:00.000Z' } })
  })

  it('reports no-such-data with the basis stored in the row', () => {
    const gap = readMacroIndicatorCardGap(seed(), { metricKey: 'US.CPI.NSA.YOY', asOf: now })
    expect(gap).toEqual({ missing: { reason: 'structural-no-source', basis: '2025-10 的 CPI 从未发布，分母不存在' } })
  })

  it('reports the source gap without inventing a basis', () => {
    const gap = readMacroIndicatorCardGap(seed(), { metricKey: 'US.RETAIL.SA.MOM', asOf: now })
    // 依据由界面翻成固定一句；这里**不编**一句话塞进数据。
    expect(gap).toEqual({ missing: { reason: 'source-no-value' } })
  })

  it('gives no state at all when there is nothing to report', () => {
    expect(readMacroIndicatorCardGap(seed(), { metricKey: 'US.PCE.SA.YOY', asOf: now })).toBeUndefined()
    expect(readMacroIndicatorCardGap(seed(), { metricKey: 'US.NOT.THERE', asOf: now })).toBeUndefined()
  })
})