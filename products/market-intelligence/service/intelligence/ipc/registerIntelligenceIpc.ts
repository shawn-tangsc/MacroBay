import { join } from 'node:path'

import type { JobRuntime } from '@platform/jobs'

import type { IntelligenceModule } from '../intelligenceModule'
import type { ProductIpcRegistrar } from '@platform/desktop/ipc/productIpcRegistry'
import { app } from 'electron'

import type { NormalizedMarketEvent } from '../schema/marketEvent'
import {
  createIntelligenceService,
  createMarketEventJsonStorage
} from '../application/intelligenceService'
import { createMarketEventStore } from '../application/marketEventStore'
import type {
  IntelligenceWorkspaceFilters,
  IntelligenceWorkspaceView
} from '../application/intelligenceWorkspaceQueries'
import type { NewsSentimentQuery } from '../schema/newsSentiment'
import { enqueueIntelligencePipelineJobs } from '../jobs/enqueueIntelligencePipelineJobs'
import { createNewsPushLedgerStore, newsPushLedgerPolicy } from '../news-sentiment/newsPushLedgerStore'
import { createNewsPushOutletService } from '../news-sentiment/newsPushOutletService'
import { INTELLIGENCE_ENRICH_NEWS_DOCUMENTS_JOB, INTELLIGENCE_SCORE_NEWS_SENTIMENT_JOB } from '../jobs/intelligenceJobIds'
import { INTELLIGENCE_IPC_METHODS } from '../../../contracts/intelligenceIpcMethods'

const PRODUCT_ID = 'market-intelligence'

let intelligenceService: ReturnType<typeof createIntelligenceService> | null = null

function getProductDataDir(): string {
  return join(app.getPath('userData'), 'products', PRODUCT_ID)
}

