import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

import { createProductIpcRegistry } from '../ipc/productIpcRegistry'
import {
  createProductIpcInvoker,
  isProductDatabaseClosedError,
  isProductRuntimeUnavailableError
} from './productIpcInvoker'

const unavailableResult = { ok: false, error: { code: 'platform-unavailable' } }

function sealedRegistryWith(handler: () => unknown) {
  const registry = createProductIpcRegistry()
  registry.register('market-intelligence', 'marketAnalysis.listTimeline', handler)
  registry.seal([{ productId: 'market-intelligence', method: 'marketAnalysis.listTimeline' }])
  return registry
}

describe('product IPC invoker', () => {
  it('passes a normal product call through unchanged, including falsy results', async () => {
    for (const value of [{ items: [] }, 0, null, undefined]) {
      const invoke = createProductIpcInvoker({ registry: sealedRegistryWith(() => value) })
      await expect(invoke('market-intelligence', 'marketAnalysis.listTimeline')).resolves.toBe(value)
    }
  })

  it('answers a structured unavailable result when the runtime is closed, without touching the handler', async () => {
    let calls = 0
    const invoke = createProductIpcInvoker({
      registry: sealedRegistryWith(() => { calls += 1; return { items: [] } }),
      isRuntimeClosed: () => true
    })

    await expect(invoke('market-intelligence', 'marketAnalysis.listTimeline')).resolves.toEqual(unavailableResult)
    expect(calls).toBe(0)
  })

  it('answers a structured unavailable result after the registry is closed', async () => {
    const registry = sealedRegistryWith(() => ({ items: [] }))
    registry.markClosed()

    await expect(createProductIpcInvoker({ registry })('market-intelligence', 'marketAnalysis.listTimeline'))
      .resolves.toEqual(unavailableResult)
  })

  it('answers a structured unavailable result before product services are sealed or after a failed boot', async () => {
    const booting = createProductIpcRegistry()
    await expect(createProductIpcInvoker({ registry: booting })('market-intelligence', 'marketAnalysis.listTimeline'))
      .resolves.toEqual(unavailableResult)

    const failed = createProductIpcRegistry()
    failed.markUnavailable()
    await expect(createProductIpcInvoker({ registry: failed })('market-intelligence', 'marketAnalysis.listTimeline'))
      .resolves.toEqual(unavailableResult)
  })

  it('turns a real closed-database error from a product handler into a structured unavailable result', async () => {
    const database = new DatabaseSync(':memory:')
    database.exec('CREATE TABLE timeline (id TEXT)')
    const registry = sealedRegistryWith(() => database.prepare('SELECT * FROM timeline').all())
    database.close()

    await expect(createProductIpcInvoker({ registry })('market-intelligence', 'marketAnalysis.listTimeline'))
      .resolves.toEqual(unavailableResult)
  })

  it('still rejects product business errors instead of swallowing them', async () => {
    const businessError = Object.assign(new Error('analysis-not-eligible'), { code: 'E_ANALYSIS_NOT_ELIGIBLE' })
    const invoke = createProductIpcInvoker({
      registry: sealedRegistryWith(() => { throw businessError })
    })

    await expect(invoke('market-intelligence', 'marketAnalysis.listTimeline')).rejects.toBe(businessError)
  })

  it('keeps closed-database wording with a product-owned code classified as a business error', () => {
    const productError = Object.assign(new Error('database is not open'), { code: 'E_PRODUCT_STORAGE' })
    expect(isProductDatabaseClosedError(productError)).toBe(false)
    expect(isProductRuntimeUnavailableError(productError)).toBe(false)

    const closedDatabase = new DatabaseSync(':memory:')
    closedDatabase.close()
    const thrown = (() => { try { closedDatabase.prepare('SELECT 1') } catch (error) { return error } })()
    expect(isProductDatabaseClosedError(thrown)).toBe(true)
    expect(isProductRuntimeUnavailableError(thrown)).toBe(true)
  })
})
