import { describe, expect, it } from 'vitest'

import {
  annualizeCalendarNumeric, annualizationMultiplier, compareCalendarNumeric, readCalendarNumeric
} from './marketCalendarNumericReading'

/**
 * 数值化 N3（方案 `macro-calendar-numeric-values-plan.md` §3 / §5）：**读侧只认数值列**。
 *
 * 六条判据里有五条落在这个文件（第 6 条「旧行不受影响」在 N1 的 `values_json` 逐字节断言里）：
 * ① 同一条发布两源按**数值**比，两行只有展示串（`numeric_json` 为 NULL）→ **不可比**，
 *    绝不在读侧回退去 parse 展示串（红证：实现前会解析出 3）；
 * ② 年度化只对码表带 `officialSeries.frequency` 且标了 `annualization:'flow'` 的码可用；
 * ③ 缺值三态（未记录/来源未给/无法解析）各有各的说法，**任何一处算术都不出现 0**；
 * ④ 写入口不解析（在 `marketCalendarNumericParse.test.ts`）；
 * ⑤ 单位不同 / 单位不明 → 不可比，不产出差值。
 */

const thousands = (actual: number, decimals = 0): string => JSON.stringify({
  v: 1, state: 'available', unit: 'thousands',
  values: { actual }, decimals: { actual: decimals }, parserVersion: 'calendar-numeric-v1'
})

describe('读侧比较：只认数值列', () => {
  it('两源同一条发布：按数值比，容差取较粗小数位的一半', () => {
    const comparison = compareCalendarNumeric(thousands(165), thousands(162), 'actual')
    expect(comparison).toEqual({ comparable: true, same: false, difference: 3, tolerance: 0.5, decimals: 0 })
    // 小数位是容差的依据：4.1 与 4.14 在 1 位精度下算同一个数（0.04 < 0.05）。
    const percent = (value: number, decimals: number) => JSON.stringify({
      v: 1, state: 'available', unit: 'percent', values: { actual: value }, decimals: { actual: decimals },
      parserVersion: 'calendar-numeric-v1'
    })
    const withinTolerance = compareCalendarNumeric(percent(4.1, 1), percent(4.14, 2), 'actual')
    expect(withinTolerance).toMatchObject({ comparable: true, same: true, tolerance: 0.05, decimals: 1 })
    expect((withinTolerance as { difference: number }).difference).toBeCloseTo(0.04, 10)
    expect(compareCalendarNumeric(percent(4.1, 1), percent(4.2, 1), 'actual'))
      .toMatchObject({ comparable: true, same: false, tolerance: 0.05 })
  })

  it('两行只有展示串（numeric_json 为 NULL）→ 不可比，绝不回退去 parse 展示串', () => {
    // 实现前的形状：拿 `{"actual":"165K"}` 现算会得到 3。红的判据就是「拿不到任何数值」。
    const comparison = compareCalendarNumeric(null, thousands(162), 'actual')
    expect(comparison).toEqual({ comparable: false, reason: 'unrecorded' })
    expect(comparison).not.toHaveProperty('difference')
    expect(compareCalendarNumeric(null, null, 'actual')).toEqual({ comparable: false, reason: 'unrecorded' })
  })

  it('单位不同或不明 → 不可比；两方都「推不出单位」也不算同单位', () => {
    const percent = JSON.stringify({ v: 1, state: 'available', unit: 'percent', values: { actual: 4.1 },
      decimals: { actual: 1 }, parserVersion: 'calendar-numeric-v1' })
    expect(compareCalendarNumeric(percent, thousands(165), 'actual')).toEqual({ comparable: false, reason: 'unit-mismatch' })
    const unknown = JSON.stringify({ v: 1, state: 'available', unit: 'unknown', values: { actual: 53.2 },
      decimals: { actual: 1 }, parserVersion: 'calendar-numeric-v1' })
    expect(compareCalendarNumeric(unknown, unknown, 'actual')).toEqual({ comparable: false, reason: 'unit-unknown' })
    // 没有 unit 字段（旧形状）也算不明，不许当同单位。
    const bare = JSON.stringify({ v: 1, state: 'available', values: { actual: 53.2 },
      decimals: { actual: 1 }, parserVersion: 'calendar-numeric-v1' })
    expect(compareCalendarNumeric(bare, unknown, 'actual')).toEqual({ comparable: false, reason: 'unit-unknown' })
  })
})

