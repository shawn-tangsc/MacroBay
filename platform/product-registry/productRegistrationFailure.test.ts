import { describe, expect, it } from 'vitest'

import { ProductRegistrationFailure, productIdOf, runProductRegistration } from './productRegistrationFailure'

describe('product registration failure', () => {
  it('carries the product id and the original message', async () => {
    const error = await runProductRegistration('market-intelligence', () => {
      throw new Error('route "mind.intel.dashboard" is not declared')
    }).catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(ProductRegistrationFailure)
    expect(productIdOf(error)).toBe('market-intelligence')
    expect((error as Error).message).toBe(
      'product "market-intelligence" failed to register: route "mind.intel.dashboard" is not declared'
    )
    // 原始错误留在 cause 里，排查时不会丢。
    expect((error as Error).cause).toBeInstanceOf(Error)
  })

  it('keeps an already-attributed failure instead of nesting it', async () => {
    const inner = new ProductRegistrationFailure('inner-product', new Error('boom'))
    const error = await runProductRegistration('outer-product', () => {
      throw inner
    }).catch((thrown: unknown) => thrown)

    // 再包一层会把真正的产品与原因埋深，日志里那句话就读不出来了。
    expect(error).toBe(inner)
    expect(productIdOf(error)).toBe('inner-product')
  })

  it('reports no product id for a failure that never went through registration', () => {
    expect(productIdOf(new Error('boom'))).toBeNull()
    expect(productIdOf('boom')).toBeNull()
    expect(productIdOf(null)).toBeNull()
  })

  it('passes a successful registration through untouched', async () => {
    await expect(runProductRegistration('market-intelligence', () => undefined)).resolves.toBeUndefined()
  })
})
