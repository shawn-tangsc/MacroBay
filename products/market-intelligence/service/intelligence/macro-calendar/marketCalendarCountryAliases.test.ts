import { describe, expect, it } from 'vitest'

import { classifyCalendarCountryCodes } from './0xrouter-calendar/zeroXRouterCalendarCollectionService'
import { marketCalendarCountryAliases, marketCalendarCountryCodeExceptions } from './marketCalendarCountryAliases'
import { isUnknownCountryCode, toAlpha2Country } from './marketCalendarMetricIdentity'

/**
 * 国家码别名表：**唯一定义处**，写入端与清理脚本都读它。
 * 用户 2026-11-19 看到日志里「未知国家码 19 种」——那是日志白名单写窄了，不是数据丢了。
 */
describe('国家码别名表', () => {
  it('新增的四个别名都能归一（SK 是源拿斯洛伐克码表示首尔，有数据依据）', () => {
    expect(toAlpha2Country('SWI')).toBe('CH')
    expect(toAlpha2Country('NOR')).toBe('NO')
    expect(toAlpha2Country('MEX')).toBe('MX')
    // 库里那两行的标题是「英国央行行长贝利在首尔发表讲话」——源把首尔挂在 SK 下。
    expect(toAlpha2Country('SK')).toBe('KR')
  })

  it('别名值只能是两位码或 EMU（唯一允许的非 ISO 例外）', () => {
    const bad = Object.entries(marketCalendarCountryAliases)
      .filter(([, alpha2]) => !/^[A-Z]{2}$/.test(alpha2) && !marketCalendarCountryCodeExceptions.includes(alpha2))
    expect(bad).toEqual([])
  })

  it('认识两位码、认识别名，认不出才叫未知', () => {
    for (const code of ['US', 'NZ', 'IT', 'TW', 'HK', 'SE', 'EMU']) expect(isUnknownCountryCode(code)).toBe(false)
    for (const code of ['JPN', 'UK', 'CAN', 'SWI', 'NOR', 'MEX', 'SK']) expect(isUnknownCountryCode(code)).toBe(false)
    // `ZZ` 是解析层的占位码（看起来像合法两位），它由 `placeholderCountryCode` 那条路单独数；
    // 这里用真正的杂码（三位、归不成两位）证明判据会红。
    expect(isUnknownCountryCode('XYZ')).toBe(true)
  })
})

describe('采集日志的国家码分类', () => {
  it('真未知与「可归一别名」分开数：JPN/UK 进别名待补，ZZ 进真未知', () => {
    const drafts = [
      ...Array.from({ length: 3 }, () => ({ countryCode: 'JPN' })),
      ...Array.from({ length: 2 }, () => ({ countryCode: 'UK' })),
      { countryCode: 'NZ' },
      { countryCode: 'XYZ' },
      { placeholderCountryCode: 'ZZ' }
    ]
    expect(classifyCalendarCountryCodes(drafts)).toEqual({
      unknown: { XYZ: 1, ZZ: 1 },
      pendingAliases: { JPN: 3, UK: 2 }
    })
  })

  it('全是认识的码 → 两类都为空（不再往日志里刷「未知」）', () => {
    expect(classifyCalendarCountryCodes([{ countryCode: 'US' }, { countryCode: 'NZ' }, { countryCode: 'EMU' }]))
      .toEqual({ unknown: {}, pendingAliases: {} })
  })
})
