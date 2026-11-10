import { describe, expect, it } from 'vitest'

import { createJobRuntime, type JobRuntime } from '@platform/jobs'

import { createIntelligenceSourcesService } from './intelligenceSourcesService'
import { createInMemoryProfileStorage, createSourceProfileStore } from './sourceProfileStore'
import { createIntelligencePipeline } from './intelligencePipeline'
import { registerIntelligenceJobs } from '../jobs/registerIntelligenceJobs'
import {
  createInMemoryIntelligenceCredentialStorage,
  createIntelligenceCredentialStore
} from '../store/intelligenceCredentialStore'
import { intelligenceCollectJobId } from './sourceRuntimeOrchestrator'
import { createDefaultSourceProfile } from './sourceRuntimeConfig'
import { getIntelligenceSourceDefinition } from './sourceCatalog'
import type { IntelligenceSourceProfile } from '../schema/intelligenceSource'
import {
  sourceOwnedJobDefinitions,
  sourceOwnedJobSourceId
} from './sourceOwnedJobSchedules'
import { MACRO_MARKET_COLLECT_JOB_ID } from '../macro-market/macroMarketJob'
import { REAL_MARKET_API_DXY_COLLECT_JOB_ID } from '../macro-market/realMarketApiDxyJob'
import { CROSS_ASSET_INDEX_COLLECT_JOB_ID } from '../cross-asset/crossAssetIndexJob'

const TWELVE_DATA_KEY = '0123456789abcdef0123456789abcdef'
const REAL_MARKET_API_KEY = 'ab12'.repeat(16)

/**
 * 用户 2026-11-11：**没启用的源不允许被注册到 job 里**——不排期、不发请求；启停一变，
 * job 注册跟着变。这组用例把这条规则钉在服务自己身上：排期只由 `applyRuntimeEligibility`
 * 这一处决定（通用采集作业 + 产品自有作业同一个闸），关掉就 `listSchedules()` 里没有它。
 */
describe('a source that is switched off owns no job', () => {
  it('drops the collect job when the reader switches a polling source off, and restores it when switched back on', async () => {
    const jobRuntime = createJobRuntime()
    const service = createService(jobRuntime)
    const jobId = intelligenceCollectJobId('federal-reserve-rss')

    await service.setEnabled({ sourceId: 'federal-reserve-rss', enabled: true })
    expect(scheduledIds(jobRuntime)).toContain(jobId)

    await service.setEnabled({ sourceId: 'federal-reserve-rss', enabled: false })
    expect(scheduledIds(jobRuntime)).not.toContain(jobId)

    await service.setEnabled({ sourceId: 'federal-reserve-rss', enabled: true })
    expect(scheduledIds(jobRuntime)).toContain(jobId)
  })

  it('takes the product-owned macro-market job with the source when it is switched off', async () => {
    const jobRuntime = createJobRuntime()
    const service = createService(jobRuntime)
    await service.testCredentials({ sourceId: 'twelve-data-market', credentialDraft: TWELVE_DATA_KEY })

    await service.setEnabled({ sourceId: 'twelve-data-market', enabled: true })
    expect(scheduledIds(jobRuntime)).toContain(MACRO_MARKET_COLLECT_JOB_ID)

    await service.setEnabled({ sourceId: 'twelve-data-market', enabled: false })
    expect(scheduledIds(jobRuntime)).not.toContain(MACRO_MARKET_COLLECT_JOB_ID)
  })

  it('takes both real-index jobs with the source when it is switched off', async () => {
    const jobRuntime = createJobRuntime()
    const service = createService(jobRuntime)
    await service.testCredentials({ sourceId: 'realmarketapi-market', credentialDraft: REAL_MARKET_API_KEY })

    await service.setEnabled({ sourceId: 'realmarketapi-market', enabled: true })
    expect(scheduledIds(jobRuntime)).toEqual(expect.arrayContaining([
      REAL_MARKET_API_DXY_COLLECT_JOB_ID,
      CROSS_ASSET_INDEX_COLLECT_JOB_ID
    ]))

    await service.setEnabled({ sourceId: 'realmarketapi-market', enabled: false })
    expect(scheduledIds(jobRuntime)).not.toContain(REAL_MARKET_API_DXY_COLLECT_JOB_ID)
    expect(scheduledIds(jobRuntime)).not.toContain(CROSS_ASSET_INDEX_COLLECT_JOB_ID)
  })

  it('leaves a key-requiring source that was never enabled with no job at all', async () => {
    const jobRuntime = createJobRuntime()
    createService(jobRuntime)

    expect(scheduledIds(jobRuntime)).not.toContain(MACRO_MARKET_COLLECT_JOB_ID)
    expect(scheduledIds(jobRuntime)).not.toContain(REAL_MARKET_API_DXY_COLLECT_JOB_ID)
    expect(scheduledIds(jobRuntime)).not.toContain(CROSS_ASSET_INDEX_COLLECT_JOB_ID)
  })

  it('does not arm a schedule from a manual run of a source that is off', async () => {
    const jobRuntime = createJobRuntime()
    const service = createService(jobRuntime)
    await service.setEnabled({ sourceId: 'federal-reserve-rss', enabled: false })
    const before = scheduledIds(jobRuntime)

    // 手动运行仍要能跑一次：它只排一条一次性作业，不动排期表。
    await service.runNow({ sourceId: 'federal-reserve-rss' })

    expect(scheduledIds(jobRuntime)).toEqual(before)
    expect(jobRuntime.listRecentRuns().map((run) => run.definitionId)).toContain(intelligenceCollectJobId('federal-reserve-rss'))
  })

  it('registers nothing for the sources a saved profile keeps off, even before the reader touches a switch', async () => {
    const jobRuntime = createJobRuntime()
    const service = createService(jobRuntime, [
      profile('twelve-data-market', { enabled: false, credentialRef: 'twelve-data-market-credentials' }),
      profile('realmarketapi-market', { enabled: true, credentialRef: 'realmarketapi-market-credentials' }),
      profile('federal-reserve-rss', { enabled: false }),
      profile('binance-futures-positioning', { enabled: true })
    ])

    // 启动恢复是「装配之后第一次按开关排期」的那条路：以前 DXY / 宏观市场的时钟在这里无条件注册。
    await service.initializeRuntime()

    expect(scheduledIds(jobRuntime)).not.toContain(MACRO_MARKET_COLLECT_JOB_ID)
    expect(scheduledIds(jobRuntime)).not.toContain(intelligenceCollectJobId('federal-reserve-rss'))
    expect(scheduledIds(jobRuntime)).toEqual(expect.arrayContaining([
      REAL_MARKET_API_DXY_COLLECT_JOB_ID,
      CROSS_ASSET_INDEX_COLLECT_JOB_ID,
      intelligenceCollectJobId('binance-futures-positioning')
    ]))
    await expectEveryScheduledSourceJobEnabled(service, jobRuntime)
  })

  it('keeps no automatically scheduled source job for a source the reader has switched off', async () => {
    const jobRuntime = createJobRuntime()
    const service = createService(jobRuntime)
    await service.setEnabled({ sourceId: 'federal-reserve-rss', enabled: true })
    await service.setEnabled({ sourceId: 'binance-futures-positioning', enabled: true })
    await service.setEnabled({ sourceId: 'binance-futures-positioning', enabled: false })

    // 守卫（会红）：排期表里每一条「源作业」都必须属于一个读者开着、且真的能采的源。
    await expectEveryScheduledSourceJobEnabled(service, jobRuntime)
  })
})

