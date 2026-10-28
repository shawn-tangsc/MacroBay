import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { JobRuntime } from '@platform/jobs'

vi.mock('../intelligenceModule', () => ({ getIntelligenceModule: vi.fn() }))

import { getIntelligenceModule } from '../intelligenceModule'
import { handleGetCrossAssetSnapshot } from './readHandlers'

const snapshot = { range: '24h' as const, mode: 'current' as const }

function deps(input: {
  configuration: { state: 'configured' | 'default'; enabled: boolean } | { state: 'unknown' }
  lease: 'none' | 'active' | 'expired' | 'unknown'
  snapshot?: unknown
}) {
  return {
    jobRuntime: {} as JobRuntime,
    getAppLanguage: async () => 'zh-CN' as const,
    macroCalendarOps: {} as never,
    crossAssetOps: {
      readConfiguration: async () => input.configuration,
      readLeaseState: async () => input.lease
    } as never
  }
}

beforeEach(() => {
  vi.mocked(getIntelligenceModule).mockReset()
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
    vi.mocked(getIntelligenceModule).mockReturnValue(moduleWith(undefined) as never)

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
    vi.mocked(getIntelligenceModule).mockReturnValue(moduleWith(snapshot) as never)

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
    vi.mocked(getIntelligenceModule).mockReturnValue(moduleWith(snapshot) as never)

    const result = (await handleGetCrossAssetSnapshot(
      { range: '24h' },
      deps({ configuration: { state: 'configured', enabled: true }, lease: 'active' })
    )) as Record<string, unknown>

    expect(result.interface).toEqual({ state: 'configured', enabled: true, lease: 'active' })
  })

  it('keeps an unreadable state unknown instead of calling it closed', async () => {
    vi.mocked(getIntelligenceModule).mockReturnValue(moduleWith(undefined) as never)

    const result = (await handleGetCrossAssetSnapshot(
      { range: '24h' },
      deps({ configuration: { state: 'unknown' }, lease: 'unknown' })
    )) as Record<string, unknown>

    expect(result.interface).toEqual({ state: 'unknown', enabled: null, lease: 'unknown' })
  })
})
