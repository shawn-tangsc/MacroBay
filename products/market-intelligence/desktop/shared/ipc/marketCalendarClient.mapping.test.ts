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
