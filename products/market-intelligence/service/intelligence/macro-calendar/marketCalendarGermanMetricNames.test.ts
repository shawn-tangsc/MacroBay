import { describe, expect, it } from 'vitest'

import { germanMetricNames, germanSourceMetricMappings } from './marketCalendarGermanSourceMappings'

/**
 * 德国名表：**名字由码决定，不由某一期决定**（用户 2026-11-17 的教训）。
 *
 * 早先这 35 条是照源样本名生成的，于是每条都带「9月」「终值」——十月的事件会显示成「9月…」，
 * 而 `DE.CPI.NSA.MOM` 与 `.YOY` **显示成同一个名字**。这三条判据挡的就是这一类：
 * 名字里出现期次/阶段、同族不同测度同名、英文名被截成半个词。
 */
const rows = Object.entries(germanMetricNames)
/** 期次与修订阶段：出现任何一个，就说明这条名字来自「某一期」而不是「这个码」。 */
const PERIOD_OR_STAGE = /\d{1,2}月|第[一二三四1-4]季度|终值|初值|修正|快报/u
/** 族＝去掉最后一段测度（`DE.CPI.NSA.MOM` → `DE.CPI.NSA`）。 */
const familyOf = (code: string): string => code.slice(0, code.lastIndexOf('.'))
const parensBalanced = (value: string): boolean =>
  (value.match(/\(/gu) ?? []).length === (value.match(/\)/gu) ?? []).length

describe('德国码名表', () => {
  it('每个码都有名字，且没有多出来的名字', () => {
    const codes = new Set(Object.values(germanSourceMetricMappings).map((entry) => entry.metricKey))
    expect(new Set(Object.keys(germanMetricNames))).toEqual(codes)
    for (const [code, name] of rows) {
      for (const value of [name.zhFull, name.zhShort, name.enFull, name.enShort]) {
        expect(value.trim(), code).not.toBe('')
      }
    }
  })

  it('名字里不出现期次与修订阶段', () => {
    for (const [code, name] of rows) {
      expect(name.zhFull, `${code} zhFull`).not.toMatch(PERIOD_OR_STAGE)
      expect(name.zhShort, `${code} zhShort`).not.toMatch(PERIOD_OR_STAGE)
      expect(name.enFull, `${code} enFull`).not.toMatch(/\((Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(uary|ruary|ch|il|e|y|ust|tember|ober|ember)?\)/u)
      expect(name.enFull, `${code} enFull`).not.toMatch(/\(Final\)|\(Preliminary\)/u)
    }
  })

  it('同族不同测度的名字两两不同（月率与年率不能叫同一个名字）', () => {
    const byFamily = new Map<string, readonly (readonly [string, string])[]>()
    for (const [code, name] of rows) {
      const family = familyOf(code)
      byFamily.set(family, [...(byFamily.get(family) ?? []), [code, name.zhFull] as const])
    }
    for (const [family, members] of byFamily) {
      expect(new Set(members.map(([, zh]) => zh)).size, family).toBe(members.length)
    }
  })

  it('英文名不截断：括号成对，短名不是长名被切掉的一半', () => {
    for (const [code, name] of rows) {
      expect(parensBalanced(name.enFull), `${code} enFull 括号不成对：${name.enFull}`).toBe(true)
      expect(parensBalanced(name.enShort), `${code} enShort 括号不成对：${name.enShort}`).toBe(true)
      // 旧写法就是「把 enFull 截到 20 字」，会截在词中间：这条把那种写法挡掉。
      expect(name.enShort, `${code} enShort 是截断出来的`).not.toBe(name.enFull.slice(0, 20))
    }
  })
})
