import { describe, expect, it } from 'vitest'

import { marketCalendarCodeTable } from './marketCalendarCodeTable'
import { marketCalendarCountryCodeTable } from './marketCalendarCountryCodeTable'
import whitelist from './marketCalendarPeriodDerivationWhitelist.json'

/**
 * **期次推算的两条守卫**（Chief 2026-11-19 第 1 笔）：`release-structure` 是我们「推」出来的期次，
 * 红线是「期次不许按发布节奏推」——所以它只能出现在极少数码上，且必须与周度频率同时成立。
 */
const rows = [...new Map([...Object.values(marketCalendarCodeTable),
  ...Object.values(marketCalendarCountryCodeTable)].map((row) => [row.code, row])).values()]
  .filter((row) => row.status === 'active')

describe('期次推算守卫', () => {
  it('① `release-structure` 只能配 `frequency = weekly`', () => {
    const wrong = rows.filter((row) => row.periodDerivation === 'release-structure'
      && row.officialSeries?.frequency !== 'weekly').map((row) => row.code)
    expect(wrong, `非周度却标了 release-structure：${wrong.join(', ')}`).toEqual([])
  })

  it('② `release-structure` 只允许白名单里的码（白名单是数据文件，不是代码常量）', () => {
    const allowed = new Set(whitelist.codes as readonly string[])
    const outside = rows.filter((row) => row.periodDerivation === 'release-structure'
      && !allowed.has(row.code)).map((row) => row.code)
    expect(outside, `白名单外的码用了 release-structure：${outside.join(', ')}`).toEqual([])
  })
})

describe('officialSeries.units 闭集（2026-11-19）', () => {
  it('④ units 只能是 pc1 | pch | value | chg 之一', () => {
    const allowed = new Set(['pc1', 'pch', 'value', 'chg'])
    const bad = rows.filter((row) => row.officialSeries?.units !== undefined
      && !allowed.has(row.officialSeries.units)).map((row) => `${row.code}:${String(row.officialSeries?.units)}`)
    expect(bad, `units 越界：${bad.join(', ')}`).toEqual([])
  })

  it('⑤ 非农用源侧 `chg`（水平序列 + 变动单位），失业率用 `value`', () => {
    const all = [...Object.values(marketCalendarCodeTable), ...Object.values(marketCalendarCountryCodeTable)]
    const byCode = new Map(all.map((row) => [row.code, row]))
    expect(byCode.get('US.NONFARM.SA.CHANGE')?.officialSeries)
      .toEqual({ seriesId: 'PAYEMS', units: 'chg', frequency: 'monthly' })
    expect(byCode.get('US.UNEMPLOYMENT.SA.RATE')?.officialSeries)
      .toEqual({ seriesId: 'UNRATE', units: 'value', frequency: 'monthly' })
  })
})
