import { join } from 'node:path'

import type { JobRuntime } from '@platform/jobs'
import type { ProductIpcRegistrar } from '@platform/desktop/ipc/productIpcRegistry'
import { app } from 'electron'

import type { NormalizedMarketEvent } from '../schema/marketEvent'
import {
  createIntelligenceService,
  createMarketEventJsonStorage
} from '../application/intelligenceService'
import { createMarketEventStore } from '../application/marketEventStore'
import { getIntelligenceModule } from '../intelligenceModule'
import type {
  IntelligenceWorkspaceFilters,
  IntelligenceWorkspaceView
} from '../application/intelligenceWorkspaceQueries'
import type { NewsSentimentQuery } from '../schema/newsSentiment'
import { enqueueIntelligencePipelineJobs } from '../jobs/enqueueIntelligencePipelineJobs'
import { INTELLIGENCE_SCORE_NEWS_SENTIMENT_JOB } from '../jobs/intelligenceJobIds'

const PRODUCT_ID = 'market-intelligence'

let intelligenceService: ReturnType<typeof createIntelligenceService> | null = null

function getProductDataDir(): string {
  return join(app.getPath('userData'), 'products', PRODUCT_ID)
}

export function getIntelligenceService(jobRuntime: JobRuntime) {
  if (!intelligenceService) {
    const module = getIntelligenceModule(jobRuntime)
    intelligenceService = createIntelligenceService({
      marketEventStore: createMarketEventStore(
        createMarketEventJsonStorage(join(getProductDataDir(), 'market-events.json'))
      ),
      pipeline: module.pipeline,
      sourcesService: module.sourcesService,
      translationService: module.translationService
    })
  }
  return intelligenceService
}

export function registerIntelligenceIpc(register: ProductIpcRegistrar, jobRuntime: JobRuntime): void {
  register(PRODUCT_ID, 'intelligence.getTimeline', async (payload) => {
    const query = (payload ?? {}) as { filter?: 'active-exposure' | 'watchlist' | 'both' | 'all'; limit?: number }
    return getIntelligenceService(jobRuntime).getTimeline(query)
  })

  register(PRODUCT_ID, 'intelligence.getMonitoringScope', async () =>
    getIntelligenceService(jobRuntime).getMonitoringScope()
  )

  register(PRODUCT_ID, 'intelligence.ingestEvent', async (payload) => {
    const event = (payload ?? {}) as NormalizedMarketEvent
    if (!event.id?.trim() || !event.title?.trim() || !event.publishedAt || !event.detectedAt) {
      throw new Error('id, title, publishedAt, and detectedAt are required.')
    }
    return getIntelligenceService(jobRuntime).ingestNormalizedEvent(event)
  })

  register(PRODUCT_ID, 'intelligence.getWorkspaceState', async (payload) => {
    const input = (payload ?? {}) as {
      view?: IntelligenceWorkspaceView
      filters?: IntelligenceWorkspaceFilters
      textMode?: 'translated' | 'original'
    }
    if (input.view && !['overview', 'timeline', 'sentiment'].includes(input.view)) {
      throw new Error(`Unknown workspace view "${input.view}".`)
    }
    return getIntelligenceService(jobRuntime).getWorkspaceState(input)
  })

  register(PRODUCT_ID, 'intelligence.getWorkspaceTimeline', async (payload) => {
    return getIntelligenceService(jobRuntime).getWorkspaceTimeline((payload ?? {}) as IntelligenceWorkspaceFilters)
  })

  register(PRODUCT_ID, 'intelligence.getSentimentAggregates', async (payload) => {
    return getIntelligenceService(jobRuntime).getSentimentAggregates((payload ?? {}) as IntelligenceWorkspaceFilters)
  })

  register(PRODUCT_ID, 'intelligence.getNewsSentiment', async (payload) => {
    const module = getIntelligenceModule(jobRuntime)
    if (!module.newsSentiment.query) throw new Error('News sentiment is unavailable.')
    return module.newsSentiment.query.query((payload ?? {}) as NewsSentimentQuery)
  })

  register(PRODUCT_ID, 'intelligence.getNewsSentimentItem', async (payload) => {
    const input = (payload ?? {}) as { itemId?: string; asOf?: string }
    if (!input.itemId?.trim() || !input.asOf?.trim()) throw new Error('itemId and asOf are required.')
    const module = getIntelligenceModule(jobRuntime)
    if (!module.newsSentiment.query) throw new Error('News sentiment is unavailable.')
    return module.newsSentiment.query.getItem({ itemId: input.itemId, asOf: input.asOf })
  })

  register(PRODUCT_ID, 'intelligence.getNewsSentimentSettings', async () =>
    getIntelligenceModule(jobRuntime).newsSentiment.settings.get()
  )

  register(PRODUCT_ID, 'intelligence.rescoreNewsSentiment', async () => {
    const module = getIntelligenceModule(jobRuntime)
    if (!module.newsSentiment.scoring) throw new Error('News sentiment is unavailable.')
    await enqueueIntelligencePipelineJobs(jobRuntime, [INTELLIGENCE_SCORE_NEWS_SENTIMENT_JOB], {})
    return { queued: true }
  })

  register(PRODUCT_ID, 'intelligence.saveNewsSentimentSettings', async (payload) => {
    const patch = (payload ?? {}) as Record<string, unknown>
    if (typeof patch !== 'object' || Array.isArray(patch)) throw new Error('A settings patch is required.')
    const result = await getIntelligenceModule(jobRuntime).newsSentiment.settings.save(patch as never)
    // A new model or switch only affects items judged after it; rescore the recent ones now so the
    // card does not keep showing rule judgments until the next collection happens to run.
    await enqueueIntelligencePipelineJobs(jobRuntime, [INTELLIGENCE_SCORE_NEWS_SENTIMENT_JOB], {}).catch(() => undefined)
    return result
  })

  register(PRODUCT_ID, 'intelligence.getDetail', async (payload) => {
    const input = (payload ?? {}) as {
      clusterId?: string
      itemId?: string
      aggregateId?: string
      textMode?: 'translated' | 'original'
    }
    if (!input.clusterId && !input.itemId && !input.aggregateId) {
      throw new Error('clusterId, itemId, or aggregateId is required.')
    }
    return getIntelligenceService(jobRuntime).getDetail(input)
  })

  register(PRODUCT_ID, 'intelligence.getOperationsHealth', async () =>
    getIntelligenceService(jobRuntime).getOperationsHealth()
  )

  register(PRODUCT_ID, 'intelligence.retryItemAssessment', async (payload) => {
    const input = (payload ?? {}) as { itemId?: string }
    if (!input.itemId?.trim()) {
      throw new Error('itemId is required.')
    }
    return getIntelligenceService(jobRuntime).retryItemAssessment({ itemId: input.itemId })
  })
}

export function resetIntelligenceServiceForTests(): void {
  intelligenceService = null
}
