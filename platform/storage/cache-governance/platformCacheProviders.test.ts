import { describe, expect, it, vi } from 'vitest'

import { CacheRegistry } from './CacheRegistry'
import { registerPlatformCacheProviders } from './platformCacheProviders'

describe('registerPlatformCacheProviders', () => {
  it('registers the runtime compatibility cache and clears only probe cache state', async () => {
    const registry = new CacheRegistry()
    const invalidateAll = vi.fn()
    const clear = vi.fn(async () => undefined)

    registerPlatformCacheProviders({
      registry,
      agentModelRuntimeProbeService: {
        invalidateAll
      } as never,
      agentRuntimeProbeSnapshotStore: {
        listReports: async () => [
          {
            providerId: 'anthropic',
            modelId: 'claude-sonnet',
            runtimeId: 'claude-code',
            ordinaryChat: { lane: 'ordinary-chat', status: 'ready', summary: 'ok' },
            finalCompatibility: {
              providerId: 'anthropic',
              modelId: 'claude-sonnet',
              runtimeId: 'claude-code',
              selectable: true,
              route: 'direct',
              status: 'ready',
              summary: 'ok'
            },
            updatedAt: '2026-07-12T10:00:00.000Z',
            signature: 'sig'
          }
        ],
        clear
      } as never
    })

    const registration = registry.getWithProvider('platform.agent-runtime-compatibility')
    expect(registration?.clearable).toBe(true)

    const inspection = await registration?.provider?.inspect?.()
    expect(inspection).toMatchObject({
      cacheId: 'platform.agent-runtime-compatibility',
      status: 'ready',
      recordCount: 1,
      rebuildable: true
    })

    const result = await registration?.provider?.clear?.({
      cacheId: 'platform.agent-runtime-compatibility'
    })
    expect(result).toMatchObject({
      status: 'succeeded',
      removedRecords: 1
    })
    expect(invalidateAll).toHaveBeenCalledOnce()
    expect(clear).toHaveBeenCalledOnce()
  })

  it('supports dry-run without mutating probe state', async () => {
    const registry = new CacheRegistry()
    const invalidateAll = vi.fn()
    const clear = vi.fn(async () => undefined)

    registerPlatformCacheProviders({
      registry,
      agentModelRuntimeProbeService: {
        invalidateAll
      } as never,
      agentRuntimeProbeSnapshotStore: {
        listReports: async () => [],
        clear
      } as never
    })

    const registration = registry.getWithProvider('platform.agent-runtime-compatibility')
    const result = await registration?.provider?.clear?.({
      cacheId: 'platform.agent-runtime-compatibility',
      dryRun: true
    })

    expect(result).toMatchObject({
      dryRun: true,
      status: 'succeeded',
      removedRecords: 0
    })
    expect(invalidateAll).not.toHaveBeenCalled()
    expect(clear).not.toHaveBeenCalled()
  })
})
