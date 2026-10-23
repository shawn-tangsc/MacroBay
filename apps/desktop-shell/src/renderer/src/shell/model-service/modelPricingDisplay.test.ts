import { describe, expect, it } from 'vitest'

import { platformText } from '../../i18n/platformText'
import { buildModelCostTitle, formatCompactNumber, formatModelCost, formatPriceNumber } from './modelPricingDisplay'

const labels = platformText['zh-CN'].models

function model(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm',
    name: 'M',
    capabilities: { chat: true },
    ...overrides
  }
}

describe('PLAT-62 model cost display', () => {
  it('formats compact context and prices without trailing zeros', () => {
    expect(formatCompactNumber(200000)).toBe('200K')
    expect(formatCompactNumber(1_000_000)).toBe('1M')
    expect(formatCompactNumber(1_350_000)).toBe('1.35M')
    expect(formatPriceNumber(8)).toBe('8')
    expect(formatPriceNumber(1.35)).toBe('1.35')
  })

  it('renders context · currency/prompt/currency/completion and a full title', () => {
    const priced = model({
      contextLength: 200000,
      pricing: { currency: 'CNY', promptPerMillion: 8, completionPerMillion: 28, cacheReadPerMillion: 2 }
    })
    expect(formatModelCost(priced)).toBe('200K · ¥8/¥28')
    expect(buildModelCostTitle(labels, priced)).toBe('上下文 200K · 输入 ¥8/M · 输出 ¥28/M · 缓存读 ¥2/M · 币种 CNY')
    expect(formatModelCost(model({
      contextLength: 128000,
      pricing: { currency: 'EUR', promptPerMillion: 1.35, completionPerMillion: 2 }
    }))).toBe('128K · EUR 1.35/EUR 2')
  })

  it('renders context only or pricing only instead of hiding the segment', () => {
    expect(formatModelCost(model({ contextLength: 200000 }))).toBe('200K')
    expect(formatModelCost(model({ pricing: { currency: 'CNY', promptPerMillion: 8, completionPerMillion: 28 } }))).toBe('¥8/¥28')
    expect(formatModelCost(model())).toBeNull()
    // 完整 tooltip 仍要求两者齐全（单状态行没有 tooltip）。
    expect(buildModelCostTitle(labels, model({ contextLength: 200000 }))).toBeNull()
    expect(buildModelCostTitle(labels, model({ pricing: { currency: 'CNY', promptPerMillion: 8, completionPerMillion: 28 } }))).toBeNull()
  })
})
