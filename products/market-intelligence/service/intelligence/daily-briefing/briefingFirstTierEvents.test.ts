import { describe, expect, it } from 'vitest'

import { briefingFirstTierFamily, mergeFirstTierNext } from './briefingFirstTierEvents'

describe('first-tier macro events are recognised by identity', () => {
  it('recognises FOMC decisions and minutes from the code and from the source title', () => {
    expect(briefingFirstTierFamily({ metricKey: 'US.FOMC.2026-12-09' })).toBe('fomc')
    expect(briefingFirstTierFamily({ eventKey: 'US.FOMC.2026-12-09' })).toBe('fomc')
    expect(briefingFirstTierFamily({ metricKey: 'evt.monetary-policy-minutes' })).toBe('fomc')
    // 0xrouter 的纪要行没有指标码：原文名是唯一身份信号。
    expect(briefingFirstTierFamily({ title: '美联储公布货币政策会议纪要' })).toBe('fomc')
  })

  it('recognises CPI (headline and core) and the employment report', () => {
    expect(briefingFirstTierFamily({ metricKey: 'US.CPI.NSA.YOY' })).toBe('inflation')
    expect(briefingFirstTierFamily({ metricKey: 'US.CORE_CPI.SA.MOM' })).toBe('inflation')
    expect(briefingFirstTierFamily({ eventKey: 'US.CORE.CPI' })).toBe('inflation')
    expect(briefingFirstTierFamily({ metricKey: 'US.NONFARM_PAYROLLS.SA.CHANGE' })).toBe('labor')
    expect(briefingFirstTierFamily({ metricKey: 'US.UNEMPLOYMENT.SA.RATE' })).toBe('labor')
    expect(briefingFirstTierFamily({ title: '10月季调后非农就业人口变动(千人)' })).toBe('labor')
  })

  it('does not promote a company event or an ordinary indicator', () => {
    expect(briefingFirstTierFamily({ title: '英伟达临时CEO召开全体员工会议' })).toBeUndefined()
    expect(briefingFirstTierFamily({ metricKey: 'US.PPI.SA.MOM', title: 'PPI' })).toBeUndefined()
    expect(briefingFirstTierFamily({})).toBeUndefined()
  })
})

describe('merging the must-keep next events', () => {
  const item = (eventKey: string) => ({ eventKey })
  it('puts first-tier events first, keeps the selection order, and respects the cap', () => {
    expect(mergeFirstTierNext({
      focusEventKey: 'US.FOMC',
      selected: [item('CN.NBS_PMI'), item('US.CPI'), item('US.NFP')],
      mustKeep: [item('US.CPI')],
      limit: 3
    }).map((entry) => entry.eventKey)).toEqual(['US.CPI', 'CN.NBS_PMI', 'US.NFP'])
  })

  it('never duplicates an event already selected, and never repeats the focus', () => {
    expect(mergeFirstTierNext({
      focusEventKey: 'US.FOMC',
      selected: [item('US.CPI')],
      mustKeep: [item('US.FOMC'), item('US.CPI')],
      limit: 3
    }).map((entry) => entry.eventKey)).toEqual(['US.CPI'])
  })
})
