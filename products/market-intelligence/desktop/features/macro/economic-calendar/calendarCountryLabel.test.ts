import { describe, expect, it } from 'vitest'

import { calendarCountryLabel } from './calendarCountryLabel'

/**
 * 三级回退的**唯一实现**的纯函数判据：三条输入三种输出，不需要 DOM 就能验。
 *
 * 用户 2026-11-16 定了两次 —— 先「名字是什么就显示什么」，再「没有国家数据的时候，显示未知国家」。
 * 行组件与详情面板都只调这一个函数，所以这三条也就是那两处的行为。
 */
const text = { market: { unknownCountry: '未知国家' } } as const

describe('calendarCountryLabel', () => {
  it('prefers the mapped name', () => {
    expect(calendarCountryLabel({ countryName: '美国', countryCode: 'US' }, text)).toBe('美国')
  })

  it('falls back to the raw code exactly as the source wrote it, without renaming or guessing', () => {
    // 映射表只收 alpha-2，`USA` 查不到名字——此时显示原值，不许改成 `US`。
    expect(calendarCountryLabel({ countryCode: 'USA' }, text)).toBe('USA')
    expect(calendarCountryLabel({ countryCode: 'US' }, text)).toBe('US')
    // 契约里 `countryCode` 可以是 null：那是「源没给」，不是空串。
    expect(calendarCountryLabel({ countryCode: null }, text)).toBe('未知国家')
  })

  it('never leaves the cell empty: an unknown country is a fact, not a blank', () => {
    // 「—」「N/A」读起来是「没有这一项」；这里是「我们不知道是哪国」，所以走 i18n 的那条文案。
    expect(calendarCountryLabel({}, text)).toBe('未知国家')
    expect(calendarCountryLabel({ countryName: undefined, countryCode: undefined }, text)).toBe('未知国家')
  })
})
