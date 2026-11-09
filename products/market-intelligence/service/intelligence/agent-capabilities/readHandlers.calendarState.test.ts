import { describe, expect, it } from 'vitest'

import type { JobRuntime } from '@platform/jobs'
import { macroCalendarProviderSettingsPolicy } from '../../../contracts/macro/economicCalendarQueryContracts'
import type { IntelligenceModule } from '../intelligenceModule'
import type { CrossAssetOps, MacroCalendarOps } from './operationFacades'
import { handleGetCalendarState, type ReadHandlerDeps } from './readHandlers'

const [fed, bea] = macroCalendarProviderSettingsPolicy.providerIds

/**
 * 依赖按**真实签名**声明：返回类型就是 `ReadHandlerDeps`，契约以后再加必填项，这里会当场红。
 *
 * `handleGetCalendarState` 只走 `macroCalendarOps.readConfiguration`；`intelligenceModule`、
 * `jobRuntime`、`crossAssetOps` 是契约上必填但这条路径不碰，所以各自给一个显式占位。
 */
function deps(readConfiguration: () => Promise<unknown>): ReadHandlerDeps {
  return {
    jobRuntime: {} as JobRuntime,
    intelligenceModule: {} as IntelligenceModule,
    getAppLanguage: async () => 'zh-CN' as const,
    macroCalendarOps: { readConfiguration } as unknown as MacroCalendarOps,
    crossAssetOps: {} as CrossAssetOps
  }
}

describe('handleGetCalendarState', () => {
  it('reports every provider as enabled, disabled, or never configured', async () => {
    const result = (await handleGetCalendarState(
      {},
      deps(async () => ({
        providers: { [fed]: true, [bea]: false },
        releaseTimes: {}
      }))
    )) as {
      state: string
      providers: Array<{ providerId: string; enabled: boolean | null; configured: boolean }>
      releaseTimes: unknown[]
    }

    expect(result.state).toBe('available')
    expect(result.providers).toEqual([
      { providerId: bea, enabled: false, configured: true },
      { providerId: fed, enabled: true, configured: true }
    ])
    expect(result.releaseTimes).toEqual([])
  })

  it('does not call an absent profile disabled', async () => {
    const result = (await handleGetCalendarState(
      {},
      deps(async () => ({ providers: { [fed]: true }, releaseTimes: {} }))
    )) as {
      providers: Array<{ providerId: string; enabled: boolean | null; configured: boolean }>
    }

    expect(result.providers.find((provider) => provider.providerId === bea)).toEqual({
      providerId: bea,
      enabled: null,
      configured: false
    })
  })

  it('returns only the reader-edited release times, without inventing defaults', async () => {
    const result = (await handleGetCalendarState(
      {},
      deps(async () => ({
        providers: { [fed]: true, [bea]: true },
        releaseTimes: {
          'US.CPI.RELEASE.2026-M09': {
            scheduledAt: '2026-09-10T12:30:00.000Z',
            scheduledDate: '2026-09-10'
          }
        }
      }))
    )) as {
      releaseTimes: Array<{ eventKey: string; scheduledAt: string; scheduledDate: string }>
    }

    expect(result.releaseTimes).toEqual([
      {
        eventKey: 'US.CPI.RELEASE.2026-M09',
        scheduledAt: '2026-09-10T12:30:00.000Z',
        scheduledDate: '2026-09-10'
      }
    ])
    expect(JSON.stringify(result)).not.toMatch(/credential|apiKey|https?:/i)
  })

  it('reports unavailable instead of an empty configured map when the store cannot be read', async () => {
    const result = (await handleGetCalendarState(
      {},
      deps(async () => {
        throw new Error('store unavailable')
      })
    )) as { state: string; caveats: string[] }

    expect(result).toEqual({
      state: 'unavailable',
      providers: [],
      releaseTimes: [],
      caveats: ['calendar-state-unavailable']
    })
  })
})
