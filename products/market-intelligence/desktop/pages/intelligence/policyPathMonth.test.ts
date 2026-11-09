import { describe, expect, it } from 'vitest'

import { policyPathDay, policyPathMonth } from './policyPathMonth'

/**
 * 日历日的写法归语言，归日子本身不归时区。
 *
 * 这两个函数吃的都是**日历日**（`2026-12-09`），不是瞬时：把它当瞬时按读者时区换算，西半球读者会看到
 * 会前一天。所以判据两条：一是语言差异真的生效（中文 `12月9日` / 英文 `Dec 9`），二是 UTC 锚定不挪日
 * ——同一天在任何读者时区里都是同一天。
 */
describe('policy path calendar dates', () => {
  it('writes a calendar day the way the reader’s language does', () => {
    expect(policyPathDay('2026-12-09', 'zh-CN')).toBe('12月9日')
    expect(policyPathDay('2026-12-09', 'en-US')).toBe('Dec 9')
  })

  it('keeps the day it was given instead of shifting it into another timezone', () => {
    // 一月一日与十二月三十一日是最容易在换算里跨年的两天。
    expect(policyPathDay('2027-01-01', 'en-US')).toBe('Jan 1')
    expect(policyPathDay('2026-12-31', 'en-US')).toBe('Dec 31')
    expect(policyPathDay('2027-01-01', 'zh-CN')).toBe('1月1日')
  })

  it('hands back anything that is not a date instead of inventing one', () => {
    // 2026-02-30 会被 `Date.UTC` 顺延到三月：那不是日期，原样交回去。
    expect(policyPathDay('2026-02-30', 'zh-CN')).toBe('2026-02-30')
    expect(policyPathDay('', 'zh-CN')).toBe('')
    expect(policyPathDay('2026-12', 'zh-CN')).toBe('2026-12')
  })

  it('still names the month for the chip label', () => {
    expect(policyPathMonth('2026-12-09', 'zh-CN')).toBe('12')
    expect(policyPathMonth('2026-12-09', 'en-US')).toBe('December')
    expect(policyPathMonth('2026-13-09', 'zh-CN')).toBe('')
  })
})
