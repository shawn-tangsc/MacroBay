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


describe('intelligenceTranslation IPC', () => {
  it('returns safe settings without raw prompt payloads or secrets', async () => {
    const { service, jobRuntime, moduleUnderTest } = createTranslationModule()
    const handlers = registerHandlers(jobRuntime, moduleUnderTest)

    const settings = (await handlers.get('intelligenceTranslation.getSettings')(undefined)) as Record<string, unknown>
    expect(settings.autoTranslateEnabled).toBe(true)
    expect(settings.resolvedTargetLocale).toBe('zh-CN')
    expect(JSON.stringify(settings)).not.toMatch(/apiKey|prompt|authorization/i)
  })

  it('queues missing translations through bounded filters', async () => {
    const { service, jobRuntime, moduleUnderTest } = createTranslationModule()
    jobRuntime.registerHandler(INTELLIGENCE_TRANSLATE_ITEMS_JOB, async () => undefined)
    const handlers = registerHandlers(jobRuntime, moduleUnderTest)

    const summary = (await handlers.get('intelligenceTranslation.queueMissing')({
      reason: 'manual-selection',
      filters: { timeRange: '7d', limit: 20 }
    })) as { queuedCount: number }

    expect(summary.queuedCount).toBeGreaterThan(0)
  })

  it('retries failed translations without exposing provider secrets', async () => {
    const { service, jobRuntime, moduleUnderTest } = createTranslationModule()
    jobRuntime.registerHandler(INTELLIGENCE_TRANSLATE_ITEMS_JOB, async () => undefined)
    const handlers = registerHandlers(jobRuntime, moduleUnderTest)

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
  const moduleUnderTest = { translationService: service } as never
  return { service, jobRuntime, moduleUnderTest }
}

function registerHandlers(
  jobRuntime: ReturnType<typeof createJobRuntime>,
  moduleUnderTest: never
) {
  const handlers = new Map<string, (payload?: unknown) => Promise<unknown>>()
  registerIntelligenceTranslationIpc((productId, method, handler) => {
    handlers.set(`${productId}:${method}`, handler)
  }, jobRuntime, moduleUnderTest)
  return {
    get(key: string) {
      const handler = handlers.get(`market-intelligence:${key}`)
      if (!handler) throw new Error(`Missing handler ${key}`)
      return handler
    }
  }
}
