import { describe, expect, it, vi } from 'vitest'

import { createJobRuntime } from '@platform/jobs'

import { createIntelligenceSourcesService } from './intelligenceSourcesService'
import { createInMemoryProfileStorage, createSourceProfileStore } from './sourceProfileStore'
import { createDefaultSourceProfile } from './sourceRuntimeConfig'
import { getIntelligenceSourceDefinition } from './sourceCatalog'
import type { IntelligencePipeline } from './intelligencePipeline'
import type { SourceStaleReason } from './sourceStaleness'
import type { IntelligenceSourceProfile } from '../schema/intelligenceSource'

/**
 * 采集**产出**状态从管线一路走到设置页读的那个视图（2026-11-21 事故的可见面）。
 *
 * 单测投影层只能证明「给了就会带出去」；这里证明**真的给了**——`readHealth` 带回来的
 * `staleReasons` 不能在半路被摘掉。这条是本轮最容易被静默改坏的一环：`readConfigSurface`
 * 把健康读数收窄成 `{ runtimeStatus, consecutiveFailures }` 时，产出状态就掉在那里了，
 * 界面上一句话都不会多，也没有任何报错。
 */
const silentSourceId = 'coindesk-rss'
const quietSourceId = 'binance-futures-positioning'

function profile(sourceId: string): IntelligenceSourceProfile {
  const definition = getIntelligenceSourceDefinition(sourceId)
  if (!definition) throw new Error(`unknown fixture source ${sourceId}`)
  return { ...createDefaultSourceProfile(definition), enabled: true }
}

function buildService(stale: Readonly<{
  reasons?: readonly SourceStaleReason[]
  measurements?: Readonly<{ noOutputHours?: number; normalizeFailureStreak?: number }>
}>) {
  const pipeline = {
    getHealth: (sourceId: string) => ({
      runtimeStatus: 'healthy' as const,
      consecutiveFailures: 0,
      ...(sourceId === silentSourceId && stale.reasons !== undefined ? { staleReasons: stale.reasons } : {}),
      ...(sourceId === silentSourceId && stale.measurements !== undefined ? { staleMeasurements: stale.measurements } : {})
    }),
    reportConnectivityProbe: vi.fn()
  } as unknown as IntelligencePipeline
  return createIntelligenceSourcesService({
    profileStore: createSourceProfileStore(createInMemoryProfileStorage([
      profile(silentSourceId),
      profile(quietSourceId)
    ])),
    pipeline,
    jobRuntime: createJobRuntime()
  })
}

function rowOf(view: Awaited<ReturnType<ReturnType<typeof buildService>['getSettingsView']>>, sourceId: string) {
  return view.groups
    .flatMap((group) => group.providers)
    .flatMap((provider) => provider.sources)
    .find((source) => source.sourceId === sourceId)!
}

describe('采集产出状态真的从管线走到设置页视图', () => {
  it('管线说「没产出」：设置页那一行带着原因与小时数', async () => {
    const service = buildService({ reasons: ['no-output'], measurements: { noOutputHours: 30 } })
    const row = rowOf(await service.getSettingsView(), silentSourceId)
    expect(row.staleReasons).toEqual(['no-output'])
    expect(row.staleMeasurements).toEqual({ noOutputHours: 30 })
    // 采集仍然是绿的：这两件事在视图里并列，不互相改写。
    expect(row.healthState).toBe('healthy')
  })

  it('两种病同时为真：两条都带到视图，不在这里挑一个', async () => {
    const service = buildService({
      reasons: ['no-output', 'normalize-failing'],
      measurements: { noOutputHours: 30, normalizeFailureStreak: 3 }
    })
    const row = rowOf(await service.getSettingsView(), silentSourceId)
    expect(row.staleReasons).toEqual(['no-output', 'normalize-failing'])
    expect(row.staleMeasurements).toEqual({ noOutputHours: 30, normalizeFailureStreak: 3 })
  })

  it('另一个源不受影响：产出状态是按源给的，不是整屏一个值', async () => {
    const service = buildService({ reasons: ['no-output'], measurements: { noOutputHours: 30 } })
    const view = await service.getSettingsView()
    expect('staleReasons' in rowOf(view, quietSourceId)).toBe(false)
  })

  it('管线没给原因：视图里就没有这两个键（不编一个空数组冒充「测过了」）', async () => {
    const service = buildService({})
    const row = rowOf(await service.getSettingsView(), silentSourceId)
    expect('staleReasons' in row).toBe(false)
    expect('staleMeasurements' in row).toBe(false)
  })

  it('面板视图读的是同一份：同一行在面板里也带着产出状态', async () => {
    const service = buildService({ reasons: ['normalize-failing'], measurements: { normalizeFailureStreak: 4 } })
    const panel = await service.getPanelView({ panelId: 'dashboard' })
    const row = panel?.providers.flatMap((provider) => provider.sources).find((source) => source.sourceId === silentSourceId)
    expect(row?.staleReasons).toEqual(['normalize-failing'])
  })
})