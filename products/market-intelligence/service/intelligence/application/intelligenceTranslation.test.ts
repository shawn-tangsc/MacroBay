import { describe, expect, it, vi } from 'vitest'

import { createJobRuntime } from '@platform/jobs'
import type { ProviderState } from '@platform/ai/providers/modelProviderTypes'
import { createDefaultProviderState } from '@platform/ai/providers/providerStore'
import { createStructuredModelInvocationService } from '@platform/ai/invocation/structuredModelInvocation'
import { createDefaultAppSettings, type ModelDefaultsSettings } from '@platform/settings/schema/appSettings'

import { createIntelligencePipeline } from './intelligencePipeline'
import { createIntelligenceTranslationService } from './intelligenceTranslationService'
import {
  computeTranslationSourceHash,
  createDefaultTranslationSettings,
  resolveTargetLocale
} from './intelligenceTranslationHelpers'
import { createInMemoryIntelligenceTranslationStorage } from '../store/intelligenceTranslationStorage'
import { INTELLIGENCE_TRANSLATE_ITEMS_JOB } from '../jobs/intelligenceJobIds'
import type { IntelligenceItem } from '../schema/intelligenceRecord'

const sampleItem = (): IntelligenceItem => ({
  itemId: 'item-1',
  primaryRawRecordId: 'raw-1',
  canonicalDedupeKey: 'dedupe-1',
  sourceId: 'coindesk-rss',
  eventType: 'news-event',
  title: 'Bitcoin rises after ETF inflows',
  summary: 'Market participants watched ETF demand closely.',
  sourceCategory: 'mainstream-news',
  sourceTrust: 'medium',
  detectedAt: '2026-07-06T00:00:00.000Z',
  language: 'en',
  timelineStatus: 'new',
  normalizerVersion: 'v1'
})

function createReadyProviderState(): ProviderState {
  const state = createDefaultProviderState()
  const provider = state.providers[0]
  if (!provider) throw new Error('Missing default provider')
  provider.enabled = true
  provider.apiKey = 'test-key'
  provider.baseUrl = 'https://example.com/v1'
  provider.defaultChatModelId = provider.models.find((model) => model.capabilities.chat)?.id
  return state
}

function createService(input?: {
  providerState?: ProviderState
  appLanguage?: 'zh-CN' | 'en-US'
  fetch?: typeof fetch
  modelDefaults?: ModelDefaultsSettings
}) {
  const storage = createInMemoryIntelligenceTranslationStorage(input?.appLanguage ?? 'zh-CN')
  const pipeline = createIntelligencePipeline()
  const jobRuntime = createJobRuntime()
  const structuredModelInvocation = createStructuredModelInvocationService({
    getProviderState: async () => input?.providerState ?? createReadyProviderState(),
    fetch: input?.fetch
  })
  const service = createIntelligenceTranslationService({
    storage,
    pipeline,
    jobRuntime,
    structuredModelInvocation,
    getAppLanguage: async () => input?.appLanguage ?? 'zh-CN',
    getProviderState: async () => input?.providerState ?? createReadyProviderState(),
    ...(input?.modelDefaults ? { getModelDefaults: async () => input.modelDefaults! } : {})
  })
  jobRuntime.registerHandler(INTELLIGENCE_TRANSLATE_ITEMS_JOB, async (payload) => {
    await service.translateItems(payload as never)
  })
  return { service, pipeline, storage, jobRuntime, structuredModelInvocation }
}

