import { describe, expect, it } from 'vitest'

import type {
  DirectMetricRow, MappingRuleRow
} from '../../../service/intelligence/macro-calendar/rendering/marketCalendarMappingRulesRead'
import {
  expandToFamily, filterDirectByTier, filterMappedByTier, sortDirectMetrics, sortMappedRules, tierKeyOf
} from './mappingRulesView'

const row = (sourceId: string, metricKey: string, tier: 1 | 2 | 3 | null, rowCount: number): MappingRuleRow =>
  ({ sourceId, metricKey, periodRule: 'month', basis: null, officialUrl: null, names: null, tier, rowCount })

const order = (rows: readonly MappingRuleRow[]): string[] => rows.map((entry) => entry.sourceId)

/**
 * 排序是**读者可见的顺序**（用户 2026-11-17：库里全是 0 看不出哪条在起作用）。这条用例钉的是顺序本身：
 * 行数降序 → 分级（一、二、三、未分级）→ 指标码。
 */
it('orders mapped rules by rows in store first, then tier, then metric key', () => {
  const rows = [
    row('zero-a', 'US.ZZZ.NONE.LEVEL', 1, 0),
    row('zero-b', 'US.AAA.NONE.LEVEL', 1, 0),
    row('top', 'US.CPI.NSA.YOY', 1, 12),
    row('tier3', 'US.MICHIGAN.NONE.LEVEL', 3, 5),
    row('untiered', 'US.XYZ.NONE.LEVEL', null, 5),
    row('tier2', 'US.PPI.NSA.YOY', 2, 5)
  ]
  // 行数最大的一条排第一；行数相同的那三条按一/二/三/未分级；行数为 0 的垫底，且两者按指标码定序。
  expect(order(sortMappedRules(rows))).toEqual(['top', 'tier2', 'tier3', 'untiered', 'zero-b', 'zero-a'])
})

it('does not reorder the caller array in place', () => {
  const rows = [row('b', 'US.B.NONE.LEVEL', 1, 0), row('a', 'US.A.NONE.LEVEL', 1, 9)]
  sortMappedRules(rows)
  expect(order(rows)).toEqual(['b', 'a'])
})

it('filters by tier without dropping the untiered bucket', () => {
  const rows = [
    row('cpi', 'US.CPI.NSA.YOY', 1, 12),
    row('ppi', 'US.PPI.NSA.YOY', 2, 3),
    row('michi', 'US.MICHIGAN.NONE.LEVEL', null, 5)
  ]
  expect(order(filterMappedByTier(rows, '1'))).toEqual(['cpi'])
  expect(order(filterMappedByTier(rows, '2'))).toEqual(['ppi'])
  // 「未分级」是一个真实的分组，不是「没有分级所以给全部」。
  expect(order(filterMappedByTier(rows, 'other'))).toEqual(['michi'])
  expect(order(filterMappedByTier(rows, '3'))).toEqual([])
  expect(order(filterMappedByTier(rows, 'all'))).toEqual(['cpi', 'ppi', 'michi'])
})

it('maps a missing tier to the untiered key, never to a tier', () => {
  expect([1, 2, 3].map((tier) => tierKeyOf(tier as 1 | 2 | 3))).toEqual(['1', '2', '3'])
  expect(tierKeyOf(null)).toBe('other')
})

