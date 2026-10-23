import { describe, expect, it } from 'vitest'

import type { ModelPricing } from './modelProviderTypes'
import { isFreeModel, isFreePricedModel } from './modelFreeStatus'

const pricing = (promptPerMillion: number, completionPerMillion: number, hasDiscount = false): ModelPricing => ({
  currency: 'USD',
  promptPerMillion,
  completionPerMillion,
  hasDiscount
})

describe('model free status', () => {
  it('only treats zero input and output prices as free', () => {
    expect(isFreePricedModel(pricing(0, 0))).toBe(true)
    expect(isFreePricedModel(pricing(0, 2))).toBe(false)
    expect(isFreePricedModel(pricing(2, 0))).toBe(false)
    expect(isFreePricedModel(undefined)).toBe(false)
  })

  it('does not treat a discounted paid model as free', () => {
    expect(isFreePricedModel(pricing(0, 2, true))).toBe(false)
    expect(isFreePricedModel(pricing(1, 1, true))).toBe(false)
  })

  it('lets an explicit user mark override missing or non-zero pricing', () => {
    expect(isFreeModel({ freeOverride: true })).toBe(true)
    expect(isFreeModel({ freeOverride: true, pricing: pricing(8, 28) })).toBe(true)
    expect(isFreeModel({ freeOverride: false, pricing: pricing(0, 0) })).toBe(true)
    expect(isFreeModel({ pricing: pricing(8, 28) })).toBe(false)
    expect(isFreeModel({})).toBe(false)
  })
})
