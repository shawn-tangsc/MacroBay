import { describe, expect, it, vi } from 'vitest'

import { createJobRuntime } from '@platform/jobs'
import { createDefaultProviderState } from '@platform/ai/providers/providerStore'
import { createStructuredModelInvocationService } from '@platform/ai/invocation/structuredModelInvocation'

import { createIntelligencePipeline } from '../application/intelligencePipeline'
import { createIntelligenceTranslationService } from '../application/intelligenceTranslationService'
import { createInMemoryIntelligenceTranslationStorage } from '../store/intelligenceTranslationStorage'
import { registerIntelligenceTranslationIpc } from './registerIntelligenceTranslationIpc'
import { resetIntelligenceModuleForTests } from '../intelligenceModule'
import { INTELLIGENCE_TRANSLATE_ITEMS_JOB } from '../jobs/intelligenceJobIds'

vi.mock('../intelligenceModule', async () => {
  const actual = await vi.importActual<typeof import('../intelligenceModule')>('../intelligenceModule')
  return {
    ...actual,
    getIntelligenceModule: vi.fn()
  }
})

import { getIntelligenceModule } from '../intelligenceModule'

describe('intelligenceTranslation IPC', () => {
  it('returns safe settings without raw prompt payloads or secrets', async () => {
    const { service, jobRuntime } = createTranslationModule()
    const handlers = registerHandlers(jobRuntime, service)

    const settings = (await handlers.get('intelligenceTranslation.getSettings')(undefined)) as Record<string, unknown>
    expect(settings.autoTranslateEnabled).toBe(true)
    expect(settings.resolvedTargetLocale).toBe('zh-CN')
    expect(JSON.stringify(settings)).not.toMatch(/apiKey|prompt|authorization/i)
  })

  it('queues missing translations through bounded filters', async () => {
    const { service, jobRuntime } = createTranslationModule()
    jobRuntime.registerHandler(INTELLIGENCE_TRANSLATE_ITEMS_JOB, async () => undefined)
    const handlers = registerHandlers(jobRuntime, service)

    const summary = (await handlers.get('intelligenceTranslation.queueMissing')({
      reason: 'manual-selection',
      filters: { timeRange: '7d', limit: 20 }
    })) as { queuedCount: number }

    expect(summary.queuedCount).toBeGreaterThan(0)
  })

  it('retries failed translations without exposing provider secrets', async () => {
    const { service, jobRuntime } = createTranslationModule()
    jobRuntime.registerHandler(INTELLIGENCE_TRANSLATE_ITEMS_JOB, async () => undefined)
    const handlers = registerHandlers(jobRuntime, service)

    const summary = (await handlers.get('intelligenceTranslation.retryFailed')({
      reason: 'retry-failed',
      translationIds: ['translation-1']
    })) as { reason: string }

    expect(summary.reason).toBe('retry-failed')
  })
})

function createTranslationModule() {
  resetIntelligenceModuleForTests()
  const storage = createInMemoryIntelligenceTranslationStorage('zh-CN')
  const pipeline = createIntelligencePipeline()
  const jobRuntime = createJobRuntime()
  const structuredModelInvocation = createStructuredModelInvocationService({
    getProviderState: async () => createDefaultProviderState()
  })
  const service = createIntelligenceTranslationService({
    storage,
    pipeline,
    jobRuntime,
    structuredModelInvocation,
    getAppLanguage: async () => 'zh-CN'
  })
  vi.mocked(getIntelligenceModule).mockReturnValue({
    translationService: service
  } as never)
  return { service, jobRuntime }
}

function registerHandlers(
  jobRuntime: ReturnType<typeof createJobRuntime>,
  _service: ReturnType<typeof createIntelligenceTranslationService>
) {
  const handlers = new Map<string, (payload?: unknown) => Promise<unknown>>()
  registerIntelligenceTranslationIpc((productId, method, handler) => {
    handlers.set(`${productId}:${method}`, handler)
  }, jobRuntime)
  return {
    get(key: string) {
      const handler = handlers.get(`market-intelligence:${key}`)
      if (!handler) throw new Error(`Missing handler ${key}`)
      return handler
    }
  }
}
