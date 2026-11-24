import { describe, expect, it } from 'vitest'

import { calendarImportanceRows } from '../../../../service/intelligence/macro-calendar/calendarEventImportance'
import { productText } from '../../../shared/i18n/productText'
import {
  calendarEventExplanation,
  calendarEventExplanationKeyFor,
  calendarEventExplanationKeys
} from './calendarEventExplanation'

/**
 * 事件说明（R36 #34「说明文案」那一半）的判据：**族 → 概念键**必须覆盖全部高档族。
 *
 * 真实族清单不另抄一份：直接读重要度表里 `tier: 'high'` 的那些行（PRD 定的是「第一批覆盖
 * R44 高档族」）。将来加一个高档族而忘了加文案，这条当场红并点名族名——那正是「未登记的族
 * 不显示说明」会静默吞掉的东西。
 *
 * 概念键那张表（`04-event-explanations-final.md` §2）有 25 个键、覆盖 29 个族：四对同一份数据
 * 的族共用一段。这里同时判「共用」与「不共用」两向，避免把 `ANNUM_REAL_GDP` 那种水平值并进
 * 增长率那一段。
 */

/** 表里每一档行的身份 → 一个形状合法的指标码（只用来解族，测度/季调随便是谁）。 */
function metricKeyOf(row: (typeof calendarImportanceRows)[number]): string {
  return `${row.country}.${row.family}.NONE.LEVEL`
}

const highRows = calendarImportanceRows.filter((row) => row.tier === 'high')
const zhText = productText['zh-CN'].pages.intelligence.portal.calendar
const enText = productText['en-US'].pages.intelligence.portal.calendar
const zhExplanations = zhText.explanations
const enExplanations = enText.explanations

