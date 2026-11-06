import { describe, expect, it } from 'vitest'

import { resolveIndicatorNameId, stripPeriodSuffix } from './indicatorNames'

/**
 * 期号是**数据的形状，不是名字的一部分**：源标题带 `(Sep)`、`(to 1030)`、`(Q3)`，换期就变。
 * 剥法必须窄——只剥末尾、只剥像期号的括号段，**单位括号不许动**，否则「政府预算（十亿美元）」
 * 会和其他政府预算条目撞成一个键。这四条就是那套规则的机械判据。
 */
describe('indicator name lookup', () => {
  it('treats two periods of one release as the same name', () => {
    const september = resolveIndicatorNameId({ title: 'Durable goods orders (MoM) (Revised) (Sep)' })
    const october = resolveIndicatorNameId({ title: 'Durable goods orders (MoM) (Revised) (Oct)' })
    expect(september).toBe('us-durable-goods')
    expect(october).toBe(september)
  })

  it('keeps a unit bracket: only the trailing period is stripped', () => {
    // 前一个括号是单位，后一个是期号：剥完必须留下单位。
    expect(stripPeriodSuffix('Government Budget (billion USD)(Sep)')).toBe('Government Budget (billion USD)')
    expect(stripPeriodSuffix('Government Budget (billion USD)(Oct)')).toBe('Government Budget (billion USD)')
    expect(resolveIndicatorNameId({ title: 'Government Budget (billion USD)(Oct)' })).toBe('us-government-budget')
    // 单位本身不像期号，所以不会继续被剥掉。
    expect(stripPeriodSuffix('Producer Price Index (%)')).toBe('Producer Price Index (%)')
  })

  it('registers by stable identity first, then by title', () => {
    expect(resolveIndicatorNameId({ eventNameKey: 'cpi' })).toBe('cpi')
    expect(resolveIndicatorNameId({ eventNameKey: 'cpi', title: 'nonsense' })).toBe('cpi')
    expect(resolveIndicatorNameId({ title: 'EIA Refinery Equipment Exploitation Rate Last Week (to 1023)' })).toBe(
      'us-eia-refinery-utilization'
    )
  })

  it('falls through to the source title for an unlisted release and never returns an empty match', () => {
    expect(resolveIndicatorNameId({ title: 'Some Unlisted Release (Oct)' })).toBeUndefined()
    // 剥完为空 → 不匹配（调用方用原文），不崩。
    expect(stripPeriodSuffix('(Sep)')).toBe('')
    expect(resolveIndicatorNameId({ title: '(Sep)' })).toBeUndefined()
    expect(resolveIndicatorNameId({})).toBeUndefined()
  })
})
