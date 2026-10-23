import { describe, expect, it, vi } from 'vitest'

import { createJobRuntime } from '@platform/jobs'

import { createIntelligenceSourcesService } from './intelligenceSourcesService'
import {
  createInMemoryProfileStorage,
  createSourceProfileStore,
  type SourceProfileStore
} from './sourceProfileStore'
import { createDefaultSourceProfile } from './sourceRuntimeConfig'
import { getIntelligenceSourceDefinition } from './sourceCatalog'
import { createIntelligencePipeline } from './intelligencePipeline'
import { registerIntelligenceJobs } from '../jobs/registerIntelligenceJobs'
import { intelligenceCollectJobId } from './sourceRuntimeOrchestrator'
import type { IntelligencePipeline } from './intelligencePipeline'
import type { IntelligenceSourceProfile } from '../schema/intelligenceSource'

describe('intelligence source startup recovery', () => {
  it('restores saved automatic profiles after the job handlers are registered', async () => {
    const profiles = [
      profile('defillama-stablecoins', { enabled: true, collectionPreset: 'balanced' }),
      profile('alternative-fear-greed', { enabled: true, collectionPreset: 'balanced' }),
      profile('binance-futures-positioning', { enabled: true, collectionPreset: 'frequent' })
    ]
    const jobRuntime = createJobRuntime()
    const capitalRefresh = vi.fn(async () => ({ state: 'updated' as const }))
    const fundingRefresh = vi.fn(async () => ({ state: 'updated' as const }))
    const collectSource = vi.fn(async () => ({ queuedJobs: [] as string[] }))
    const pipeline = fakePipeline({ collectSource })
    registerIntelligenceJobs(jobRuntime, {
      pipeline,
      capitalConditions: { refresh: capitalRefresh },
      fundingRateHistory: { refresh: fundingRefresh }
    })
    const service = createService({ profiles, jobRuntime, pipeline })

    await service.initializeRuntime()

    expect(jobRuntime.listRecentRuns().map((run) => run.definitionId)).toEqual(expect.arrayContaining([
      intelligenceCollectJobId('defillama-stablecoins'),
      intelligenceCollectJobId('alternative-fear-greed'),
      intelligenceCollectJobId('binance-futures-positioning')
    ]))
    expect(jobRuntime.listRuns({ definitionId: intelligenceCollectJobId('alternative-fear-greed') })[0]?.trigger).toEqual({ kind: 'interval', intervalMs: 600_000, anchor: 'lastComplete' })
    expect(jobRuntime.listRuns({ definitionId: intelligenceCollectJobId('binance-futures-positioning') })[0]?.trigger).toEqual({ kind: 'interval', intervalMs: 180_000, anchor: 'lastComplete' })
    expect(capitalRefresh).toHaveBeenCalledOnce()
    expect(fundingRefresh).toHaveBeenCalledOnce()
    expect(collectSource).toHaveBeenCalledOnce()
  })

  it('restores an enabled credentialed 0xRouter profile through the governed ETF current-state refresh path despite a legacy manual preset', async () => {
    const saved = profile('0xrouter-aggregate-provider', { enabled: true, collectionPreset: 'manual', credentialRef: '0xrouter-credentials' })
    const jobRuntime = createJobRuntime()
    const etfRefresh = vi.fn(async () => ({ state: 'updated' as const }))
    const collectSource = vi.fn(async () => ({ queuedJobs: [] as string[] }))
    const pipeline = fakePipeline({ collectSource })
    registerIntelligenceJobs(jobRuntime, { pipeline, etfFlowHistory: { refresh: etfRefresh } })
    const service = createService({ profiles: [saved], jobRuntime, pipeline })

    await service.initializeRuntime()

    expect(jobRuntime.listRuns({ definitionId: intelligenceCollectJobId(saved.sourceId) })).toHaveLength(1)
    expect(jobRuntime.listRuns({ definitionId: intelligenceCollectJobId(saved.sourceId) })[0]?.trigger).toEqual({
      kind: 'interval', intervalMs: 600_000, anchor: 'lastComplete'
    })
    expect(etfRefresh).toHaveBeenCalledOnce()
    expect(collectSource).not.toHaveBeenCalled()
  })

  it('keeps manual, disabled, blocked, credential-incomplete, and unknown saved profiles inactive', async () => {
    const profiles = [
      profile('alternative-fear-greed', { enabled: true, collectionPreset: 'manual' }),
      profile('binance-futures-positioning', { enabled: false, collectionPreset: 'frequent' }),
      profile('bls-economic-series', { enabled: true, collectionPreset: 'balanced' }),
      profile('fred', { enabled: true, collectionPreset: 'balanced', credentialRef: undefined }),
      profile('defillama-stablecoins', { enabled: true, collectionPreset: 'balanced' }),
      { ...profile('defillama-stablecoins', {}), sourceId: 'removed-source', profileId: 'removed-source-profile' }
    ] as IntelligenceSourceProfile[]
    const jobRuntime = createJobRuntime()
    const capitalRefresh = vi.fn(async () => ({ state: 'unchanged' as const }))
    const collectSource = vi.fn(async () => ({ queuedJobs: [] as string[] }))
    const pipeline = fakePipeline({ collectSource })
    registerIntelligenceJobs(jobRuntime, { pipeline, capitalConditions: { refresh: capitalRefresh } })
    const service = createService({ profiles, jobRuntime, pipeline })

    await service.initializeRuntime()

    expect(jobRuntime.listRecentRuns().map((run) => run.definitionId)).toEqual([
      intelligenceCollectJobId('defillama-stablecoins')
    ])
    for (const sourceId of ['alternative-fear-greed', 'binance-futures-positioning', 'bls-economic-series', 'fred', 'removed-source']) {
      await expect(jobRuntime.enqueueManual(intelligenceCollectJobId(sourceId))).rejects.toThrow('Unknown job definition')
    }
    expect(capitalRefresh).toHaveBeenCalledOnce()
    expect(collectSource).not.toHaveBeenCalled()
  })

  it('deduplicates saved source ids and applies concurrent or repeated initialization once', async () => {
    const saved = profile('alternative-fear-greed', { enabled: true, collectionPreset: 'balanced' })
    const jobRuntime = createJobRuntime()
    const collectSource = vi.fn(async () => ({ queuedJobs: [] as string[] }))
    const pipeline = fakePipeline({ collectSource })
    registerIntelligenceJobs(jobRuntime, { pipeline })
    const service = createService({ profiles: [saved, { ...saved }], jobRuntime, pipeline })

    await Promise.all([service.initializeRuntime(), service.initializeRuntime()])
    await service.initializeRuntime()

    expect(jobRuntime.listRuns({ definitionId: intelligenceCollectJobId(saved.sourceId) })).toHaveLength(1)
    expect(collectSource).toHaveBeenCalledOnce()
  })

  it('safely retries after a profile-list failure without exposing the failure', async () => {
    const saved = profile('alternative-fear-greed', { enabled: true, collectionPreset: 'balanced' })
    const profileStore = stubProfileStore(saved)
    profileStore.listProfiles = vi.fn()
      .mockRejectedValueOnce(new Error('credential and endpoint detail'))
      .mockResolvedValue([saved])
    const jobRuntime = createJobRuntime()
    const collectSource = vi.fn(async () => ({ queuedJobs: [] as string[] }))
    const pipeline = fakePipeline({ collectSource })
    registerIntelligenceJobs(jobRuntime, { pipeline })
    const service = createService({ profiles: [], profileStore, jobRuntime, pipeline })

    await expect(service.initializeRuntime()).resolves.toBeUndefined()
    expect(jobRuntime.listRecentRuns()).toEqual([])

    await expect(service.initializeRuntime()).resolves.toBeUndefined()
    expect(jobRuntime.listRuns({ definitionId: intelligenceCollectJobId(saved.sourceId) })).toHaveLength(1)
    expect(collectSource).toHaveBeenCalledOnce()
  })

  it('fresh-resolves a profile before reconcile and honors a disable completed during recovery', async () => {
    const listed = profile('alternative-fear-greed', { enabled: true, collectionPreset: 'balanced' })
    let current = listed
    let releaseResolve!: () => void
    const resolveGate = new Promise<void>((resolve) => { releaseResolve = resolve })
    const profileStore = stubProfileStore(listed)
    profileStore.resolveProfile = vi.fn(async () => {
      await resolveGate
      return current
    })
    const jobRuntime = createJobRuntime()
    const collectSource = vi.fn(async () => ({ queuedJobs: [] as string[] }))
    const pipeline = fakePipeline({ collectSource })
    registerIntelligenceJobs(jobRuntime, { pipeline })
    const service = createService({ profiles: [], profileStore, jobRuntime, pipeline })

    const recovery = service.initializeRuntime()
    current = { ...listed, enabled: false, updatedAt: '2026-08-19T00:01:00.000Z' }
    releaseResolve()
    await recovery

    expect(jobRuntime.listRecentRuns()).toEqual([])
    await expect(jobRuntime.enqueueManual(intelligenceCollectJobId(listed.sourceId))).rejects.toThrow('Unknown job definition')
    expect(collectSource).not.toHaveBeenCalled()
  })

  it('removes an existing schedule when the saved runtime becomes ineligible', async () => {
    const saved = profile('alternative-fear-greed', { enabled: true, collectionPreset: 'balanced' })
    const jobRuntime = createJobRuntime()
    const collectSource = vi.fn(async () => ({ queuedJobs: [] as string[] }))
    const pipeline = fakePipeline({ collectSource })
    registerIntelligenceJobs(jobRuntime, { pipeline })
    const service = createService({ profiles: [saved], jobRuntime, pipeline })
    await service.initializeRuntime()

    await service.saveProfile({ sourceId: saved.sourceId, enabled: false })

    await expect(jobRuntime.enqueueManual(intelligenceCollectJobId(saved.sourceId))).rejects.toThrow('Unknown job definition')
    expect(jobRuntime.listRuns({ definitionId: intelligenceCollectJobId(saved.sourceId) })).toHaveLength(1)
  })

  it('keeps failed credential validation from writing a reference or scheduling a blocked source', async () => {
    const saved = profile('bea-economic-series', { enabled: true, collectionPreset: 'balanced' })
    const jobRuntime = createJobRuntime()
    const collectSource = vi.fn(async () => ({ queuedJobs: [] as string[] }))
    const pipeline = fakePipeline({ collectSource })
    registerIntelligenceJobs(jobRuntime, { pipeline })
    const profileStore = createSourceProfileStore(createInMemoryProfileStorage([saved]))
    const validateCredential = vi.fn()
      .mockResolvedValueOnce({ ok: false, message: 'unavailable' })
      .mockResolvedValueOnce({ ok: true, message: 'verified' })
    const service = createIntelligenceSourcesService({
      profileStore,
      pipeline,
      jobRuntime,
      validateCredential
    })

    await service.initializeRuntime()
    expect(jobRuntime.listRecentRuns()).toEqual([])
    const result = await service.testCredentials({ sourceId: saved.sourceId, credentialDraft: 'test-key' })
    expect(result.ok).toBe(false)
    expect(jobRuntime.listRecentRuns()).toEqual([])
    expect((await profileStore.resolveProfile(saved.sourceId)).credentialRef).toBeUndefined()
    expect(collectSource).not.toHaveBeenCalled()
  })

  it('shares one application when startup and save observe the same profile revision', async () => {
    const saved = profile('alternative-fear-greed', { enabled: true, collectionPreset: 'balanced' })
    const profileStore = stubProfileStore(saved)
    profileStore.saveProfile = vi.fn(async () => saved)
    const jobRuntime = createJobRuntime()
    const collectSource = vi.fn(async () => ({ queuedJobs: [] as string[] }))
    const pipeline = fakePipeline({ collectSource })
    registerIntelligenceJobs(jobRuntime, { pipeline })
    const service = createIntelligenceSourcesService({ profileStore, pipeline, jobRuntime })

    await Promise.all([
      service.initializeRuntime(),
      service.saveProfile({ sourceId: saved.sourceId, enabled: true })
    ])

    expect(jobRuntime.listRuns({ definitionId: intelligenceCollectJobId(saved.sourceId) })).toHaveLength(1)
    expect(collectSource).toHaveBeenCalledOnce()
  })
})