describe('direct 段', () => {
  const direct = (metricKey: string, tier: 1 | 2 | 3 | null, rowCount: number): DirectMetricRow =>
    ({ metricKey, names: null, tier, rowCount })

  it('sorts with the same measure as the mapped tab', () => {
    const rows = [direct('US.ZZZ.NONE.LEVEL', 1, 0), direct('US.PCE.SA.MOM', 1, 7),
      direct('US.GDP.SA.ANNUALIZED_QOQ', null, 7), direct('US.AAA.NONE.LEVEL', 1, 7)]
    // 行数降序，同数按一/二/三/未分级，再按指标码——与已映射页签一致，两个页签顺序不同会被当成两处 bug。
    expect(sortDirectMetrics(rows).map((row) => row.metricKey))
      .toEqual(['US.AAA.NONE.LEVEL', 'US.PCE.SA.MOM', 'US.GDP.SA.ANNUALIZED_QOQ', 'US.ZZZ.NONE.LEVEL'])
  })

  it('filters by tier', () => {
    const rows = [direct('US.PCE.SA.MOM', 1, 7), direct('US.GDP.SA.ANNUALIZED_QOQ', null, 4)]
    expect(filterDirectByTier(rows, '1').map((row) => row.metricKey)).toEqual(['US.PCE.SA.MOM'])
    expect(filterDirectByTier(rows, 'other').map((row) => row.metricKey)).toEqual(['US.GDP.SA.ANNUALIZED_QOQ'])
    expect(filterDirectByTier(rows, 'all')).toHaveLength(2)
  })
})

describe('族分组与父带子', () => {
  const fam = (sourceId: string, metricKey: string, rowCount: number,
    extra: Readonly<{ kind?: 'parent' | 'child'; parentMetricKey?: string | null; childOrder?: number }> = {}
  ): MappingRuleRow => ({ ...row(sourceId, metricKey, null, rowCount), ...extra })

  const parentRow = fam('p1', 'US.PHILLY.FED.SA.LEVEL', 9, { kind: 'parent', parentMetricKey: null })
  const childLate = fam('c2', 'US.PHILLY.FED.ORDERS.SA.LEVEL', 1,
    { kind: 'child', parentMetricKey: 'US.PHILLY.FED.SA.LEVEL', childOrder: 2 })
  const childFirst = fam('c0', 'US.PHILLY.FED.SHIPMENTS.SA.LEVEL', 3,
    { kind: 'child', parentMetricKey: 'US.PHILLY.FED.SA.LEVEL', childOrder: 0 })
  const childMiddle = fam('c1', 'US.PHILLY.FED.PRICES.SA.LEVEL', 2,
    { kind: 'child', parentMetricKey: 'US.PHILLY.FED.SA.LEVEL', childOrder: 1 })
  const big = fam('big', 'US.UNEMPLOYMENT.SA.RATE', 12)

  it('keeps a family together: parent first, children by childOrder', () => {
    // 读口给的顺序是乱的（含字母序相反的），这里要的是「族内按词表序」。
    const rows = [childLate, childFirst, big, childMiddle, parentRow]
    expect(sortMappedRules(rows).map((entry) => entry.sourceId))
      .toEqual(['big', 'p1', 'c0', 'c1', 'c2'])
  })

  it('does not reorder children when the read port gives no childOrder', () => {
    const a = fam('a', 'US.X.A.SA.LEVEL', 1, { kind: 'child', parentMetricKey: 'US.X.SA.LEVEL' })
    const b = fam('b', 'US.X.B.SA.LEVEL', 1, { kind: 'child', parentMetricKey: 'US.X.SA.LEVEL' })
    expect(sortMappedRules([a, b]).map((entry) => entry.sourceId)).toEqual(['a', 'b'])
  })

  it('pulls in the children when a parent matches, and only itself when a child matches', () => {
    const rows = [big, parentRow, childFirst, childMiddle, childLate]
    expect(expandToFamily(rows, [parentRow]).map((entry) => entry.sourceId))
      .toEqual(['p1', 'c0', 'c1', 'c2'])
    // 命中子项只出子项：把母项也拉进来，读者会以为自己搜到了母项。
    expect(expandToFamily(rows, [childMiddle]).map((entry) => entry.sourceId)).toEqual(['c1'])
    // 没有族信息时行为不变。
    expect(expandToFamily(rows, [big]).map((entry) => entry.sourceId)).toEqual(['big'])
  })
})
