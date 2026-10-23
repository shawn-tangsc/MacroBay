import { describe, expect, it } from 'vitest'

import { CacheRegistry } from './CacheRegistry'
import type { CacheRegistrationWithProvider } from './cacheContracts'

describe('CacheRegistry', () => {
  it('rejects duplicate cache ids', () => {
    const registry = new CacheRegistry()
    registry.register(createRegistration())

    expect(() => registry.register(createRegistration())).toThrow(/already registered/)
  })

  it('rejects invalid owner combinations', () => {
    const registry = new CacheRegistry()

    expect(() =>
      registry.register(
        createRegistration({
          cacheId: 'platform.bad-cache',
          ownerType: 'platform',
          ownerId: 'sample-product'
        })
      )
    ).toThrow(/ownerId "platform"/)

    expect(() =>
      registry.register(
        createRegistration({
          cacheId: 'platform.bad-cache',
          ownerType: 'product',
          ownerId: ''
        })
      )
    ).toThrow(/product ownerId/)
  })

  it('requires a clear handler for clearable caches', () => {
    const registry = new CacheRegistry()

    expect(() =>
      registry.register(
        createRegistration({
          clearable: true,
          provider: {}
        })
      )
    ).toThrow(/clear handler/)
  })

  it('requires a compact handler for compactable caches', () => {
    const registry = new CacheRegistry()

    expect(() =>
      registry.register(
        createRegistration({
          compactable: true,
          provider: {}
        })
      )
    ).toThrow(/compact handler/)
  })

  it('rejects clearable user-data-like caches by default', () => {
    const registry = new CacheRegistry()

    expect(() =>
      registry.register(
        createRegistration({
          durability: 'user-data-like',
          clearable: true,
          provider: {
            clear: async ({ cacheId, dryRun }) => ({
              cacheId,
              operation: 'clear',
              dryRun: dryRun === true,
              status: 'succeeded'
            })
          }
        })
      )
    ).toThrow(/user-data-like/)
  })
})

function createRegistration(
  overrides: Partial<CacheRegistrationWithProvider> = {}
): CacheRegistrationWithProvider {
  return {
    cacheId: 'platform.agent-runtime-compatibility',
    ownerType: 'platform',
    ownerId: 'platform',
    displayName: 'Agent runtime compatibility',
    description: 'Probe cache.',
    category: 'ai-runtime',
    cacheKind: 'json-file',
    durability: 'rebuildable',
    sensitivity: 'none',
    clearable: false,
    compactable: false,
    backupPolicy: 'exclude',
    warnings: [],
    ...overrides
  }
}
