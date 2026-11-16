import { join } from 'node:path'

import type { JobRuntime } from '@platform/jobs'

import { createIntelligenceArchiveService } from './application/intelligenceArchiveService'
import { createIntelligenceReplayService } from './application/intelligenceReplayService'
import { createIntelligenceSourcesService } from './application/intelligenceSourcesService'
import { createMarketIntelligencePublicQueryService } from './public-query/publicQueryService'
import { createMarketAnalysisSettingsJsonStorage, createMarketAnalysisSettingsStore } from './application/marketAnalysisSettingsStore'
import { createMarketAnalysisSettingsService } from './application/marketAnalysisSettingsService'
import { registerMarketAnalysisRuntime } from './jobs/registerMarketAnalysisRuntime'
import { registerIntelligenceJobs } from './jobs/registerIntelligenceJobs'
import { registerIntelligenceDataChangedEvents } from './jobs/registerIntelligenceDataChanged'
import { enqueueIntelligencePipelineJobs } from './jobs/enqueueIntelligencePipelineJobs'
import {
  INTELLIGENCE_ENRICH_NEWS_DOCUMENTS_JOB,
  INTELLIGENCE_SCORE_NEWS_SENTIMENT_JOB
} from './jobs/intelligenceJobIds'
import { rebuildNewsSentimentStorage } from './news-sentiment/newsSentimentStoreRecovery'
import { INTELLIGENCE_PRODUCT_ID } from './intelligenceModuleContracts'

import type { createIntelligencePipeline } from './application/intelligencePipeline'
import type { createIntelligenceTranslationService } from './application/intelligenceTranslationService'
import type { createStructuredModelInvocationService } from '@platform/ai/invocation/structuredModelInvocation'
import type { RawRecordStore } from './application/rawRecordStore'
import type { SourceProfileStore } from './application/sourceProfileStore'
import type { IntelligenceCredentialStore } from './store/intelligenceCredentialStore'
import type { createCapitalConditionsSourceIntegration } from './capital-conditions/capitalConditionsSourceIntegration'
import type { createCapitalConditionsSnapshotQueryService } from './capital-conditions/capitalConditionsSnapshotQuery'
import type { createEtfCurrentStateRefreshService } from './etf/etfCurrentStateRefreshService'
import type { createFundingRateHistoryRefreshService } from './funding-rate/fundingRateHistoryRefreshService'
import type { createOpenInterestRefreshService } from './open-interest/openInterestRefreshService'
import type { FundingRateHistoryStore } from './store/fundingRateHistoryStore'
import type { PerpetualPositioningStore } from './store/perpetualPositioningStore'
import type { createSourceRequestGovernanceQueue } from './application/sourceRequestGovernance'
import type { ManagedWorkerRuntime } from '@platform/jobs'
import type { IntelligenceModulePlatformHooks } from './intelligenceModuleContracts'
import type { createIntelligenceNewsSentiment } from './intelligenceModuleNewsSentiment'

/**
 * `intelligenceModule` 的运行时与作业注册（拆分 M5，2026-11-15，**只搬不改**）。
 *
 * 这一段是「装配完跑起来」的那半：归档、重放、三个作业的注册、数据变更事件、公共查询、
 * 分析运行时、来源服务，以及读者重建舆情库那条闭包。三件必须留在这里而不是搬走：
 *
 * 1. **注册副作用**：`registerIntelligenceJobs` 必须在启动链之前跑（晚一步就会入队一个没有
 *    handler 的定义 → `Unknown job handler`），所以工厂的调用点位置不许动；
 * 2. **`intelligenceJobDeps` 按引用传递**：重建会换掉 `newsSentiment` 那两件，已注册的 handler
 *    必须看到新的（二次注册会抛），所以它是可变对象、被重建闭包原地改写；
 * 3. **公共查询的 `setNewsSentimentQuery`**：重建后同一处重新接线，两个出口不能各说各话。
 *
 * 与搬出来之前相比，**唯一差异是入参解构**：原先读闭包里的 `shellTimeZone`（现传 `timeZone` thunk）
 * 与模块常量 `PRODUCT_ID`（现用它的唯一定义名 `INTELLIGENCE_PRODUCT_ID`），其余逐字相同。
 */
