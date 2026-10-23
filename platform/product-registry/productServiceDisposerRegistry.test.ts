import { describe, expect, it, vi } from 'vitest'

import { createProductServiceDisposerRegistry } from './productServiceDisposerRegistry'

describe('product service disposer registry', () => {
  it('runs each registered disposer once and rejects late registrations', async () => {
    const registry = createProductServiceDisposerRegistry()
    const first = vi.fn(async () => undefined)
    const second = vi.fn()

    registry.register(first)
    registry.register(second)
    await registry.disposeAll()
    await registry.disposeAll()

    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
    expect(() => registry.register(vi.fn())).toThrow(/disposed/i)
  })
})
