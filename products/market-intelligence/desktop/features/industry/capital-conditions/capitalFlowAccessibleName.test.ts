import { describe, expect, it } from 'vitest'

import { flowAccessibleAmount, flowAccessibleName, type FlowAccessibleText } from './capitalFlowAccessibleName'

const text: FlowAccessibleText = {
  a11yAmountYi: '{value} 亿美元',
  a11yAmountWan: '{value} 万',
  a11yAmountMillion: '{value} million US dollars',
  a11yNoFlow: '没有净流入',
  a11yLabel: '{direction} {amount}',
  a11yCell: '{amount}，{scope}',
  flowDirections: { inflow: '净流入', outflow: '净流出', zero: '持平' }
}

// English carries only its own unit template: a spread of the Chinese set would keep 亿 around.
const english: FlowAccessibleText = {
  a11yAmountMillion: '{value} million US dollars',
  a11yNoFlow: 'No net inflow',
  a11yLabel: '{direction} {amount}',
  a11yCell: '{amount}, {scope}',
  flowDirections: { inflow: 'Net inflow', outflow: 'Net outflow', zero: 'Flat' }
}

describe('flowAccessibleAmount', () => {
  it('speaks 亿 from one hundred million up', () => {
    expect(flowAccessibleAmount(text, 402_600_000)).toBe('4.026 亿美元')
    expect(flowAccessibleAmount(text, 125_000_000)).toBe('1.25 亿美元')
  })

  it('speaks 万 below that, so a small amount is still a number a person says', () => {
    expect(flowAccessibleAmount(text, 82_400_000)).toBe('8240 万')
    expect(flowAccessibleAmount(text, -45_200_000)).toBe('4520 万')
    expect(flowAccessibleAmount(text, 231_400_000)).toBe('2.314 亿美元')
  })

  it('says there is no net inflow for zero instead of reading a number', () => {
    expect(flowAccessibleAmount(text, 0)).toBe('没有净流入')
    expect(flowAccessibleAmount(english, 0)).toBe('No net inflow')
  })

  it('stays in millions in English', () => {
    expect(flowAccessibleAmount(english, 402_600_000)).toBe('402.6 million US dollars')
    expect(flowAccessibleAmount(english, 82_400_000)).toBe('82.4 million US dollars')
  })
})

describe('flowAccessibleName', () => {
  it('names direction, amount and scope', () => {
    expect(flowAccessibleName(text, 402_600_000, 'inflow', '全部美元稳定币'))
      .toBe('净流入 4.026 亿美元，全部美元稳定币')
    expect(flowAccessibleName(text, -318_400_000, 'outflow', '全部美元稳定币'))
      .toBe('净流出 3.184 亿美元，全部美元稳定币')
  })

  it('does not say the direction twice on a flat row', () => {
    expect(flowAccessibleName(text, 0, 'zero', '全部美元稳定币')).toBe('没有净流入，全部美元稳定币')
  })

  it('keeps the sign out of the spoken amount and puts it in the direction instead', () => {
    expect(flowAccessibleName(text, -1_000_000, 'outflow', '全部美元稳定币'))
      .not.toContain('-')
  })

  it('leaves a missing template parameter visible instead of swallowing it', () => {
    const incomplete = { ...text, a11yCell: '{amount}，{missing}' }
    expect(flowAccessibleName(incomplete, 1_000_000, 'inflow', '全部美元稳定币'))
      .toContain('{missing}')
  })
})
