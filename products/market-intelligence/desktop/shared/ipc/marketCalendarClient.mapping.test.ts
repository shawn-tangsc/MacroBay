import { describe, expect, it } from 'vitest'

import { mappingRulesReadOf } from './marketCalendarClient'

/** 形状不合判「读不到」：一份缺字段的规则表会让读者以为「没有这条规则」。 */
const ok = {
  state: 'available',
  mapped: [{ sourceId: '214790', metricKey: 'US.X.SA.MOM', periodRule: 'same-month', basis: null, officialUrl: null }],
  unmapped: [{ sourceId: '10113', rowCount: 8, sampleLabel: '密歇根现况' }],
  counts: { mapped: 85, unmapped: 164, unmappedRows: 833 }
}

describe('mappingRulesReadOf', () => {
  it('accepts the read port shape as-is', () => {
    const view = mappingRulesReadOf(ok)
    expect(view.state).toBe('available')
    expect(view.state === 'available' && view.mapped).toHaveLength(1)
  })
  it('keeps "could not read" separate', () => {
    expect(mappingRulesReadOf({ state: 'unavailable', reasonCode: 'query-unavailable' }).state).toBe('unavailable')
    expect(mappingRulesReadOf({ state: 'available', mapped: [] }).state).toBe('unavailable')
  })
  it('refuses a half-formed row', () => {
    for (const broken of [{ ...ok.mapped[0]!, sourceId: '' }, { ...ok.mapped[0]!, metricKey: 8 as unknown as string }]) {
      expect(mappingRulesReadOf({ ...ok, mapped: [broken] }).state).toBe('unavailable')
    }
  })
})

/**
 * 「无需映射」那一段：**整段可缺，有就必须对**。
 *
 * 缺 = 旧载荷，界面不显示那个页签；半份 = 读者会把这个页签当成「全部指标」，那是更糟的谎。
 */
const direct = [{ metricKey: 'US.PCE.SA.MOM', names: { zh: '核心 PCE 月率', en: 'PCE Price Index, MoM' }, tier: 1, rowCount: 7 }]

describe('mappingRulesReadOf · direct', () => {
  it('passes the section through when it is well formed', () => {
    const view = mappingRulesReadOf({ ...ok, direct, counts: { ...ok.counts, direct: 1 } })
    expect(view.state).toBe('available')
    expect(view.state === 'available' && view.direct?.[0]?.metricKey).toBe('US.PCE.SA.MOM')
  })
  it('accepts an old payload with no such section', () => {
    const view = mappingRulesReadOf(ok)
    expect(view.state).toBe('available')
    expect(view.state === 'available' && view.direct).toBeUndefined()
  })
  it('refuses a malformed section instead of showing a partial tab', () => {
    const cases = [
      { metricKey: '', tier: 1, rowCount: 1 },                          // 空指标码
      { metricKey: 'US.PCE.SA.MOM', tier: 4, rowCount: 1 },             // 分级越界
      { metricKey: 'US.PCE.SA.MOM', tier: 1, rowCount: -1 },            // 负数行数
      { metricKey: 'US.PCE.SA.MOM', tier: 1, rowCount: 1.5 },           // 非整数
      { metricKey: 'US.PCE.SA.MOM', tier: 1, rowCount: 1, names: { zh: '只有中文' } }
    ]
    for (const broken of cases) {
      expect(mappingRulesReadOf({ ...ok, direct: [broken], counts: { ...ok.counts, direct: 1 } }).state,
        JSON.stringify(broken)).toBe('unavailable')
    }
    // 段本身不是数组也拒。
    expect(mappingRulesReadOf({ ...ok, direct: {}, counts: { ...ok.counts, direct: 1 } }).state).toBe('unavailable')
  })
  it('refuses a tab count that disagrees with the rows it labels', () => {
    // 页签上写 1、段里 0 条：标题与内容不符，正是最难被发现的谎。
    expect(mappingRulesReadOf({ ...ok, direct: [], counts: { ...ok.counts, direct: 1 } }).state).toBe('unavailable')
  })
})