/**
 * 守卫：把 `listSchedules()` 翻译回源，每一条源作业的源都必须是「读者开着」且「通用运行时能采
 * （产品自有作业按自己的启用法判）」。去掉任一条按 enabled 的过滤，这里就会红。
 */
async function expectEveryScheduledSourceJobEnabled(
  service: ReturnType<typeof createIntelligenceSourcesService>,
  jobRuntime: JobRuntime
): Promise<void> {
  const productOwnedIds = new Set(Object.values(sourceOwnedJobDefinitions).flatMap((owned) => owned.map((job) => job.id)))
  for (const definitionId of scheduledIds(jobRuntime)) {
    const sourceId = productOwnedIds.has(definitionId)
      ? sourceOwnedJobSourceId(definitionId)
      : collectJobSourceId(definitionId)
    if (sourceId === undefined) continue
    const detail = await service.getDetail(sourceId)
    expect({ definitionId, enabled: detail.profile.enabled }).toEqual({ definitionId, enabled: true })
    expect(detail.runtimeConfig.enabled || productOwnedIds.has(definitionId)).toBe(true)
  }
}

function profile(sourceId: string, overrides: Partial<IntelligenceSourceProfile>): IntelligenceSourceProfile {
  const definition = getIntelligenceSourceDefinition(sourceId)!
  return { ...createDefaultSourceProfile(definition, '2026-11-11T00:00:00.000Z'), ...overrides }
}

function createService(jobRuntime: JobRuntime, profiles: IntelligenceSourceProfile[] = []) {
  const profileStore = createSourceProfileStore(createInMemoryProfileStorage(profiles))
  const pipeline = createIntelligencePipeline({ profileStore })
  // 手动运行走的是真实的 collect handler：没有登记 handler 时 enqueue 会拒绝，用例就测不到排期表。
  registerIntelligenceJobs(jobRuntime, { pipeline })
  return createIntelligenceSourcesService({
    profileStore,
    pipeline,
    jobRuntime,
    credentialStore: createIntelligenceCredentialStore(createInMemoryIntelligenceCredentialStorage()),
    validateCredential: async () => ({ ok: true, message: 'Credential verified with provider.' })
  })
}

function scheduledIds(jobRuntime: JobRuntime): string[] {
  return jobRuntime.listSchedules().map((definition) => definition.id)
}

function collectJobSourceId(definitionId: string): string | undefined {
  const prefix = intelligenceCollectJobId('')
  return definitionId.startsWith(prefix) ? definitionId.slice(prefix.length) : undefined
}