describe('缺值四态：各有各的说法，没有一种是 0', () => {
  it('未记录 / 来源未给 / 无法解析 三态分开，且都不返回数值', () => {
    expect(readCalendarNumeric(null)).toEqual({ state: 'unrecorded' })
    const missing = JSON.stringify({ v: 1, state: 'missing', parserVersion: 'calendar-numeric-v1' })
    expect(readCalendarNumeric(missing)).toEqual({ state: 'missing' })
    const unparsed = JSON.stringify({ v: 1, state: 'unparsed', parserVersion: 'calendar-numeric-v1' })
    expect(readCalendarNumeric(unparsed)).toEqual({ state: 'unparsed' })
    // 三态在比较里也各有各的原因，不合并成一句「没有」。
    expect(compareCalendarNumeric(null, thousands(1), 'actual')).toEqual({ comparable: false, reason: 'unrecorded' })
    expect(compareCalendarNumeric(missing, thousands(1), 'actual')).toEqual({ comparable: false, reason: 'missing' })
    expect(compareCalendarNumeric(unparsed, thousands(1), 'actual')).toEqual({ comparable: false, reason: 'unparsed' })
  })

  it('形状坏掉的列按「未记录」处理并给出原因，不当成 0', () => {
    expect(readCalendarNumeric('not json')).toEqual({ state: 'unrecorded', reason: 'json-invalid' })
    expect(readCalendarNumeric(JSON.stringify({ v: 2, state: 'available' })))
      .toEqual({ state: 'unrecorded', reason: 'shape-invalid' })
    // 状态是 available 但没有这一个字段 → 这个字段就是「没给」，不是 0。
    const onlyPrevious = JSON.stringify({ v: 1, state: 'available', unit: 'percent',
      values: { previous: 4 }, decimals: { previous: 1 }, parserVersion: 'calendar-numeric-v1' })
    expect(compareCalendarNumeric(onlyPrevious, thousands(1), 'actual')).toEqual({ comparable: false, reason: 'no-value' })
    expect(readCalendarNumeric(onlyPrevious)).toMatchObject({ state: 'available', values: { previous: 4 } })
  })
})

describe('年度化：只对带频率的流量码开放', () => {
  const value = (actual: number) => JSON.stringify({ v: 1, state: 'available', unit: 'thousands',
    values: { actual }, decimals: { actual: 0 }, parserVersion: 'calendar-numeric-v1' })

  it('周度流量 100 → 年化 5200；月度 ×12；季度 ×4（季度今天没有码，系数照样定义）', () => {
    expect(annualizeCalendarNumeric('US.JOBLESS_CLAIMS_INITIAL.SA.COUNT', value(100), 'actual'))
      .toEqual({ annualizable: true, annualized: 5200, multiplier: 52, frequency: 'weekly' })
    expect(annualizeCalendarNumeric('US.NONFARM.SA.CHANGE', value(100), 'actual'))
      .toEqual({ annualizable: true, annualized: 1200, multiplier: 12, frequency: 'monthly' })
    expect(annualizationMultiplier('weekly')).toBe(52)
    expect(annualizationMultiplier('monthly')).toBe(12)
    expect(annualizationMultiplier('quarterly')).toBe(4)
  })

  it('没标 flow 的码不年度化：比率（失业率）与没有频率的 220 个码都不许猜', () => {
    // 失业率：有频率、但它是比率，码表里没有 `annualization:'flow'`（载入校验的反例）。
    expect(annualizeCalendarNumeric('US.UNEMPLOYMENT.SA.RATE', value(4.1), 'actual'))
      .toEqual({ annualizable: false, reason: 'not-flow' })
    // 没有 officialSeries 的码：连频率都没有。
    expect(annualizeCalendarNumeric('US.CPI.NSA.YOY', value(3.7), 'actual'))
      .toEqual({ annualizable: false, reason: 'not-flow' })
    // 码表里根本没有的码。
    expect(annualizeCalendarNumeric('US.NOT_A_CODE', value(1), 'actual'))
      .toEqual({ annualizable: false, reason: 'code-unknown' })
  })

  it('流量码也要先有值：缺值三态不参与年度化，更不产出 0', () => {
    for (const [json, reason] of [
      [null, 'unrecorded'],
      [JSON.stringify({ v: 1, state: 'missing', parserVersion: 'calendar-numeric-v1' }), 'missing'],
      [JSON.stringify({ v: 1, state: 'unparsed', parserVersion: 'calendar-numeric-v1' }), 'unparsed'],
      [JSON.stringify({ v: 1, state: 'available', unit: 'thousands', values: { previous: 4 },
        decimals: { previous: 0 }, parserVersion: 'calendar-numeric-v1' }), 'no-value']
    ] as const) {
      expect(annualizeCalendarNumeric('US.JOBLESS_CLAIMS_INITIAL.SA.COUNT', json, 'actual'))
        .toEqual({ annualizable: false, reason })
    }
  })
})