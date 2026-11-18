import { describe, expect, it } from 'vitest'

import { isUnknownCountryCode } from './marketCalendarCountryAliases'

/**
 * **判定标准是「能不能归成两位」，不是「长度是不是 2」**（Chief 2026-11-18）。
 *
 * 按长度判会把合法 ISO alpha-3（`JPN`/`CAN`/`CHN`）误判成未知码——真库这 47 行正是要归一的那批，
 * 误判的后果不是「没归一」，是**被当未知码跳过、行直接丢了**。
 */
describe('未知国家码判定：能归成两位就不算未知', () => {
  it('合法 alpha-3 能反查 → 不算未知（JPN/CAN/CHN）', () => {
    for (const code of ['JPN', 'CAN', 'CHN']) expect(isUnknownCountryCode(code), code).toBe(false)
  })

  it('别名表里的写法 → 不算未知（PHI/UK/GER）', () => {
    for (const code of ['PHI', 'UK', 'GER']) expect(isUnknownCountryCode(code), code).toBe(false)
  })

  it('EMU 是唯一允许的例外 → 不算未知', () => {
    expect(isUnknownCountryCode('EMU')).toBe(false)
  })

  it('拿不到两位的杂码才算未知（XYZ/AAA）', () => {
    for (const code of ['XYZ', 'AAA']) expect(isUnknownCountryCode(code), code).toBe(true)
  })
})
