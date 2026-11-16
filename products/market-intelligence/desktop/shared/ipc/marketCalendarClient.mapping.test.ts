import { describe, expect, it } from 'vitest'

import { mappingRulesReadOf } from './marketCalendarClient'

/** 形状不合判「读不到」：一份缺字段的规则表会让读者以为「没有这条规则」。 */
const ok = {
  state: 'available',
  mapped: [{ sourceIds: ['214790'], metricKey: 'US.X.SA.MOM', periodRule: 'same-month', basis: null,
    officialUrl: null, rowCount: 12 }],
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
    for (const broken of [{ ...ok.mapped[0]!, sourceIds: [''] }, { ...ok.mapped[0]!, metricKey: 8 as unknown as string }]) {
      expect(mappingRulesReadOf({ ...ok, mapped: [broken] }).state).toBe('unavailable')
    }
  })
  it('accepts a code that came in directly: empty id list and no period rule', () => {
    // 合并页签后这类行与规则行同在一张表里：空的 id 列表是「它本来就没有 id」，不是读失败。
    const view = mappingRulesReadOf({ ...ok, mapped: [{ ...ok.mapped[0]!, sourceIds: [], periodRule: null }] })
    expect(view.state).toBe('available')
  })
  it('refuses a row whose id list or period rule is not the declared shape', () => {
    for (const broken of [{ ...ok.mapped[0]!, sourceIds: '214790' }, { ...ok.mapped[0]!, sourceIds: [7] },
      { ...ok.mapped[0]!, periodRule: 3 }]) {
      expect(mappingRulesReadOf({ ...ok, mapped: [broken] }).state, JSON.stringify(broken)).toBe('unavailable')
    }
  })
})

/**
 * 层级字段：**可缺，不能错**。缺了就是旧载荷（界面不显示归属小字），错了会让子项挂在不存在的
 * 母项下面——那比不显示更糟。
 */
describe('mappingRulesReadOf · hierarchy', () => {
  const base = { ...ok.mapped[0]!, kind: 'child' as const, parentMetricKey: 'US.X.SA.LEVEL', childOrder: 0 }

  it('accepts a well-formed child row and a plain row with no hierarchy fields', () => {
    expect(mappingRulesReadOf({ ...ok, mapped: [base] }).state).toBe('available')
    expect(mappingRulesReadOf({ ...ok, mapped: [{ ...ok.mapped[0] }] }).state).toBe('available')
  })
  it('refuses hierarchy fields that do not hold together', () => {
    const cases = [
      { ...base, kind: 'grandchild' },
      { ...base, parentMetricKey: '' },
      { ...base, childOrder: 'first' },
      { ...base, childOrder: 1.5 }
    ]
    for (const broken of cases) {
      expect(mappingRulesReadOf({ ...ok, mapped: [broken] }).state, JSON.stringify(broken)).toBe('unavailable')
    }
  })
})
