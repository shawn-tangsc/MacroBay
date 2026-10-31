import { describe, expect, it } from 'vitest'

import { createProductIpcRegistry } from './productIpcRegistry'

describe('product IPC registry', () => {
  it('returns a typed booting failure before product services are registered', async () => {
    const registry = createProductIpcRegistry()

    await expect(registry.invoke('demo-product', 'settings.get')).rejects.toMatchObject({
      code: 'product-runtime-booting'
    })
  })

  it('returns a typed unavailable failure when product bootstrap fails', async () => {
    const registry = createProductIpcRegistry()
    registry.markUnavailable()

    await expect(registry.invoke('demo-product', 'settings.get')).rejects.toMatchObject({
      code: 'product-runtime-unavailable'
    })
  })

  it('returns a typed closed failure after quit cleanup starts, even once sealed', async () => {
    const registry = createProductIpcRegistry()
    registry.register('demo-product', 'settings.get', () => ({ ok: true }))
    registry.seal([{ productId: 'demo-product', method: 'settings.get' }])
    registry.markClosed()
    // 退出清理可能重复进入：再关一次不得抛错，也绝不回到 active。
    registry.markClosed()

    await expect(registry.invoke('demo-product', 'settings.get')).rejects.toMatchObject({
      code: 'product-runtime-closed'
    })
  })

  it('lets a failed boot be closed afterwards without reopening it', async () => {
    const registry = createProductIpcRegistry()
    registry.markUnavailable()
    registry.markClosed()

    await expect(registry.invoke('demo-product', 'settings.get')).rejects.toMatchObject({
      code: 'product-runtime-closed'
    })
  })

  it('dispatches registered handlers by product id and method', async () => {
    const registry = createProductIpcRegistry()
    registry.register('demo-product', 'settings.get', () => ({ ok: true }))
    registry.seal([{ productId: 'demo-product', method: 'settings.get' }])

    await expect(registry.invoke('demo-product', 'settings.get')).resolves.toEqual({ ok: true })
  })

  it('rejects sealing a registry whose installed methods differ from its independent baseline', () => {
    const registry = createProductIpcRegistry()
    registry.register('demo-product', 'settings.get', () => ({ ok: true }))

    expect(() => registry.seal([{ productId: 'demo-product', method: 'settings.save' }])).toThrow(
      /product-runtime-method-baseline-mismatch/
    )
  })

  it('rejects unknown product methods', async () => {
    const registry = createProductIpcRegistry()
    registry.register('demo-product', 'settings.get', () => ({ ok: true }))
    registry.seal()

    await expect(registry.invoke('missing-product', 'settings.get')).rejects.toThrow(/Unknown product IPC method/)
  })

  it('rejects duplicate and late registrations after sealing', () => {
    const registry = createProductIpcRegistry()
    registry.register('demo-product', 'settings.get', () => ({ ok: true }))

    expect(() => registry.register('demo-product', 'settings.get', () => ({ ok: false }))).toThrow(
      /Duplicate product IPC method/
    )

    registry.seal()

    expect(() => registry.register('demo-product', 'settings.set', () => ({ ok: true }))).toThrow(
      /Product IPC registry is sealed/
    )
  })
})
