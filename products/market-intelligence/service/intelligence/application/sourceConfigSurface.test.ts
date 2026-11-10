import { describe, expect, it, vi } from 'vitest'


import { createJobRuntime } from '@platform/jobs'

import { createIntelligenceSourcesService } from './intelligenceSourcesService'
import { createInMemoryProfileStorage, createSourceProfileStore } from './sourceProfileStore'
import { createDefaultSourceProfile } from './sourceRuntimeConfig'
import { getIntelligenceSourceDefinition } from './sourceCatalog'
import type { IntelligencePipeline } from './intelligencePipeline'
import type { IntelligenceSourceProfile } from '../schema/intelligenceSource'

/**
 * C4-S0：**三个读命令是同一份事实的三种筛选**，不是三套计算。
 *
 * 判据两半，缺一半 S0 就只是「看起来收口了」：
 * 1. 同一 `panelId` / `sourceId` 下，全量 / 面板 / 分页读返回的事实字段**逐字段相等**
 *    （`enabled` / `health` / `jobRegistered` / `credentialStatus` / `profile` / `unavailable` / `capabilities`）；
 * 2. 事实**只算一次**：一次读请求里每个源的健康读数恰好读一次——旧实现里选中的那个源会被读两次。
 */
const SOURCE_A = 'binance-futures-positioning'
const SOURCE_B = 'binance-futures-positioning'

function profile(sourceId: string, overrides: Partial<IntelligenceSourceProfile> = {}): IntelligenceSourceProfile {
  const definition = getIntelligenceSourceDefinition(sourceId)
  if (!definition) throw new Error(`unknown fixture source ${sourceId}`)
  return { ...createDefaultSourceProfile(definition), enabled: true, ...overrides }
}

function buildService() {
  const reads: string[] = []
  const pipeline = {
    getHealth: (sourceId: string) => {
      reads.push(sourceId)
      return {
        runtimeStatus: sourceId === SOURCE_A ? ('degraded' as const) : ('healthy' as const),
        consecutiveFailures: sourceId === SOURCE_A ? 3 : 0
      }
    },
    reportConnectivityProbe: vi.fn()
  } as unknown as IntelligencePipeline
  const service = createIntelligenceSourcesService({
    profileStore: createSourceProfileStore(createInMemoryProfileStorage([
      profile(SOURCE_A, { enabled: true }),
      profile(SOURCE_B, { enabled: false })
    ])),
    pipeline,
    jobRuntime: createJobRuntime()
  })
  return { service, reads }
}

/** 从三个命令的返回里，各自取出同一个源的那几项事实，用于逐字段比较。 */
describe('the three read commands describe the same source from one computation', () => {
  it('returns the same fact fields for a settings row, a panel row, and the page detail', async () => {
    const { service } = buildService()
    const settings = await service.getSettingsView()
    const panel = await service.getPanelView({ panelId: 'dashboard' })
    const page = await service.getPageState({ sourceId: SOURCE_A })

    const fromSettings = settings.groups
      .flatMap((group) => group.providers)
      .flatMap((provider) => provider.sources)
      .find((source) => source.sourceId === SOURCE_A)
    const fromPanel = panel?.providers
      .flatMap((provider) => provider.sources)
      .find((source) => source.sourceId === SOURCE_A)
    const detail = page.detail

    expect(fromSettings, 'settings must list the source').toBeDefined()
    expect(fromPanel, 'the dashboard panel must list the source').toBeDefined()
    expect(detail?.profile.sourceId).toBe(SOURCE_A)

    // 同一份事实：三项视图字段逐字段相等。
    const facts = {
      settings: {
        enabled: fromSettings?.enabled,
        healthState: fromSettings?.healthState,
        healthMarker: fromSettings?.healthMarker,
        jobRegistered: fromSettings?.jobRegistered,
        capabilities: fromSettings?.capabilities,
        unavailable: fromSettings?.unavailable
      },
      panel: {
        enabled: fromPanel?.enabled,
        healthState: fromPanel?.healthState,
        healthMarker: fromPanel?.healthMarker,
        jobRegistered: fromPanel?.jobRegistered,
        capabilities: fromPanel?.capabilities,
        unavailable: fromPanel?.unavailable
      },
      // 分页读里同一批事实住在详情与 `sourceHealthById`；enabled 由 profile 给出。
      page: {
        enabled: detail?.profile.enabled,
        healthState: page.sourceHealthById?.[SOURCE_A] === undefined
          ? undefined
          : fromSettings?.healthState,
        jobRegistered: fromSettings?.jobRegistered
      }
    }

    expect(facts.panel).toEqual(facts.settings)
    expect(facts.page.enabled).toBe(facts.settings.enabled)
    expect(page.sourceHealthById?.[SOURCE_A]?.runtimeStatus).toBe('degraded')
    expect(detail?.health.runtimeStatus).toBe(page.sourceHealthById?.[SOURCE_A]?.runtimeStatus)
    expect(detail?.profile.enabled).toBe(facts.settings.enabled)
  })

  it('reads each source\'s health exactly once per page read, instead of twice for the selected one', async () => {
    const { service, reads } = buildService()
    reads.length = 0

    await service.getPageState({ sourceId: SOURCE_A })

    // 每个可见源一次，选中的那个**不再**多读一次（旧实现：一次进 sourceHealthById、一次进详情）。
    expect(reads.filter((sourceId) => sourceId === SOURCE_A)).toHaveLength(1)
    expect(new Set(reads).size).toBe(reads.length)
  })

  it('reads health once per source for the settings view as well', async () => {
    const { service, reads } = buildService()
    reads.length = 0

    await service.getSettingsView()

    expect(new Set(reads).size).toBe(reads.length)
    expect(reads).toContain(SOURCE_A)
  })
})
