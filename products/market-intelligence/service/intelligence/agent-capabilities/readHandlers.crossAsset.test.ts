import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { JobRuntime } from '@platform/jobs'

import { handleGetCrossAssetSnapshot } from './readHandlers'

/** The composition root builds the module once; the handler reads the instance from its deps. */
let injectedModule: unknown
const injectModule = (value: unknown) => { injectedModule = value }


const snapshot = { range: '24h' as const, mode: 'current' as const }

function deps(input: {
  configuration: { state: 'configured' | 'default'; enabled: boolean } | { state: 'unknown' }
  lease: 'none' | 'active' | 'expired' | 'unknown'
  snapshot?: unknown
}) {
  return {
    jobRuntime: {} as JobRuntime,
    // Read lazily: these deps objects are built once, while each case injects its own module.
    get intelligenceModule() { return injectedModule as never },
    getAppLanguage: async () => 'zh-CN' as const,
    macroCalendarOps: {} as never,
    crossAssetOps: {
      readConfiguration: async () => input.configuration,
      readLeaseState: async () => input.lease
    } as never
  }
}

beforeEach(() => {
  injectedModule = undefined
})

function moduleWith(value: unknown) {
  return {
    publicQueryService: {
      queryCrossAssetSnapshot: vi.fn(async () => value)
    }
  }
}

describe('handleGetCrossAssetSnapshot interface state', () => {
  it('reports a disabled interface together with an unavailable reading', async () => {
    injectModule(moduleWith(undefined) as never)

    const result = (await handleGetCrossAssetSnapshot(
      { range: '24h' },
      deps({ configuration: { state: 'default', enabled: false }, lease: 'none' })
    )) as Record<string, unknown>

    expect(result).toMatchObject({
      state: 'unavailable',
      interface: { state: 'default', enabled: false, lease: 'none' }
    })
    expect(JSON.stringify(result)).not.toMatch(/leaseId|https?:/i)
  })

  it('reports an expired lease without hiding the available snapshot', async () => {
    injectModule(moduleWith(snapshot) as never)

    const result = (await handleGetCrossAssetSnapshot(
      { range: '24h' },
      deps({ configuration: { state: 'configured', enabled: true }, lease: 'expired' })
    )) as Record<string, unknown>

    expect(result).toMatchObject({
      state: 'available',
      snapshot,
      interface: { state: 'configured', enabled: true, lease: 'expired' }
    })
    expect(JSON.stringify(result)).not.toMatch(/leaseId|https?:/i)
  })

  it('reports an active lease on the normal path', async () => {
    injectModule(moduleWith(snapshot) as never)

    const result = (await handleGetCrossAssetSnapshot(
      { range: '24h' },
      deps({ configuration: { state: 'configured', enabled: true }, lease: 'active' })
    )) as Record<string, unknown>

    expect(result.interface).toEqual({ state: 'configured', enabled: true, lease: 'active' })
  })

  it('keeps an unreadable state unknown instead of calling it closed', async () => {
    injectModule(moduleWith(undefined) as never)

    const result = (await handleGetCrossAssetSnapshot(
      { range: '24h' },
      deps({ configuration: { state: 'unknown' }, lease: 'unknown' })
    )) as Record<string, unknown>

    expect(result.interface).toEqual({ state: 'unknown', enabled: null, lease: 'unknown' })
  })
})
