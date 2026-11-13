import { describe, expect, it } from 'vitest'

import { marketCalendarCountryNames } from './marketCalendarDisplayNameTables'

/**
 * 国家名只从国家码补，**码不认识就不补**。
 *
 * 新源只给 `country_code`（`US`），旧源只给 `country_name`，所以投影必须按码补名字；
 * 但补的前提是码在表里——猜国名比不显示更糟（读者会以为那是事实）。
 */
describe('国家名表', () => {
  it('每个码都有中英两个名字，且一个码只对应一个国家', () => {
    const keys = Object.keys(marketCalendarCountryNames)
    expect(keys.length).toBeGreaterThan(0)
    expect(new Set(keys).size).toBe(keys.length)
    for (const [code, names] of Object.entries(marketCalendarCountryNames)) {
      expect(code).toMatch(/^[A-Z]{2}$/)
      expect(names.zh.length).toBeGreaterThan(0)
      expect(names.en.length).toBeGreaterThan(0)
      expect(names.zh).not.toBe(names.en)
    }
  })

  it('库里实际出现的码都在表里（US / DE），认不出的码不猜', () => {
    // 真库当前只有 US、DE 两种码；新码出现时宁可先不显示国家名，也不许编一个。
    expect(marketCalendarCountryNames.US).toEqual({ zh: '美国', en: 'United States' })
    expect(marketCalendarCountryNames.DE).toEqual({ zh: '德国', en: 'Germany' })
    expect(marketCalendarCountryNames.ZZ).toBeUndefined()
  })
})