describe('calendarEventExplanation: 25 个概念键覆盖 29 个高档族', () => {
  it('高档族正好是 29 个（R44 定稿的组合）', () => {
    expect(highRows.map(metricKeyOf).sort()).toEqual([
      'EMU.POLICY_RATE.NONE.LEVEL', 'GB.POLICY_RATE.NONE.LEVEL', 'JP.POLICY_RATE.NONE.LEVEL',
      'US.ACTUAL_PERSONAL_CONSUMPTION_EXPENDITURE.NONE.LEVEL', 'US.AHE.NONE.LEVEL',
      'US.ANNUM_REAL_GDP.NONE.LEVEL', 'US.AVERAGE_WEEKLY_HOURS.NONE.LEVEL', 'US.CORE_CPI.NONE.LEVEL',
      'US.CORE_PCE.NONE.LEVEL', 'US.CORE_PERSONAL_CONSUMPTION_EXPENDITURE_PRICE.NONE.LEVEL',
      'US.CPI.NONE.LEVEL', 'US.FINAL_SALES.NONE.LEVEL', 'US.FOMC.NONE.LEVEL', 'US.GDP.NONE.LEVEL',
      'US.GDP_DEFLATOR.NONE.LEVEL', 'US.GOVERNMENT_PAYROLLS.NONE.LEVEL', 'US.MANUFACTURING_PAYROLLS.NONE.LEVEL',
      'US.NONFARM.NONE.LEVEL', 'US.PARTICIPATION_RATE.NONE.LEVEL', 'US.PCE.NONE.LEVEL',
      'US.PERSONAL_CONSUMPTION_EXPENDITURE.NONE.LEVEL', 'US.PERSONAL_CONSUMPTION_EXPENDITURE_PRICE.NONE.LEVEL',
      'US.PERSONAL_INCOME.NONE.LEVEL', 'US.PERSONAL_SPENDING.NONE.LEVEL', 'US.PRIVATE_PAYROLLS.NONE.LEVEL',
      'US.REAL_AHE.NONE.LEVEL', 'US.REAL_GDP.NONE.LEVEL', 'US.UNEMPLOYMENT.NONE.LEVEL',
      'US.UNEMPLOYMENT_U6.NONE.LEVEL'
    ])
  })

  it('每一个高档族都解得到一个键，且中英三段都非空', () => {
    for (const row of highRows) {
      const metricKey = metricKeyOf(row)
      const key = calendarEventExplanationKeyFor(metricKey)
      if (key === undefined) {
        // 点名是哪个族漏了：只说「有一条 undefined」下一个改表的人还得自己找。
        expect(key, `${row.country} × ${row.family} 没有说明文案`).toBeDefined()
        continue
      }
      for (const explanations of [zhExplanations, enExplanations]) {
        const paragraphs = explanations[key]
        expect(paragraphs, `${metricKey} → ${key} 缺文案`).toBeDefined()
        expect([paragraphs?.what, paragraphs?.why, paragraphs?.watch].map((value) => value?.trim().length ?? 0)
          .every((length) => length > 0), `${metricKey} → ${key} 有空白段`).toBe(true)
      }
    }
  })

  it('25 个概念键都至少被一族用到，没有无人引用的文案', () => {
    const used = new Set(highRows.map(metricKeyOf).map(calendarEventExplanationKeyFor))
    expect([...used].filter((key) => key === undefined)).toEqual([])
    expect([...used].sort()).toEqual([...calendarEventExplanationKeys].sort())
    expect(calendarEventExplanationKeys).toHaveLength(25)
  })

  it('四对同一份数据共用一段，它们各自的数据行不合并', () => {
    expect(calendarEventExplanationKeyFor('US.GDP.SA.ANNUALIZED_QOQ')).toBe('gdp-real-growth')
    expect(calendarEventExplanationKeyFor('US.REAL_GDP.NONE.ANNUALIZED_QOQ')).toBe('gdp-real-growth')
    expect(calendarEventExplanationKeyFor('US.PCE.SA.MOM')).toBe('pce-price')
    expect(calendarEventExplanationKeyFor('US.PERSONAL_CONSUMPTION_EXPENDITURE_PRICE.NONE.MOM')).toBe('pce-price')
    expect(calendarEventExplanationKeyFor('US.CORE_PCE.NSA.YOY')).toBe('core-pce-price')
    expect(calendarEventExplanationKeyFor('US.CORE_PERSONAL_CONSUMPTION_EXPENDITURE_PRICE.NONE.YOY')).toBe('core-pce-price')
    expect(calendarEventExplanationKeyFor('US.PERSONAL_SPENDING.SA.MOM')).toBe('personal-spending')
    expect(calendarEventExplanationKeyFor('US.PERSONAL_CONSUMPTION_EXPENDITURE.NONE.MOM')).toBe('personal-spending')
  })

  it('水平值不共用增长率那一段：ANNUM_REAL_GDP 是单独一个键', () => {
    expect(calendarEventExplanationKeyFor('US.ANNUM_REAL_GDP.NONE.AMOUNT')).toBe('gdp-real-level')
    expect(calendarEventExplanationKeyFor('US.ANNUM_REAL_GDP.NONE.AMOUNT')).not.toBe('gdp-real-growth')
  })

  it('利率决议按「国家 × POLICY_RATE」解，不按名字猜', () => {
    expect(calendarEventExplanationKeyFor('EMU.POLICY_RATE.NONE.RATE')).toBe('policy-rate-emu')
    expect(calendarEventExplanationKeyFor('GB.POLICY_RATE.NONE.RATE')).toBe('policy-rate-gb')
    expect(calendarEventExplanationKeyFor('JP.POLICY_RATE.NONE.RATE')).toBe('policy-rate-jp')
    // 别的辖区也有 POLICY_RATE 这件事，但没给它登记文案——不拿欧美日那三段顶上。
    expect(calendarEventExplanationKeyFor('CN.POLICY_RATE.NONE.RATE')).toBeUndefined()
  })

  it('未登记的族、别辖区的同名族、没有身份的行都不给键', () => {
    expect(calendarEventExplanationKeyFor('US.PPI.NONE.YOY')).toBeUndefined() // 中档族，第一批不写
    expect(calendarEventExplanationKeyFor('US.RETAIL_SALES.NONE.MOM')).toBeUndefined()
    expect(calendarEventExplanationKeyFor('EMU.CPI.NONE.YOY')).toBeUndefined() // CPI 只登记了美国的
    expect(calendarEventExplanationKeyFor('DE.CPI.NONE.YOY')).toBeUndefined()
    expect(calendarEventExplanationKeyFor(undefined)).toBeUndefined()
    expect(calendarEventExplanationKeyFor('')).toBeUndefined()
    expect(calendarEventExplanationKeyFor('US')).toBeUndefined()
    expect(calendarEventExplanationKeyFor('us.cpi.NSA.YOY')).toBeUndefined() // 大小写不对也不猜
  })

  it('取到键才给三段，顺序是 是什么 → 为什么值得看 → 看哪里', () => {
    expect(calendarEventExplanation('US.CPI.NSA.YOY', zhExplanations)).toEqual([
      zhExplanations.cpi.what, zhExplanations.cpi.why, zhExplanations.cpi.watch
    ])
    expect(calendarEventExplanation('US.PPI.NONE.YOY', zhExplanations)).toBeUndefined()
    expect(calendarEventExplanation(undefined, zhExplanations)).toBeUndefined()
  })
})