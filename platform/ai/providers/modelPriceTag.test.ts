import { describe, expect, it } from 'vitest'

import type { ModelDefinition, ModelPricing } from './modelProviderTypes'
import { deriveModelPriceTag, resolveModelPriceTag, withModelPriceTag } from './modelPriceTag'

const pricing = (promptPerMillion: number, completionPerMillion: number, hasDiscount = false): ModelPricing => ({
  currency: 'USD',
  promptPerMillion,
  completionPerMillion,
  hasDiscount
})

describe('normalized model price tag', () => {
  it('treats zero input and output prices as free regardless of provider', () => {
    // OpenRouter 的免费模型就是 0 价（per-token 价格缩放后为 0）。
    expect(deriveModelPriceTag({ pricing: pricing(0, 0) })).toBe('free')
    expect(deriveModelPriceTag({ pricing: pricing(0, 2) })).toBe('paid')
    expect(deriveModelPriceTag({ pricing: pricing(2, 0) })).toBe('paid')
    expect(deriveModelPriceTag({})).toBe('paid')
  })

  it('marks discounted paid models as discount, not free', () => {
    expect(deriveModelPriceTag({ pricing: pricing(0, 2, true) })).toBe('discount')
    expect(deriveModelPriceTag({ pricing: pricing(8, 28, true) })).toBe('discount')
  })

  it('lets a manual free mark win over discount and price', () => {
    expect(deriveModelPriceTag({ freeOverride: true, pricing: pricing(8, 28, true) })).toBe('free')
    expect(deriveModelPriceTag({ freeOverride: true })).toBe('free')
  })

  it('prefers the persisted enum but falls back for legacy models', () => {
    const legacy = { pricing: pricing(0, 0) } satisfies Pick<ModelDefinition, 'pricing'>
    expect(resolveModelPriceTag(legacy)).toBe('free')
    expect(resolveModelPriceTag({ ...legacy, priceTag: 'paid' })).toBe('paid')
    expect(resolveModelPriceTag({ freeOverride: true, priceTag: 'paid' })).toBe('free')
  })

  it('writes the enum without dropping the other fields', () => {
    const model = { id: 'm', pricing: pricing(0, 0), contextLength: 1000 }
    expect(withModelPriceTag(model)).toEqual({ ...model, priceTag: 'free' })
  })
})
