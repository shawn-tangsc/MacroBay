import { describe, expect, it } from 'vitest'

import { flowAccessibleAmount, flowAccessibleName, type FlowAccessibleText } from './capitalFlowAccessibleName'

const text: FlowAccessibleText = {
  a11yAmount: '{value} 亿美元',
  a11yLabel: '{direction} {amount}',
  a11yCell: '{amount}，{scope}',
  flowDirections: { inflow: '净流入', outflow: '净流出', zero: '持平' }
}

const english: FlowAccessibleText = {
  a11yAmount: '{value} million US dollars',
  a11yLabel: '{direction} {amount}',
  a11yCell: '{amount}, {scope}',
  flowDirections: { inflow: 'Net inflow', outflow: 'Net outflow', zero: 'Flat' }
}

describe('flowAccessibleAmount', () => {
  it('speaks 亿 in Chinese while the screen keeps M', () => {
    expect(flowAccessibleAmount(text, 402_600_000, 'zh-CN')).toBe('4.026 亿美元')
    expect(flowAccessibleAmount(english, 402_600_000, 'en-US')).toBe('402.6 million US dollars')
  })
})

describe('flowAccessibleName', () => {
  it('names direction, amount and scope', () => {
    expect(flowAccessibleName(text, 402_600_000, 'inflow', '全部美元稳定币', 'zh-CN'))
      .toBe('净流入 4.026 亿美元，全部美元稳定币')
    expect(flowAccessibleName(text, -318_400_000, 'outflow', '全部美元稳定币', 'zh-CN'))
      .toBe('净流出 3.184 亿美元，全部美元稳定币')
  })

  it('keeps the sign out of the spoken amount and puts it in the direction instead', () => {
    expect(flowAccessibleName(text, -1_000_000, 'outflow', '全部美元稳定币', 'zh-CN'))
      .not.toContain('-')
  })

  it('leaves a missing template parameter visible instead of swallowing it', () => {
    const incomplete = { ...text, a11yCell: '{amount}，{missing}' }
    expect(flowAccessibleName(incomplete, 1_000_000, 'inflow', '全部美元稳定币', 'zh-CN'))
      .toContain('{missing}')
  })
})