function profile(sourceId: string, overrides: Partial<IntelligenceSourceProfile>): IntelligenceSourceProfile {
  const definition = getIntelligenceSourceDefinition(sourceId)!
  return { ...createDefaultSourceProfile(definition, '2026-08-19T00:00:00.000Z'), ...overrides }
}

function createService(input: {
  profiles: IntelligenceSourceProfile[]
  profileStore?: SourceProfileStore
  jobRuntime: ReturnType<typeof createJobRuntime>
  pipeline: IntelligencePipeline
}) {
  const profileStore = input.profileStore ?? createSourceProfileStore(createInMemoryProfileStorage(input.profiles))
  return createIntelligenceSourcesService({
    profileStore,
    pipeline: input.pipeline,
    jobRuntime: input.jobRuntime,
    validateCredential: async () => ({ ok: true, message: 'verified' })
  })
}

function stubProfileStore(saved: IntelligenceSourceProfile): SourceProfileStore {
  return {
    listProfiles: async () => [saved],
    getProfile: async () => saved,
    resolveProfile: async () => saved,
    saveProfile: async (input) => ({ ...saved, ...input, updatedAt: '2026-08-19T00:01:00.000Z' })
  }
}

function fakePipeline(overrides: Partial<IntelligencePipeline> = {}): IntelligencePipeline {
  return {
    ...createIntelligencePipeline(),
    ...overrides
  }
}
