import { describe, expect, it } from 'vitest'

import { filterVisibleByTier } from './marketCalendarTierVisibility'

const entry = (metricKey: string) => ({ metricKey, item: metricKey })

describe('日历按分级收窄：只出一级二级，其余进计数行', () => {
  it('格子只写一级二级的名字，且最多两条；其余全部计入数字', () => {
    const employment = ['US.NONFARM.SA.CHANGE', 'US.UNEMPLOYMENT.SA.RATE', 'US.AHE.SA.MOM',
      'US.AHE.NSA.YOY', 'US.PARTICIPATION_RATE.SA.RATE', 'US.UNEMPLOYMENT_U6.SA.RATE',
      'US.REAL_AHE.NONE.MOM', 'US.REAL_AHE.NONE.YOY', 'US.GOVERNMENT_PAYROLLS.SA.CHANGE',
      'US.MANUFACTURING_PAYROLLS.SA.CHANGE', 'US.PRIVATE_PAYROLLS.SA.CHANGE',
      'US.AVERAGE_WEEKLY_HOURS.SA.LEVEL'].map(entry)
    const result = filterVisibleByTier(employment)
    // 标了级的只有四个（非农、失业率、时薪月率、时薪年率），其余八个未分级。
    // 格子里最多显示 2 条 → 露名字的是前两条一级，剩下 10 条全进数字。
    expect(result.visible).toEqual(['US.NONFARM.SA.CHANGE', 'US.UNEMPLOYMENT.SA.RATE'])
    expect(result.hiddenCount).toBe(10)
  })

  it('未标级的名字绝不出现在格子里，但一定计入数字（事件型与源内身份也算未标级）', () => {
    const result = filterVisibleByTier([entry('US.PPI.NSA.YOY'), entry('evt.central-bank-speech'),
      entry('r-source-id'), entry('US.CPI.NSA.YOY')])
    expect(result.visible).toEqual(['US.CPI.NSA.YOY'])
    expect(result.hiddenCount).toBe(3)   // 数字不为 0 → 界面必须画出那行计数
  })

  it('数字必须对得上：露名字 + 计数 = 那一天的全部条目（一条都不许丢）', () => {
    const all = ['US.CPI.NSA.YOY', 'US.CORE_CPI.NSA.YOY', 'US.NONFARM.SA.CHANGE', 'US.PPI.NSA.YOY',
      'evt.central-bank-speech', 'US.MICHIGAN_SENTIMENT.NONE.LEVEL'].map(entry)
    const result = filterVisibleByTier(all)
    expect(result.visible.length + result.hiddenCount).toBe(all.length)
  })
})