describe('intelligenceTranslationService', () => {
  it('queues translation for non-Chinese items when auto-translation is enabled', async () => {
    const { service, pipeline, jobRuntime } = createService()
    await service.saveSettings({ autoTranslateEnabled: true })
    pipeline.listItems = () => [sampleItem()]
    await service.maybeEnqueueForNewItems(['item-1'])
    expect(jobRuntime.listRecentRuns(1).length).toBeGreaterThan(0)
  })

  it('reuses existing translated row for same source hash and target locale', async () => {
    const { service, pipeline, storage } = createService()
    const item = sampleItem()
    pipeline.listItems = () => [item]
    pipeline.listRevisions = () => []

    const sourceHash = computeTranslationSourceHash({
      title: item.title,
      summary: item.summary
    })
    await storage.writeRecords([
      {
        translationId: 'translation-1',
        sourceType: 'item',
        sourceId: item.itemId,
        sourceHash,
        sourceLanguage: 'en',
        targetLocale: 'zh-CN',
        titleTranslated: '比特币在 ETF 资金流入后上涨',
        summaryTranslated: '市场参与者密切关注 ETF 需求。',
        status: 'translated',
        promptVersion: 'intelligence-translation-v1',
        translatedAt: '2026-07-06T00:01:00.000Z'
      }
    ])

    const display = await service.resolveDisplayText({ itemId: item.itemId, textMode: 'translated' })
    expect(display?.title).toBe('比特币在 ETF 资金流入后上涨')
    expect(display?.status).toBe('translated')
  })

  it('reads translation records once when resolving multiple timeline display rows', async () => {
    const { service, pipeline, storage } = createService()
    const readRecordsSpy = vi.spyOn(storage, 'readRecords')
    pipeline.listItems = () => [
      sampleItem(),
      {
        ...sampleItem(),
        itemId: 'item-2',
        primaryRawRecordId: 'raw-2',
        canonicalDedupeKey: 'dedupe-2',
        title: 'Ethereum reacts to ETF speculation'
      }
    ]
    pipeline.listRevisions = () => []

    const batchedService = service as typeof service & {
      resolveDisplayTexts: (input: {
        itemIds: string[]
        textMode?: 'translated' | 'original'
      }) => Promise<Record<string, unknown>>
    }

    const display = await batchedService.resolveDisplayTexts({
      itemIds: ['item-1', 'item-2'],
      textMode: 'translated'
    })

    expect(Object.keys(display)).toEqual(['item-1', 'item-2'])
    expect(readRecordsSpy).toHaveBeenCalledOnce()
  })

  it('marks old translation stale when source text changes and queues a new row', async () => {
    const { service, pipeline, storage } = createService({
      fetch: vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ title: '新标题', summary: '新摘要' }) } }]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
    })
    const item = sampleItem()
    pipeline.listItems = () => [item]
    pipeline.listRevisions = () => []

    const oldHash = computeTranslationSourceHash({ title: 'Old title', summary: item.summary })
    await storage.writeRecords([
      {
        translationId: 'translation-old',
        sourceType: 'item',
        sourceId: item.itemId,
        sourceHash: oldHash,
        targetLocale: 'zh-CN',
        titleTranslated: '旧标题',
        status: 'translated',
        promptVersion: 'intelligence-translation-v1'
      }
    ])

    await service.translateItems({ itemIds: [item.itemId], reason: 'manual-selection' })
    const records = await storage.readRecords()
    expect(records.some((record) => record.status === 'stale')).toBe(true)
    expect(records.some((record) => record.status === 'translated' || record.status === 'failed')).toBe(true)
  })

  it('strips CDATA from display text while translation is pending', async () => {
    const { service, pipeline } = createService()
    pipeline.listItems = () => [
      {
        ...sampleItem(),
        title: '<![CDATA[Clarity and Congress summer break]]>',
        summary: '<![CDATA[Sample summary]]>'
      }
    ]
    pipeline.listRevisions = () => []

    const display = await service.resolveDisplayText({ itemId: 'item-1', textMode: 'translated' })
    expect(display?.title).toBe('Clarity and Congress summer break')
    expect(display?.summary).toBe('Sample summary')
    expect(display?.status).toBe('pending')
  })

  it('marks Chinese source text as not-required for zh-CN target locale', async () => {
    const { service, pipeline } = createService({ appLanguage: 'zh-CN' })
    pipeline.listItems = () => [{ ...sampleItem(), language: 'zh-CN', title: '比特币上涨', summary: '市场关注 ETF 需求。' }]
    pipeline.listRevisions = () => []

    const display = await service.resolveDisplayText({ itemId: 'item-1' })
    expect(display?.status).toBe('not-required')
    expect(display?.title).toBe('比特币上涨')
  })

  it('keeps failed translation rows retryable', async () => {
    const { service, pipeline, storage } = createService({
      providerState: createReadyProviderState(),
      fetch: vi.fn(async () => new Response('{}', { status: 503 }))
    })
    pipeline.listItems = () => [sampleItem()]
    pipeline.listRevisions = () => []

    const result = await service.translateItems({ itemIds: ['item-1'], reason: 'manual-selection' })
    expect(result.failed).toBeGreaterThan(0)
    const records = await storage.readRecords()
    const failed = records.find((record) => record.status === 'failed')
    expect(failed?.errorCode).toBe('provider-error')

    await service.translateItems({
      itemIds: ['item-1'],
      reason: 'retry-failed',
      translationIds: failed ? [failed.translationId] : []
    })
    const retried = await storage.readRecords()
    expect(retried.some((record) => record.status === 'failed' || record.status === 'translated')).toBe(true)
  })

  it('does not call provider when model service is unavailable', async () => {
    const fetch = vi.fn()
    const { service, pipeline } = createService({
      providerState: createDefaultProviderState(),
      fetch
    })
    pipeline.listItems = () => [sampleItem()]
    pipeline.listRevisions = () => []

    await service.translateItems({ itemIds: ['item-1'], reason: 'manual-selection' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('resolves follow-app target locale from platform language', () => {
    const settings = createDefaultTranslationSettings('zh-CN')
    expect(resolveTargetLocale(settings, 'zh-CN')).toBe('zh-CN')
    expect(resolveTargetLocale({ ...settings, targetLocale: 'en-US' }, 'zh-CN')).toBe('en-US')
  })

  it('uses safe excerpts only in translation job payload', async () => {
    const fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ title: '译文标题', summary: '译文摘要' }) } }]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )
    const { service, pipeline } = createService({ fetch })
    pipeline.listItems = () => [
      {
        ...sampleItem(),
        summary: `${'x'.repeat(2000)} ETF demand`
      }
    ]
    pipeline.listRevisions = () => []

    await service.translateItems({ itemIds: ['item-1'], reason: 'manual-selection' })
    expect(fetch).toHaveBeenCalled()
    const body = JSON.parse(String((fetch.mock.calls[0]?.[1] as RequestInit | undefined)?.body))
    expect(JSON.stringify(body)).not.toContain('x'.repeat(2000))
  })

  it('projects the model-service default translation model into safe settings', async () => {
    const modelDefaults = {
      ...createDefaultAppSettings().modelDefaults,
      translationModelId: 'provider-a:model-b'
    }
    const { service } = createService({ modelDefaults })

    const settings = await service.getSettings()

    expect(settings.defaultModelId).toBe('provider-a:model-b')
    expect(settings.providerId).toBeUndefined()
    expect(settings.modelId).toBeUndefined()
  })

  it('uses the configured default translation model when no explicit model is bound', async () => {
    const providerState = createReadyProviderState()
    const provider = providerState.providers[0]!
    const chatModel = provider.models.find((model) => model.capabilities.chat)!
    const modelDefaults = {
      ...createDefaultAppSettings().modelDefaults,
      translationModelId: `${provider.id}:${chatModel.id}`
    }
    const fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ title: '标题', summary: '摘要' }) } }]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )
    const { service, pipeline, structuredModelInvocation } = createService({
      providerState,
      modelDefaults,
      fetch
    })
    const invoke = vi.spyOn(structuredModelInvocation, 'invoke')
    pipeline.listItems = () => [sampleItem()]
    pipeline.listRevisions = () => []

    await service.translateItems({ itemIds: ['item-1'], reason: 'manual-selection' })

    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: provider.id, modelId: chatModel.id })
    )
  })

  it('keeps an explicit translation model ahead of the model-service default', async () => {
    const providerState = createReadyProviderState()
    const provider = providerState.providers[0]!
    const chatModel = provider.models.find((model) => model.capabilities.chat)!
    const modelDefaults = {
      ...createDefaultAppSettings().modelDefaults,
      translationModelId: `${provider.id}:${chatModel.id}`
    }
    const { service, pipeline, structuredModelInvocation } = createService({ providerState, modelDefaults })
    const invoke = vi.spyOn(structuredModelInvocation, 'invoke')
    await service.saveSettings({ providerId: 'other-provider', modelId: 'other-model' })
    pipeline.listItems = () => [sampleItem()]
    pipeline.listRevisions = () => []

    await service.translateItems({ itemIds: ['item-1'], reason: 'manual-selection' })

    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'other-provider', modelId: 'other-model' })
    )
  })

  it('falls back to the existing provider default when the configured default is unavailable', async () => {
    const modelDefaults = {
      ...createDefaultAppSettings().modelDefaults,
      translationModelId: 'missing:model'
    }
    const fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ title: '标题', summary: '摘要' }) } }]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )
    const { service, pipeline, structuredModelInvocation } = createService({ modelDefaults, fetch })
    const invoke = vi.spyOn(structuredModelInvocation, 'invoke')
    pipeline.listItems = () => [sampleItem()]
    pipeline.listRevisions = () => []

    await service.translateItems({ itemIds: ['item-1'], reason: 'manual-selection' })

    const request = invoke.mock.calls[0]?.[0] as { providerId?: string; modelId?: string } | undefined
    expect(request?.providerId).toBeUndefined()
    expect(request?.modelId).toBeUndefined()
  })

  it('does not persist derived default model fields through the settings patch', async () => {
    const { service, storage } = createService()

    await service.saveSettings({ defaultModelId: 'injected:model' } as never)

    const stored = await storage.readSettings()
    expect('defaultModelId' in stored).toBe(false)
  })
})
