import { describe, expect, it } from 'vitest'

import { legacyIndicatorIdsByMetricKey, resolveMacroIndicatorFacts, type MacroIndicatorCardRow } from './macroIndicatorCardFacts'

/**
 * 取值链的判据用**真库里的那几条数**钉住：
 * - CPI 2026-10 的年率本期是空的、上一期 3.7（新旧源都空，结构性：2025-10 从未发布）；
 * - 非农本期 165、首发布上期 29（修订后是 60，不许换着用）；
 * - 核心 PCE 本月没有发布行。
 */
const cpiRow: MacroIndicatorCardRow = {
  provider: 'narwhal',
  measureKeys: ['US.CORE_CPI.SA.MOM', 'US.CPI.NSA.YOY', 'US.CORE_CPI.NSA.YOY'],
  primaryMetricKey: 'US.CORE_CPI.SA.MOM',
  measureValues: { 'US.CORE_CPI.SA.MOM': 0.3, 'US.CPI.SA.MOM': 0.4 },
  // 上一期（9 月）实际值；本期（10 月）年率结构性缺失。
  previousAsPublished: 3.7,
  period: '2026-10',
  releasedAt: '2026-11-10T13:30:00.000Z',
  unit: 'percent'
}

const payrollRow: MacroIndicatorCardRow = {
  provider: 'narwhal',
  measureKeys: ['US.NONFARM.SA.CHANGE', 'US.UNEMPLOYMENT.SA.RATE'],
  primaryMetricKey: 'US.GOVERNMENT_PAYROLLS.SA.CHANGE',
  measureValues: { 'US.NONFARM.SA.CHANGE': 165 },
  previousAsPublished: 29,
  period: '2026-10',
  releasedAt: '2026-11-06T13:30:00.000Z',
  unit: 'thousands'
}

const rowFor = (rows: readonly MacroIndicatorCardRow[]) =>
  Object.fromEntries(resolveMacroIndicatorFacts(rows).map((fact) => [fact.metricKey, fact]))

describe('macro indicator card facts', () => {
  it('reports 未提供 for this period and still carries last period when the value is structurally absent', () => {
    const cpi = rowFor([cpiRow])['US.CPI.NSA.YOY']!
    expect(cpi.state).toBe('missing-current')
    expect(cpi.previousAsPublished).toBe(3.7)
    // 不许把主 measure 的值（核心月率 0.3）当成 CPI 年率。
    expect(cpi.value).toBeUndefined()
  })

  it('takes the value of the measure, not the release row primary value', () => {
    const payrolls = rowFor([payrollRow])['US.NONFARM.SA.CHANGE']!
    expect(payrolls).toMatchObject({ state: 'provided', value: 165, previousAsPublished: 29, source: 'narwhal' })
    // 较上期 = 165 − 29 = +136K（不是 165 − 60）。
    expect(payrolls.value! - payrolls.previousAsPublished!).toBe(136)
  })

  /**
   * 主位取的是**主测度**，不是「组里第一个有值的」。
   *
   * 这条专门防一种改法：把取值改成遍历组内 measure、取第一个有数的那条——那样 CPI 主位会变成
   * 核心月率 0.3%，而新闻里说的是年率 3.7。所以这里让两个测度**同时有值**，主位必须是年率。
   */
  it('takes the primary measure, not the first measure that happens to have a value', () => {
    const both: MacroIndicatorCardRow = {
      ...cpiRow,
      // 组里第一个有值的是核心月率（0.3）；整体年率（3.7）才是主测度。
      measureValues: { 'US.CORE_CPI.SA.MOM': 0.3, 'US.CPI.SA.MOM': 0.4, 'US.CPI.NSA.YOY': 3.7 }
    }
    const cpi = rowFor([both])['US.CPI.NSA.YOY']!
    expect(cpi).toMatchObject({ state: 'provided', value: 3.7 })
    expect(cpi.value).not.toBe(0.3)
  })

  it('does not use the revised previous: the row carries the as-published one or nothing', () => {
    const revised: MacroIndicatorCardRow = { ...payrollRow, previousAsPublished: undefined }
    const fact = rowFor([revised])['US.NONFARM.SA.CHANGE']!
    expect(fact.state).toBe('provided')
    expect(fact.previousAsPublished).toBeUndefined()
  })

  it('falls back to the legacy source when the new one has no value for the measure', () => {
    const legacy: MacroIndicatorCardRow = {
      provider: '0xrouter',
      measureKeys: ['US.NONFARM.SA.CHANGE'],
      primaryMetricKey: 'US.NONFARM.SA.CHANGE',
      value: 165,
      previousAsPublished: 29,
      period: '2026-10',
      releasedAt: '2026-11-06T13:30:00.000Z',
      unit: 'thousands'
    }
    expect(rowFor([legacy])['US.NONFARM.SA.CHANGE']).toMatchObject({ state: 'provided', source: '0xrouter', value: 165 })
  })

  it('says 未收录 when the indicator has no release row at all (核心 PCE this month)', () => {
    expect(rowFor([cpiRow, payrollRow])['US.CORE_PCE.SA.YOY']).toMatchObject({ state: 'not-recorded' })
  })

  it('ignores a legacy row whose primary identity is a different measure', () => {
    const wrong: MacroIndicatorCardRow = {
      provider: '0xrouter',
      measureKeys: ['US.CPI.NSA.YOY'],
      primaryMetricKey: 'US.CORE_CPI.SA.MOM',
      value: 0.3,
      releasedAt: '2026-11-10T13:30:00.000Z'
    }
    expect(rowFor([wrong])['US.CPI.NSA.YOY']!.value).toBeUndefined()
  })

  it('reverses the legacy indicator ids from the one existing table', () => {
    expect(legacyIndicatorIdsByMetricKey('US.CPI.NSA.YOY')).toEqual(['8637'])
    expect(legacyIndicatorIdsByMetricKey('US.NONFARM.SA.CHANGE')).toEqual(['8656'])
    expect(legacyIndicatorIdsByMetricKey('US.CORE_PCE.SA.YOY')).toEqual([])
  })
})
