import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { marketCalendarReleaseGroupByMetricKey as groupOf,
  marketCalendarReleaseGroupPrimary as primaryOf } from './marketCalendarReleaseGroups'

/** 数据常量守卫：一个码一个组；每个组恰好一个主测度且属于该组。 */
describe('发布组常量', () => {
  it('166 个码各有唯一组，组名是稳定英文标识', () => {
    expect(Object.keys(groupOf)).toHaveLength(166)
    for (const [metricKey, group] of Object.entries(groupOf)) {
      expect(metricKey.startsWith('US.'), metricKey).toBe(true)
      expect(group, metricKey).toMatch(/^us-[a-z0-9-]+$/)
    }
    expect(new Set(Object.values(groupOf)).size).toBe(57)
  })

  it('每个组一个主测度，且主测度属于该组', () => {
    expect(new Set(Object.keys(primaryOf))).toEqual(new Set(Object.values(groupOf)))
    for (const [group, metricKey] of Object.entries(primaryOf)) {
      expect(groupOf[metricKey], `${group} → ${metricKey}`).toBe(group)
    }
  })

  /**
   * **一份数据两处存的守卫**：常量是从 19 号表生成的，两边数量必须一致。
   * 2026-11-13 实际漂过一回——CSV 已到 164 码 / 57 组，代码还停在 161 / 56，
   * 于是 `US.CURRENT_ACCOUNT.NONE.DIFF` 有码无组，表现为「按组取主测度」取不到。
   *
   * `docs-private` 是内部文档、不进版本库，所以在没有那份表的机器上这条只能跳过；
   * 跳过时**不算通过**，用例名字里写明「仅本机可查」，别让人把它当成已经验过。
   */
  const csvPath = 'docs-private/iterations/0.4.4-calendar-sources/19-releaseGroup-美国.csv'
  it.skipIf(!existsSync(csvPath))('代码常量与 19 号表同数（仅本机可查）', () => {
    const lines = readFileSync(csvPath, 'utf8').trim().split('\n').slice(1)
    const codes = lines.map((line) => line.split(',')[0])
    const groups = lines.map((line) => line.split(',')[1])
    expect(new Set(codes)).toEqual(new Set(Object.keys(groupOf)))
    expect(new Set(groups)).toEqual(new Set(Object.values(groupOf)))
  })

  it('nowcast 与实质 GDP 不是一个组', () => {
    expect(groupOf['US.GDP_NOWCAST.SA.ANNUALIZED_QOQ']).not.toBe(groupOf['US.GDP.SA.ANNUALIZED_QOQ'])
  })
})
