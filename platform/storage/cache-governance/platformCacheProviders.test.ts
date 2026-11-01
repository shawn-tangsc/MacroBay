import { describe, expect, it, vi } from 'vitest'

import { CacheRegistry } from './CacheRegistry'
import { registerPlatformCacheProviders } from './platformCacheProviders'

describe('registerPlatformCacheProviders', () => {
  it('registers the runtime compatibility cache and clears only probe cache state', async () => {
    const registry = new CacheRegistry()
    const invalidateAll = vi.fn()
    let reports: Record<string, unknown>[] = [
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
    ]
    const clear = vi.fn(async () => {
      reports = []
    })
    const snapshotStore = {
      listReports: async () => reports,
      clear
    }

    registerPlatformCacheProviders({
      registry,
      agentModelRuntimeProbeService: {
        invalidateAll
      } as never,
      agentRuntimeProbeSnapshotStore: snapshotStore as never
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

    const bytesBefore = Buffer.byteLength(JSON.stringify(await snapshotStore.listReports()), 'utf8')
    const result = await registration?.provider?.clear?.({
      cacheId: 'platform.agent-runtime-compatibility'
    })
    expect(result).toMatchObject({
      status: 'succeeded',
      removedRecords: 1
    })
    // Clear's removal量 = 全部记录体积：清空后没有记录，记录体积按 0 算（不是 JSON `[]` 的两个字节），
    // 所以「前 − 后」= 清空前那份体积。这与 compact 的差量是同一种语义、不同形状：compact 保留一部分
    // 记录，差量是前后两份记录集合之差；clear 的后值恒为空集合。
    expect(await snapshotStore.listReports()).toEqual([])
    expect(result?.removedBytes).toBe(bytesBefore)
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