export function getIntelligenceService(intelligenceModule: IntelligenceModule) {
  if (!intelligenceService) {
    const module = intelligenceModule
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

let newsPushOutletService: ReturnType<typeof createNewsPushOutletService> | null = null

/**
 * 开关请求的校验：`enabled` 必须是布尔；水位缺省取服务端「现在」，给了就必须是可读的 ISO 时刻。
 * 单独抽出来是因为这里**有判断**（而转发本身没有），能被用例证明。
 */
export function parseOutletSwitchPayload(payload: unknown): { enabled: boolean; at: string } {
  const input = (payload ?? {}) as { enabled?: unknown; at?: unknown }
  if (typeof input.enabled !== 'boolean') throw new Error('enabled must be a boolean.')
  const at = typeof input.at === 'string' ? input.at : new Date().toISOString()
  if (Number.isNaN(Date.parse(at))) throw new Error('at must be an ISO instant.')
  return { enabled: input.enabled, at }
}

/**
 * 「情报 × 设置 × 通知」第四条开关（舆情提醒）的服务侧入口。
 *
 * 两个通道只做转发：**基线由 `setEnabled` 内部算**，IPC 层不传 itemId、也不碰账本文件；
 * 状态只有 `state()` 一个来源，页面不许缓存。
 */
function getNewsPushOutletService(module: IntelligenceModule) {
  if (!newsPushOutletService) {
    newsPushOutletService = createNewsPushOutletService({
      ledger: createNewsPushLedgerStore(join(getProductDataDir(), newsPushLedgerPolicy.fileName)),
      listItems: () =>
        module.pipeline.listItems().map((item) => ({ itemId: item.itemId, publishedAt: item.publishedAt ?? '' }))
    })
  }
  return newsPushOutletService
}

export function registerIntelligenceIpc(
  register: ProductIpcRegistrar,
  jobRuntime: JobRuntime,
  intelligenceModule: IntelligenceModule,
  /** 「日历事件 · 开始前」的配置与排程接口；页面只读它、写它，不自己算。 */
  calendarReminder?: Readonly<{
    read: () => unknown
    write: (patch: Readonly<Record<string, unknown>>) => unknown
    applySchedule: (enabled: boolean) => void
  }>
): void {
  if (calendarReminder) {
    register(PRODUCT_ID, INTELLIGENCE_IPC_METHODS.getCalendarReminderSettings, async () => calendarReminder.read())
    register(PRODUCT_ID, INTELLIGENCE_IPC_METHODS.setCalendarReminderSettings, async (payload) => {
      const patch = (payload ?? {}) as Readonly<Record<string, unknown>>
      const next = calendarReminder.write(patch)
      // 写设置的人就是让排程生效的人：不留「设置开了、作业没排上」的中间态。
      calendarReminder.applySchedule((next as { enabled?: boolean }).enabled === true)
      return next
    })
  }

  register(PRODUCT_ID, INTELLIGENCE_IPC_METHODS.getNewsPushOutletState, async () =>
    getNewsPushOutletService(intelligenceModule).state()
  )

  register(PRODUCT_ID, INTELLIGENCE_IPC_METHODS.setNewsPushOutletEnabled, async (payload) => {
    const { enabled, at } = parseOutletSwitchPayload(payload)
    return getNewsPushOutletService(intelligenceModule).setEnabled(enabled, at)
  })

  // 强度门槛（弱/中/强）：读与写都只碰这一份存储。写只收三档之一，非法值原样退回原值，
  // 页面读回的值说了算——不在这一层替读者「修」成看起来合理的档。
  // 存储住在评分服务里（判定读的也是它那一份）：没有它就等于舆情不可用，报错而不是给个默认值。
  const pushThresholdStore = () => {
    const store = intelligenceModule.newsSentiment.scoring?.pushThreshold
    if (!store) throw new Error('News sentiment is unavailable.')
    return store
  }

  register(PRODUCT_ID, INTELLIGENCE_IPC_METHODS.getNewsPushThreshold, async () => pushThresholdStore().read())

  register(PRODUCT_ID, INTELLIGENCE_IPC_METHODS.saveNewsPushThreshold, async (payload) => {
    const patch = (payload ?? {}) as { pushThreshold?: unknown }
    return pushThresholdStore().write({ pushThreshold: patch.pushThreshold })
  })

  register(PRODUCT_ID, INTELLIGENCE_IPC_METHODS.getTimeline, async (payload) => {
    const query = (payload ?? {}) as { filter?: 'active-exposure' | 'watchlist' | 'both' | 'all'; limit?: number }
    return getIntelligenceService(intelligenceModule).getTimeline(query)
  })

  register(PRODUCT_ID, INTELLIGENCE_IPC_METHODS.getMonitoringScope, async () =>
    getIntelligenceService(intelligenceModule).getMonitoringScope()
  )

  register(PRODUCT_ID, INTELLIGENCE_IPC_METHODS.ingestEvent, async (payload) => {
    const event = (payload ?? {}) as NormalizedMarketEvent
    if (!event.id?.trim() || !event.title?.trim() || !event.publishedAt || !event.detectedAt) {
      throw new Error('id, title, publishedAt, and detectedAt are required.')
    }
    return getIntelligenceService(intelligenceModule).ingestNormalizedEvent(event)
  })

  register(PRODUCT_ID, INTELLIGENCE_IPC_METHODS.getWorkspaceState, async (payload) => {
    const input = (payload ?? {}) as {
      view?: IntelligenceWorkspaceView
      filters?: IntelligenceWorkspaceFilters
      textMode?: 'translated' | 'original'
    }
    if (input.view && !['overview', 'timeline', 'sentiment'].includes(input.view)) {
      throw new Error(`Unknown workspace view "${input.view}".`)
    }
    return getIntelligenceService(intelligenceModule).getWorkspaceState(input)
  })

  register(PRODUCT_ID, INTELLIGENCE_IPC_METHODS.getWorkspaceTimeline, async (payload) => {
    return getIntelligenceService(intelligenceModule).getWorkspaceTimeline((payload ?? {}) as IntelligenceWorkspaceFilters)
  })

  register(PRODUCT_ID, INTELLIGENCE_IPC_METHODS.getSentimentAggregates, async (payload) => {
    return getIntelligenceService(intelligenceModule).getSentimentAggregates((payload ?? {}) as IntelligenceWorkspaceFilters)
  })

  register(PRODUCT_ID, INTELLIGENCE_IPC_METHODS.getNewsSentiment, async (payload) => {
    const module = intelligenceModule
    if (!module.newsSentiment.query) throw new Error('News sentiment is unavailable.')
    return module.newsSentiment.query.query((payload ?? {}) as NewsSentimentQuery)
  })

  register(PRODUCT_ID, INTELLIGENCE_IPC_METHODS.getNewsSentimentItem, async (payload) => {
    const input = (payload ?? {}) as { itemId?: string; asOf?: string }
    if (!input.itemId?.trim() || !input.asOf?.trim()) throw new Error('itemId and asOf are required.')
    const module = intelligenceModule
    if (!module.newsSentiment.query) throw new Error('News sentiment is unavailable.')
    return module.newsSentiment.query.getItem({ itemId: input.itemId, asOf: input.asOf })
  })

  register(PRODUCT_ID, INTELLIGENCE_IPC_METHODS.getNewsSentimentSettings, async () =>
    intelligenceModule.newsSentiment.settings.get()
  )

  register(PRODUCT_ID, INTELLIGENCE_IPC_METHODS.translateNewsSentimentBody, async (payload) => {
    const itemId = typeof (payload as { itemId?: unknown })?.itemId === 'string' ? String((payload as { itemId: string }).itemId) : ''
    const force = (payload as { force?: unknown })?.force === true
    if (!itemId) throw new Error('An itemId is required.')
    const module = intelligenceModule
    if (!module.newsSentiment.bodyTranslation) throw new Error('Body translation is unavailable.')
    const result = await module.newsSentiment.bodyTranslation.translate(itemId, { manual: true, force })
    return result
  })

  register(PRODUCT_ID, INTELLIGENCE_IPC_METHODS.rebuildNewsSentiment, async () => {
    const module = intelligenceModule
    if (!module.newsSentiment.store) throw new Error('News sentiment storage is unavailable.')
    module.newsSentiment.store.clearAll()
    await enqueueIntelligencePipelineJobs(jobRuntime, [INTELLIGENCE_ENRICH_NEWS_DOCUMENTS_JOB], { rebuild: true })
    return { queued: true }
  })

  register(PRODUCT_ID, INTELLIGENCE_IPC_METHODS.rescoreNewsSentiment, async () => {
    const module = intelligenceModule
    if (!module.newsSentiment.scoring) throw new Error('News sentiment is unavailable.')
    await enqueueIntelligencePipelineJobs(jobRuntime, [INTELLIGENCE_SCORE_NEWS_SENTIMENT_JOB], {})
    return { queued: true }
  })

  register(PRODUCT_ID, INTELLIGENCE_IPC_METHODS.saveNewsSentimentSettings, async (payload) => {
    const patch = (payload ?? {}) as Record<string, unknown>
    if (typeof patch !== 'object' || Array.isArray(patch)) throw new Error('A settings patch is required.')
    const result = await intelligenceModule.newsSentiment.settings.save(patch as never)
    // A new model or switch only affects items judged after it; rescore the recent ones now so the
    // card does not keep showing rule judgments until the next collection happens to run.
    await enqueueIntelligencePipelineJobs(jobRuntime, [INTELLIGENCE_SCORE_NEWS_SENTIMENT_JOB], {}).catch(() => undefined)
    return result
  })

  register(PRODUCT_ID, INTELLIGENCE_IPC_METHODS.getDetail, async (payload) => {
    const input = (payload ?? {}) as {
      clusterId?: string
      itemId?: string
      aggregateId?: string
      textMode?: 'translated' | 'original'
    }
    if (!input.clusterId && !input.itemId && !input.aggregateId) {
      throw new Error('clusterId, itemId, or aggregateId is required.')
    }
    return getIntelligenceService(intelligenceModule).getDetail(input)
  })

  register(PRODUCT_ID, INTELLIGENCE_IPC_METHODS.getOperationsHealth, async () =>
    getIntelligenceService(intelligenceModule).getOperationsHealth()
  )

  register(PRODUCT_ID, INTELLIGENCE_IPC_METHODS.retryItemAssessment, async (payload) => {
    const input = (payload ?? {}) as { itemId?: string }
    if (!input.itemId?.trim()) {
      throw new Error('itemId is required.')
    }
    return getIntelligenceService(intelligenceModule).retryItemAssessment({ itemId: input.itemId })
  })
}

export function resetIntelligenceServiceForTests(): void {
  intelligenceService = null
}
