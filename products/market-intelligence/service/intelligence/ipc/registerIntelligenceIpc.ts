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
import type { PushChannelResolution } from '@platform/notifications/delivery/pushChannelResolution'
import { parseIntelligenceTestRequest } from '../../../contracts/intelligenceNotificationTest'
import { sendIntelligenceTestNotification } from '../sendIntelligenceTestNotification'
import type { CalendarEventReminderWiring } from '../macro-calendar/registerCalendarEventReminder'
import type { IntelligenceNotificationTestWiring } from './notificationTestWiring'

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
    /** 提醒作业**原样暴露**的那一份事件读取：测试样例必须与真实提醒同源。 */
    readEvents: CalendarEventReminderWiring['readEvents']
  }>,
  /**
   * 三枚测试按钮要的平台侧接缝：通道解析、提交入口、数据源状态、读者时区。
   *
   * 由装配处（`bootstrap.ts`）注入，不在这里 import：注册器保持纯转发，用例可以只喂这几个函数。
   * 缺它是允许的（某些装配不接通知），但那时**这个方法不注册**——不会留下一个点了报错的入口。
   */
  notificationTest?: IntelligenceNotificationTestWiring & Readonly<{ now?: () => string }>,
  /**
   * 点击前的通道可用性：平台唯一那一份派生（`resolvePushChannel`），由装配处注射。
   * 这里只**去掉通道名**再交出去——渲染层拿不到名字，就不会拿它去拼「已发到 X」。
   */
  readPushChannel?: () => Promise<PushChannelResolution>
): void {
  if (notificationTest && calendarReminder) {
    // 注册器这一侧的 `read` 只声明成 `unknown`（它给设置页读整份视图）；测试样例要的是**类型化**的
    // 那一份。两者是同一个存储的同一次读取——这里按契约收窄，不另读一次。
    const testDeps = {
      ...notificationTest,
      intelligence: intelligenceModule,
      calendarReminder: calendarReminder as unknown as Pick<CalendarEventReminderWiring, 'read' | 'readEvents'>
    }
    register(PRODUCT_ID, INTELLIGENCE_IPC_METHODS.sendTestNotification, async (payload) =>
      sendIntelligenceTestNotification(parseIntelligenceTestRequest(payload), testDeps)
    )
  }

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

  if (readPushChannel !== undefined) {
    register(PRODUCT_ID, INTELLIGENCE_IPC_METHODS.getAnalysisConclusionSendChannel, async () => {
      const resolved = await readPushChannel()
      return resolved.ok
        ? { state: 'ready' as const }
        : { state: 'unavailable' as const, enabledChannelCount: resolved.enabledChannelCount, multiple: resolved.multiple }
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

  /**
   * 「发送到频道」的载荷校验：**只有运行 id 一个字段**，写在这里而不是复用别人的读取器
   * （推送请求被拿去按删除规矩校验过一次，那条 bug 就是复用造成的）。
   * 结论句、去重键、通道全部由主进程按 id 现取，渲染层传不了内容。
   */
  register(PRODUCT_ID, INTELLIGENCE_IPC_METHODS.sendAnalysisConclusion, async (payload) => {
    const analysisRunId = (payload as { analysisRunId?: unknown } | undefined)?.analysisRunId
    if (typeof analysisRunId !== 'string' || analysisRunId.trim().length === 0 || analysisRunId.length > 200) {
      throw new Error('analysisRunId must be a non-empty string of at most 200 characters.')
    }
    return intelligenceModule.marketAnalysisRuntime.sendConclusion({ analysisRunId })
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
