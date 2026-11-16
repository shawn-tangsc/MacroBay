import { describe, expect, it } from 'vitest'

import { nameForMetricKey } from './marketCalendarCodeNames'
import { zeroXRouterCanonicalIdentity } from './marketCalendarMetricIdentity'
import { zeroXRouterSourceMetricMappings, zeroXRouterSourceRejectedIds } from './marketCalendarZeroXRouterSourceMappings'

/**
 * 0xrouter 的「源内 id → 指标码」表（子项码那批）。
 *
 * 判据两条，都冲着「静默失败」去：
 * 1. **码进去了不算完**：每个子项码跑 `nameForMetricKey` 必须返回四个名字。位置放错（子项落到测度段）
 *    或族名没登记，都会让名字返回 `undefined`，那批行会悄悄掉回「只有源原文名」而没人发现；
 * 2. **码里不许有月份**：月份是期次不是身份，写进码一个月后码表会翻一倍。
 */
const EXPECTED_CODES = Object.freeze([
  'US.PHILLY_FED_MANUFACTURING.SHIPMENTS.SA.LEVEL',
  'US.PHILLY_FED_MANUFACTURING.NEW_ORDERS.SA.LEVEL',
  'US.PHILLY_FED_MANUFACTURING.PRICES_PAID.SA.LEVEL',
  'US.PHILLY_FED_MANUFACTURING.PRICES_RECEIVED.SA.LEVEL',
  'US.EMPIRE_STATE_MANUFACTURING.NEW_ORDERS.SA.LEVEL',
  'US.EMPIRE_STATE_MANUFACTURING.PRICES_PAID.SA.LEVEL',
  'US.EMPIRE_STATE_MANUFACTURING.PRICES_RECEIVED.SA.LEVEL',
  'US.DALLAS_FED_MANUFACTURING.PRODUCTION.SA.LEVEL',
  'US.DALLAS_FED_MANUFACTURING.PRICES_PAID.SA.LEVEL',
  'US.DALLAS_FED_MANUFACTURING.SHIPMENTS.SA.LEVEL',
  'US.KANSAS_FED_MANUFACTURING.PRODUCTION.SA.LEVEL',
  'US.CAPACITY_UTILIZATION.MANUFACTURING.SA.RATE'
])

describe('0xrouter 子项码与族名', () => {
  it('12 个子项码逐个都能生成四个名字（返回 undefined 就是没做完）', () => {
    for (const code of EXPECTED_CODES) {
      const names = nameForMetricKey(code)
      expect(names, code).toBeDefined()
      for (const field of ['zhFull', 'zhShort', 'enFull', 'enShort'] as const) {
        expect(names?.[field], `${code} 的 ${field}`).toBeTruthy()
      }
    }
  })

  it('34 个 id 落在 18 个码上，码里不含月份，GfK 两条不给码', () => {
    const entries = Object.entries(zeroXRouterSourceMetricMappings)
    expect(entries).toHaveLength(32)
    expect(new Set(entries.map(([, entry]) => entry.metricKey)).size).toBe(18)
    for (const [id, entry] of entries) {
      expect(entry.metricKey).not.toMatch(/\d{4}[-_]\d{2}/)
      expect(id).toMatch(/^\d+$/)
    }
    expect(Object.keys(zeroXRouterSourceRejectedIds).sort()).toEqual(['214240', '215037'])
    expect(zeroXRouterSourceMetricMappings['214240']).toBeUndefined()
  })

  it('映射真的接上了身份：0xrouter 的 id 现在能算出国家 + 指标码 + 期次', () => {
    const identity = zeroXRouterCanonicalIdentity({
      countryCode: 'US', indicatorId: '213935', scheduledAt: '2026-11-16T13:30:00.000Z'
    })
    expect(identity?.metricKey).toBe('US.PHILLY_FED_MANUFACTURING.SHIPMENTS.SA.LEVEL')
    expect(identity?.countryCode).toBe('US')
    expect(zeroXRouterCanonicalIdentity({ countryCode: 'US', indicatorId: '214240', scheduledAt: '2026-11-16T13:30:00.000Z' }))
      .toBeUndefined()
  })
})
