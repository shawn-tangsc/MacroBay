import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import { createBlsApiCompatibilityHost } from './blsApiCompatibilityHost'

describe('BLS API compatibility host', () => {
  it('retains the first valid injected platform fetch without invoking it during initialization', () => {
    const firstFetch = vi.fn()
    const secondFetch = vi.fn()
    const host = createBlsApiCompatibilityHost()

    host.initialize(Object.freeze({ platformFetch: firstFetch }))
    const firstProbe = host.getProbe()
    host.initialize(Object.freeze({ platformFetch: secondFetch }))

    expect(host.availability()).toBe('available')
    expect(host.getProbe()).toBe(firstProbe)
    expect(firstFetch).not.toHaveBeenCalled()
    expect(secondFetch).not.toHaveBeenCalled()
  })

  it('keeps missing, accessor, and hostile fetch dependencies unavailable without invoking fetch', () => {
    const missing = createBlsApiCompatibilityHost()
    const mutable = createBlsApiCompatibilityHost()
    const accessor = createBlsApiCompatibilityHost()
    const hostile = createBlsApiCompatibilityHost()
    const fetch = vi.fn()
    const accessorContainer = Object.freeze({
      get platformFetch(): never { throw new Error('private getter') }
    })
    const hostileContainer = new Proxy({}, { getOwnPropertyDescriptor: () => { throw new Error('private proxy') } })

    missing.initialize(Object.freeze({}))
    mutable.initialize({ platformFetch: fetch })
    accessor.initialize(accessorContainer as never)
    hostile.initialize(hostileContainer as never)

    expect(missing.availability()).toBe('unavailable')
    expect(mutable.availability()).toBe('unavailable')
    expect(accessor.availability()).toBe('unavailable')
    expect(hostile.availability()).toBe('unavailable')
    expect(missing.getProbe()).toBeUndefined()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps identity and host details out of public product surfaces', () => {
    const source = readFileSync(new URL('./blsApiCompatibilityHost.ts', import.meta.url), 'utf8')

    expect(source).not.toMatch(/ipc|renderer|manifest|job|storage|calendar|process\.env|globalThis|settings|vault/i)
    expect(source).not.toMatch(/getPlatformFetch|applySessionProxySettings|icloud\.com/i)
    expect(source).not.toMatch(/\.probe\(|console\.|logger/i)
  })
})
