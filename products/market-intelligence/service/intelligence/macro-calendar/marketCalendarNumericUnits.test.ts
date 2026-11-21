import { describe, expect, it } from 'vitest'

import { marketCalendarCodeTable } from './marketCalendarCodeTable'
import {
  calendarNumericUnitByMeasure, calendarNumericUnitFromSource, calendarNumericUnitHintForMetricKey
} from './marketCalendarNumericUnits'

/**
 * 数值化 N2 的**单位闭集映射表**（架构师方案 `macro-calendar-numeric-values-plan.md` §1/§2）。
 *
 * 单位是闭集、**不做换算**；这一层只回答两件事：
 * ① 源自己声明的单位词汇（`percent-yoy` 这种）对应闭集里哪一个；
 * ② 展示串里没写单位时，能不能从**量纲本身**（measure）推出单位。
 *
 * ② 只允许「率就是百分比」这一档：`MOM` / `QOQ` / `YOY` / `ANNUALIZED_QOQ` / `RATE`。水平、变动、
 * 计数、金额的单位取决于**该序列报的尺度**（千、十亿、指数点），码表里没这个字段，**一律不猜**——
 * 猜错的单位会让跨源比较拿两个不同尺度的数相减，比没有数值更糟。
 */
describe('单位闭集映射表', () => {
  it('源声明的单位词汇 → 闭集；认不出的词汇不猜', () => {
    expect(calendarNumericUnitFromSource('percent')).toBe('percent')
    // BEA 自己写 `percent-yoy` / `percent-saar`：同比、年化是**口径**，不是单位，都还是百分比。
    expect(calendarNumericUnitFromSource('percent-yoy')).toBe('percent')
    expect(calendarNumericUnitFromSource('percent-saar')).toBe('percent')
    expect(calendarNumericUnitFromSource('thousands')).toBe('thousands')
    expect(calendarNumericUnitFromSource(' PERCENT ')).toBe('percent')
    // 认不出的词汇 → undefined（**不是** `unknown`：`unknown` 是「单位就是不明」，这里是「这个词我们不认识」）。
    expect(calendarNumericUnitFromSource('people')).toBeUndefined()
    expect(calendarNumericUnitFromSource('')).toBeUndefined()
    expect(calendarNumericUnitFromSource(undefined)).toBeUndefined()
  })

  it('量纲由 measure 决定的那一档：率类都是百分比，其余不猜', () => {
    expect(calendarNumericUnitHintForMetricKey('US.CPI.NSA.YOY')).toBe('percent')
    expect(calendarNumericUnitHintForMetricKey('DE.CPI.NSA.MOM')).toBe('percent')
    expect(calendarNumericUnitHintForMetricKey('US.UNEMPLOYMENT.SA.RATE')).toBe('percent')
    expect(calendarNumericUnitHintForMetricKey('US.GDP.SA.ANNUALIZED_QOQ')).toBe('percent')
    // 水平/变动/计数：单位取决于该序列报的尺度，一律不猜。
    expect(calendarNumericUnitHintForMetricKey('US.NONFARM.SA.CHANGE')).toBeUndefined()
    expect(calendarNumericUnitHintForMetricKey('US.ISM_MANUFACTURING.SA.LEVEL')).toBeUndefined()
    expect(calendarNumericUnitHintForMetricKey('US.JOBLESS_CLAIMS_INITIAL.SA.COUNT')).toBeUndefined()
    // 码表里没有的码、空值：不猜。
    expect(calendarNumericUnitHintForMetricKey('US.CODE_THAT_DOES_NOT_EXIST')).toBeUndefined()
    expect(calendarNumericUnitHintForMetricKey('')).toBeUndefined()
    expect(calendarNumericUnitHintForMetricKey(undefined)).toBeUndefined()
  })

  it('表只声明 measure，不开第二张 per-code 表：拿到的提示必须与 measure 表一致', () => {
    const hinted = Object.keys(marketCalendarCodeTable).filter((code) => calendarNumericUnitHintForMetricKey(code) !== undefined)
    // 当前码表这一档（率类）上百个码；一个都拿不到说明表没接上。
    expect(hinted.length).toBeGreaterThan(90)
    for (const code of hinted) {
      const measure = marketCalendarCodeTable[code]!.measure
      expect(calendarNumericUnitByMeasure[measure]).toBe(calendarNumericUnitHintForMetricKey(code))
    }
    // 反向：measure 表里有的档，码表里每个这种码都拿得到，不许只覆盖一部分。
    for (const [code, row] of Object.entries(marketCalendarCodeTable)) {
      if (calendarNumericUnitByMeasure[row.measure] === undefined) continue
      expect(calendarNumericUnitHintForMetricKey(code)).toBe(calendarNumericUnitByMeasure[row.measure])
    }
  })
})