export function createIntelligenceRuntimes(input: {
  jobRuntime: JobRuntime
  dataDir: string
  timeZone: () => string
  getAppLanguage: () => Promise<'zh-CN' | 'en-US'>
  pipeline: ReturnType<typeof createIntelligencePipeline>
  rawRecordStore: RawRecordStore
  translationService: ReturnType<typeof createIntelligenceTranslationService>
  capitalConditions: ReturnType<typeof createCapitalConditionsSourceIntegration>
  capitalConditionsQuery: ReturnType<typeof createCapitalConditionsSnapshotQueryService>
  fundingRateHistoryStore: FundingRateHistoryStore
  perpetualPositioningStore: PerpetualPositioningStore
  etfCurrentStateRefresh: ReturnType<typeof createEtfCurrentStateRefreshService>
  fundingRateHistoryRefresh: ReturnType<typeof createFundingRateHistoryRefreshService>
  openInterestWithSignals: ReturnType<typeof createOpenInterestRefreshService>
  newsSentiment: ReturnType<typeof createIntelligenceNewsSentiment>
  profileStore: SourceProfileStore
  workerRuntime: ManagedWorkerRuntime
  structuredModelInvocation: ReturnType<typeof createStructuredModelInvocationService>
  credentialStore: IntelligenceCredentialStore
  requestGovernanceQueue: ReturnType<typeof createSourceRequestGovernanceQueue>
  hooks: IntelligenceModulePlatformHooks
}) {
  const {
    jobRuntime, dataDir, timeZone, getAppLanguage, pipeline, rawRecordStore, translationService,
    capitalConditions, capitalConditionsQuery, fundingRateHistoryStore, perpetualPositioningStore,
    etfCurrentStateRefresh, fundingRateHistoryRefresh, openInterestWithSignals, newsSentiment, profileStore, workerRuntime,
    credentialStore, requestGovernanceQueue, structuredModelInvocation, hooks
  } = input
  const {
    newsSentimentExposure, assembleNewsSentiment, newsSentimentFilePath, newsSentimentStore,
    newsSentimentEnrichment, newsSentimentScoring
  } = newsSentiment
  const archiveService = createIntelligenceArchiveService({
    rawRecordStore,
    archiveBaseDir: join(dataDir, 'intelligence-archive'),
    compactTranslationRecords: async (retentionMode) => {
      const result = await translationService.compactDerivedRecords({ retentionMode })
      return result.removedCount
    }
  })
  const replayService = createIntelligenceReplayService({
    pipeline,
    enqueueJob: async (jobId, payload) => {
      await jobRuntime.enqueueDefinition({
        id: `${jobId}:${String(payload.sourceId ?? 'global')}:${Date.now()}`,
        owner: 'product',
        productId: INTELLIGENCE_PRODUCT_ID,
        handlerId: jobId,
        title: `Intelligence ${jobId.split('.').pop()}`,
        trigger: { kind: 'manual' },
        payload
      })
    }
  })

  // Passed by reference on purpose: a rebuild swaps the services, and the registered handlers
  // must see the new ones without being re-registered (a second registration throws).
  const intelligenceJobDeps: Parameters<typeof registerIntelligenceJobs>[1] = {
    pipeline,
    archiveService,
    replayService,
    translationService,
    capitalConditions,
    etfFlowHistory: etfCurrentStateRefresh,
    fundingRateHistory: fundingRateHistoryRefresh,
    openInterest: openInterestWithSignals,
    ...(newsSentimentEnrichment && newsSentimentScoring
      ? { newsSentiment: { enrichItems: newsSentimentEnrichment.enrichItems, scoreItems: newsSentimentScoring.scoreItems } }
      : {})
  }
  registerIntelligenceJobs(jobRuntime, intelligenceJobDeps)
  /* 采集写了库 → 发一条 `intelligence.dataChanged`（形状见合同，映射在 `jobs/dataChangedJobMap.ts`）。 */
  registerIntelligenceDataChangedEvents(INTELLIGENCE_PRODUCT_ID)
  // Judgments are event-driven: normalize only sends the items it just created. A cleared
  // database, a partial write failure, or a settings change leaves older admitted items with no
  // current row and no event to bring them back. One idempotent pass per start reconciles them
  // from title and summary; the score service skips anything already current and caps the pass.
  if (newsSentimentStore) {
    void enqueueIntelligencePipelineJobs(
      jobRuntime,
      [INTELLIGENCE_ENRICH_NEWS_DOCUMENTS_JOB, INTELLIGENCE_SCORE_NEWS_SENTIMENT_JOB],
      { limit: 500 }
    ).catch(() => undefined)
  }
  const publicQueryService = createMarketIntelligencePublicQueryService({ pipeline, capitalConditionsQuery, fundingRateHistoryStore, perpetualPositioningStore })
  // The divergence card asks whether the day's news was priced; that needs the same scored
  // headlines the news page and the analysis read, not the sentiment aggregate (which only
  // exists for market-wide scopes).
  const syncNewsSentimentPublicQuery = (): void => {
    const query = newsSentimentExposure.query
    publicQueryService.setNewsSentimentQuery(query ? { query: (input) => query.query(input) } : undefined)
  }
  syncNewsSentimentPublicQuery()
  // 读者主动重建：库正常 → 清空重抓；库打不开 → 先隔离现场、再建新库，并把新服务接回所有出口。
  newsSentimentExposure.rebuildStorage = () => {
    const existing = newsSentimentExposure.store
    if (existing) {
      existing.clearAll()
      return {}
    }
    const rebuilt = rebuildNewsSentimentStorage(newsSentimentFilePath)
    const pieces = assembleNewsSentiment(rebuilt.store)
    newsSentimentExposure.store = rebuilt.store
    newsSentimentExposure.enrichment = pieces.enrichment
    newsSentimentExposure.scoring = pieces.scoring
    newsSentimentExposure.bodyTranslation = pieces.bodyTranslation
    newsSentimentExposure.query = pieces.query
    intelligenceJobDeps.newsSentiment = {
      enrichItems: pieces.enrichment.enrichItems,
      scoreItems: pieces.scoring.scoreItems
    }
    syncNewsSentimentPublicQuery()
    return rebuilt.quarantinedCopy ? { quarantinedCopy: rebuilt.quarantinedCopy } : {}
  }
  // The analysis switches own the model as well as the on/off state: a background job may only
  // spend a request on a model the reader enabled it with.
  const marketAnalysisSettingsService = createMarketAnalysisSettingsService({
    store: createMarketAnalysisSettingsStore(
      createMarketAnalysisSettingsJsonStorage(join(dataDir, 'intelligence-analysis-settings.json'))
    ),
    now: () => new Date().toISOString(),
    ...(hooks?.getProviderState ? { getProviderState: hooks.getProviderState } : {}),
    ...(hooks?.getModelDefaults ? { getModelDefaults: hooks.getModelDefaults } : {})
  })
  const marketAnalysisRuntime = registerMarketAnalysisRuntime({
    jobRuntime,
    // 开盘时刻按设置的读者时区换算（唯一提供者）。
    timeZone: timeZone,
    eventBusRuntime: hooks?.eventBusRuntime,
    pipeline,
    publicQueryService,
    structuredModelInvocation,
    settingsService: marketAnalysisSettingsService,
    getAppLanguage,
    // 重点舆情进分析：与「Key sentiment」卡读的是同一个查询，窗口由分析运行时决定。
    // 动态读出口：库重建后不必重启分析运行时。库打不开时抛错，分析把这一域记成
    // `news-sentiment-unavailable`（与原先「没有读取器」同一条缺口，不是「没有舆情」）。
    newsSentimentQuery: {
      query: async (input) => {
        const query = newsSentimentExposure.query
        if (!query) throw new Error('news-sentiment-storage-unavailable')
        return query.query(input)
      }
    },
    // 触发判定要单独问「这一条判过没有、判成什么」，窗口查询答不了。同样动态读出口：
    // 库重建后不必重启分析运行时；库打不开时返回 undefined，严重度停在「还没判」。
    latestNewsSentiment: (itemId, asOf) => newsSentimentExposure.store?.getLatestSentiment(itemId, asOf),
    ...(hooks?.submitNotification ? { submitNotification: hooks.submitNotification } : {}),
    dataDir
  })
  const sourcesService = createIntelligenceSourcesService({
    profileStore,
    pipeline,
    jobRuntime,
    workerRuntime,
    replayService,
    capitalConditions,
    credentialStore,
    onCalendarEnabledChanged: hooks?.onCalendarEnabledChanged,
    onSourceEnabledChanged: hooks?.onSourceEnabledChanged,
    requestGovernanceQueue,
    ...(hooks?.platformFetch ? { platformFetch: hooks.platformFetch as typeof fetch } : {})
  })
  return { archiveService, replayService, publicQueryService, marketAnalysisRuntime, sourcesService }
}
