import { describe, expect, it } from 'vitest'

import { marketCalendarCodeTable } from './marketCalendarCodeTable'
import { zeroXRouterIndicatorIdentities } from './marketCalendarMetricIdentity'
import { zeroXRouterSourceMetricMappings } from './marketCalendarZeroXRouterSourceMappings'
import { germanSourceMetricMappings } from './marketCalendarGermanSourceMappings'
import { zeroXRouterEventIdentities } from './marketCalendarEventIdentities'

/**
 * **码表是唯一真源，映射表跟着它走**（用户 2026-11-17）。
 *
 * 三条守卫，任一不合就红：
 * 1. 映射表里的每个码都必须在码表里——反过来「码表里没有的码」不许出现在任何映射表；
 * 2. 每一行必须有 4 个名称、`measure`/`seasonality` 非空、`officialSource` 要么是机构页、
 *    要么是 `pending` + 理由（**不许静默为 null**）；
 * 3. 事件身份（`evt.*`）的 `kind` 必须是 `event`，且不参与分级（`tier` 为 null）。
 */
const rows = Object.values(marketCalendarCodeTable)

describe('标准码表', () => {
  it('映射表里的码全部在码表里（反向也不许有孤儿）', () => {
    const mappedCodes = [
      ...Object.values(zeroXRouterIndicatorIdentities).map((entry) => entry.metricKey),
      ...Object.values(zeroXRouterSourceMetricMappings).map((entry) => entry.metricKey),
      ...Object.values(germanSourceMetricMappings).map((entry) => entry.metricKey),
      ...Object.values(zeroXRouterEventIdentities).map((entry) => entry.metricKey)
    ]
    const missing = [...new Set(mappedCodes)].filter((code) => marketCalendarCodeTable[code] === undefined)
    expect(missing, `映射表用了码表里没有的码：${missing.slice(0, 5).join(', ')}`).toEqual([])
  })

  it('每行四个名称、测度与季调档非空、官网页不许静默为 null', () => {
    const problems: string[] = []
    for (const row of rows) {
      for (const field of ['zhFull', 'zhShort', 'enFull', 'enShort'] as const) {
        if (row.names[field].trim() === '') problems.push(`${row.code} 缺 ${field}`)
      }
      if (row.measure.trim() === '') problems.push(`${row.code} 缺 measure`)
      if (row.seasonality.trim() === '') problems.push(`${row.code} 缺 seasonality`)
      const source = row.officialSource
      const ok = ('pending' in source && source.pending === true && source.reason.trim() !== '')
        || (!('pending' in source) && source.url.trim() !== '')
      if (!ok) problems.push(`${row.code} 官网页既不是机构页也不是 pending+理由`)
    }
    expect(problems.slice(0, 8)).toEqual([])
  })

  it('事件身份不参与分级：`evt.*` 的 kind 是 event、tier 为 null', () => {
    const events = rows.filter((row) => row.code.startsWith('evt.'))
    expect(events.length).toBeGreaterThan(0)
    expect(events.every((row) => row.kind === 'event' && row.tier === null)).toBe(true)
    // 指标行反过来不许标成 event；`kind` 与码前缀必须是同一件事，不能各说各的。
    expect(rows.filter((row) => row.kind === 'metric').every((row) => !row.code.startsWith('evt.'))).toBe(true)
  })
})
