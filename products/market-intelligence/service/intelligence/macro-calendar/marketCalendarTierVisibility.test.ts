import { describe, expect, it } from 'vitest'

import { filterVisibleByTier } from './marketCalendarTierVisibility'

const entry = (metricKey: string) => ({ metricKey, item: metricKey })

describe('日历按分级收窄：只出一级二级，其余进计数行', () => {
  it('就业组十二个身份里，一级的一律保留（不许被误过滤）', () => {
    const employment = ['US.NONFARM.SA.CHANGE', 'US.UNEMPLOYMENT.SA.RATE', 'US.AHE.SA.MOM',
      'US.AHE.NSA.YOY', 'US.PARTICIPATION_RATE.SA.RATE', 'US.UNEMPLOYMENT_U6.SA.RATE',
      'US.REAL_AHE.NONE.MOM', 'US.REAL_AHE.NONE.YOY', 'US.GOVERNMENT_PAYROLLS.SA.CHANGE',
      'US.MANUFACTURING_PAYROLLS.SA.CHANGE', 'US.PRIVATE_PAYROLLS.SA.CHANGE',
      'US.AVERAGE_WEEKLY_HOURS.SA.LEVEL'].map(entry)
    const result = filterVisibleByTier(employment)
    // 就业组里**标了级的只有四个**（非农、失业率、时薪月率、时薪年率）；其余八个未分级 → 进计数。
    // 这不是误过滤：分级清单本身只标到这四个，未标级的要出现在「另有 N 条」里。
    expect(result.visible).toHaveLength(4)
    expect(result.hiddenCount).toBe(8)
    expect(result.visible).toContain('US.NONFARM.SA.CHANGE')
    expect(result.visible).toContain('US.UNEMPLOYMENT.SA.RATE')
  })

  it('未标级的行不会静默消失：一定给出计数（事件型与源内身份也算未标级）', () => {
    const result = filterVisibleByTier([entry('US.PPI.NSA.YOY'), entry('evt.central-bank-speech'),
      entry('r-source-id'), entry('US.CPI.NSA.YOY')])
    expect(result.visible).toEqual(['US.CPI.NSA.YOY'])
    expect(result.hiddenCount).toBe(3)   // 计数不为 0 → 界面必须画出「另有 3 条」
  })
})
