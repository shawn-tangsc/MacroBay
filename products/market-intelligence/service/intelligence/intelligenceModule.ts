import { join } from 'node:path'
import { readFile } from 'node:fs/promises'

import type { JobRuntime, ManagedWorkerRuntime } from '@platform/jobs'
import { createManagedWorkerRuntime } from '@platform/jobs'
import type { EventBusRuntime } from '@platform/message-bus'
import type { AgentChatRuntimeRequest, AgentChatRuntimeResult } from '@platform/ai/agent-platform/runtime/agentChatRuntime'
import type { AgentSessionEntity, AgentSessionMessageEntity, CreateAgentSessionDto, CreateAgentSessionMessagesDto, UpdateAgentSessionDto } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import type { PlatformWebSocketConstructor } from '@platform/network/platformWebSocket'
import type { NotificationSubmitOutcome, NotificationSubmitRequest } from '@platform/notifications/contracts/notificationContracts'
import type { DailyBriefingLocale } from '../../contracts/dailyBriefing'
import type { ProviderState } from '@platform/ai/providers/modelProviderTypes'
import { createStructuredModelInvocationService } from '@platform/ai/invocation/structuredModelInvocation'
import { firstReboundSingletonHook } from './intelligenceModuleHooks'
import type { ModelDefaultsSettings } from '@platform/settings/schema/appSettings'
import { app } from 'electron'

import { createIntelligenceFetchText, executeIntelligenceFetchTarget } from './adapters/intelligenceHttpFetch'
import { createIntelligenceArchiveService } from './application/intelligenceArchiveService'
import { createIntelligencePipeline } from './application/intelligencePipeline'
import { createSourceIssueWiring } from './application/sourceIssueWiring'
import { createIntelligenceEventPublisher } from './application/intelligenceEventPublisher'
import { createIntelligenceReplayService } from './application/intelligenceReplayService'
import { createIntelligenceSourcesService } from './application/intelligenceSourcesService'
import { DEFAULT_SOURCE_FRESHNESS_MS } from './application/macroSourceHealth'
import { createMarketIntelligencePublicQueryService } from './public-query/publicQueryService'
import { createIntelligenceTranslationService } from './application/intelligenceTranslationService'
import { createMarketAnalysisSettingsJsonStorage, createMarketAnalysisSettingsStore } from './application/marketAnalysisSettingsStore'
import { createMarketAnalysisSettingsService } from './application/marketAnalysisSettingsService'
import { createDefaultTranslationSettings } from './application/intelligenceTranslationHelpers'
import { createRawRecordStore } from './application/rawRecordStore'
import { createProfileJsonStorage, createSourceProfileStore } from './application/sourceProfileStore'
import { disableUnusedKeylessSources, migrateKeylessSourceDefaults } from './application/keylessSourceDefaultsMigration'
import {
  createIntelligenceCredentialJsonStorage,
  createIntelligenceCredentialStore
} from './store/intelligenceCredentialStore'
import {
  createIntelligencePipelineJsonStorage,
  readIntelligencePipelineSnapshotSync
} from './store/intelligencePipelineStateStorage'
import {
  createIntelligenceRuntimeStateJsonStorage,
  readIntelligenceRuntimeStateSync
} from './store/intelligenceRuntimeStateStorage'
import {
  createIntelligenceRuntimeStateHistoryJsonStorage,
  readIntelligenceRuntimeStateHistorySync
} from './store/intelligenceRuntimeStateHistoryStorage'
import {
  createIntelligenceTranslationJsonStorage
} from './store/intelligenceTranslationStorage'
import {
  createNewsSentimentSettingsJsonStorage,
  createNewsSentimentSettingsStore
} from './news-sentiment/newsSentimentSettingsStore'
import { createNewsSentimentSqliteStore, newsSentimentStoragePolicy } from './news-sentiment/newsSentimentStore'
import { rebuildNewsSentimentStorage } from './news-sentiment/newsSentimentStoreRecovery'
import { createNewsSentimentServices } from './news-sentiment/newsSentimentServices'
import { createNewsSentimentEnrichmentService } from './news-sentiment/newsSentimentEnrichmentService'
import { createNewsSentimentScoringService, newsPushLedgerPolicy } from './news-sentiment/newsSentimentScoringService'
import { createNewsSentimentQuery } from './news-sentiment/newsSentimentQuery'
import { createNewsSentimentBodyTranslationService } from './news-sentiment/newsSentimentBodyTranslation'
import { createDailyBriefingSqliteStore } from './daily-briefing/dailyBriefingStore'
import { createDailyBriefingSource } from './daily-briefing/dailyBriefingSource'
import { unavailableNewsQuery } from './daily-briefing/dailyBriefingNewsFallback'
import { createDailyBriefingService, createDailyBriefReadinessFor, type DailyBriefingService } from './daily-briefing/dailyBriefingService'
import { macroWebReadFromHooks, type WebSearchProductHooks } from './webSearchProductHooks'
import { briefingNotificationPorts, createBriefingCalendarCommands, type BriefingCalendarRefresh } from './daily-briefing/briefingPorts'
import { currentBriefMarketBackfill } from './daily-briefing/dailyBriefMarketBackfill'
import { createDailyBriefingPeriodDeletion, type DailyBriefingPeriodDeletion } from './daily-briefing/dailyBriefingPeriodDeletion'
import { createBriefingPeriodsSource } from './daily-briefing/dailyBriefingPeriodsSource'
import { createDailyBriefFactEnsure } from './daily-briefing/dailyBriefFactEnsure'
import { createDailyBriefFactEnsureJsonCache } from './daily-briefing/dailyBriefFactEnsureCache'
import { ensureDailyBriefFactsAtStartup } from './daily-briefing/dailyBriefFactEnsureStartup'
import { DAILY_BRIEFING_SOURCE_IDS } from './daily-briefing/dailyBriefingReadingSources'
import { applyDailyBriefingSchedules } from './jobs/registerDailyBriefingJob'
import { resolveBriefingTimeZone } from './daily-briefing/readerTimeZone'
import { wireDailyBriefingJobs } from './daily-briefing/dailyBriefingJobs'
import type { BriefingPeriodsEditor } from './daily-briefing/dailyBriefingPeriodsSource'
import { createDailyBriefSessionLinkStore } from './daily-briefing/dailyBriefSessionLinks'
import { claimExistingBriefingSessions, createDailyBriefEditorSessionPort, findLatestBriefingSessionId } from './daily-briefing/dailyBriefEditorSessionPort'
import { createDailyBriefAgentRunner } from './daily-briefing/dailyBriefAgentRunner'
import { resolveBriefingRunAllowedTools } from './daily-briefing/dailyBriefAgentAllowedTools'
import { createDailyBriefBackfillExecutor } from './public-query/dailyBriefBackfill'
import { createEtfHistoryAsOf } from './public-query/etfHistoryAsOf'
import { createStablecoinHistoryAsOf } from './public-query/stablecoinHistoryAsOf'
import type { PolicyPathQueryService } from './policy-path/policyPathQueryService'
import { createDailyBriefingAiSettingsStore, createDailyBriefingAiSettingsJsonStorage } from './daily-briefing/dailyBriefingAiSettingsStore'
import { createEditionLanguageSettingsService, createEditionLanguageSettingsJsonStorage } from './daily-briefing/dailyBriefingLanguageSettingsService'
import { createDailyBriefingAiSettingsService } from './daily-briefing/dailyBriefingAiSettingsService'
import { readDailyBriefingPeriodsSettings } from './daily-briefing/dailyBriefingGenerationSettings'
import { createJsonFileStorage } from '@platform/storage/jsonFileStorage'
import {
  createDailyBriefingSettingsService,
  type DailyBriefingSettingsService
} from './daily-briefing/dailyBriefingSettingsService'
import { resolveNewsSentimentModel } from './news-sentiment/newsSentimentSettings'
import type { NewsSentimentSettings, NewsSentimentSettingsView } from './schema/newsSentiment'
import { queryOpenInterestHistoryAsync } from './public-query/openInterestHistoryQuery'
import { createSignalledOpenInterestRefresh } from './signals/openInterestSignalNotifier'
import { etfOutflowSignalHandoff } from './signals/etfOutflowSignalHandoff'
import { intelligenceHttpRequest } from './adapters/intelligenceHttpClient'
import {
  createRawRecordJsonStorage,
  readRawRecordSnapshotSync
} from './store/rawRecordStorage'
import {
  INTELLIGENCE_NORMALIZE_RAW_RECORDS_JOB,
  INTELLIGENCE_REPLAY_WINDOW_JOB
} from './jobs/intelligenceJobIds'
import { registerIntelligenceJobs } from './jobs/registerIntelligenceJobs'
import { registerIntelligenceDataChangedEvents } from './jobs/registerIntelligenceDataChanged'
import { enqueueIntelligencePipelineJobs } from './jobs/enqueueIntelligencePipelineJobs'
import { INTELLIGENCE_ENRICH_NEWS_DOCUMENTS_JOB, INTELLIGENCE_SCORE_NEWS_SENTIMENT_JOB } from './jobs/intelligenceJobIds'
import { registerMarketAnalysisRuntime, type MarketAnalysisRuntime } from './jobs/registerMarketAnalysisRuntime'
import { statSync } from 'node:fs'
import { resolveConfiguredModel } from '@platform/ai/model-defaults/configuredDefaultModel'
import { createMacroCalendarEvidenceArchive } from './macro-calendar/macroCalendarEvidenceArchive'
import { createMacroCalendarEvidenceStore } from './macro-calendar/macroCalendarEvidenceStore'
import { createCapitalConditionsHttpClient, type CapitalConditionsPlatformFetch } from './capital-conditions/capitalConditionsHttpClient'
import { createCapitalConditionsRefreshService } from './capital-conditions/capitalConditionsRefreshService'
import { createCapitalConditionsSourceIntegration } from './capital-conditions/capitalConditionsSourceIntegration'
import { createCapitalConditionsStateJsonStorage, createCapitalConditionsCurrentStateStore } from './capital-conditions/stablecoinCapitalCurrentStateStore'
import { createCapitalConditionsSnapshotQueryService } from './capital-conditions/capitalConditionsSnapshotQuery'
import { createSourceRequestGovernanceQueue } from './application/sourceRequestGovernance'
import { createEtfCurrentStateSqliteStorage, createEtfCurrentStateStore } from './store/etfCurrentStateStore'
import { createEtfCurrentStateRefreshService } from './etf/etfCurrentStateRefreshService'
import { createZeroXRouterEtfFlowHistoryClient } from './application/zeroXRouterEtfFlowHistoryClient'
import { zeroXRouterSourcePolicy } from './application/zeroXRouterSourcePolicy'
import { createFundingRateHistorySqliteStore } from './store/fundingRateHistoryStore'
import { createPerpetualPositioningSqliteStore } from './store/perpetualPositioningStore'
import { createBinanceOpenInterestClient } from './open-interest/binanceOpenInterestClient'
import { createOpenInterestRefreshService } from './open-interest/openInterestRefreshService'
import { createFundingRateHistoryRefreshService } from './funding-rate/fundingRateHistoryRefreshService'
import { createBinanceFundingRateHistoryClient } from './funding-rate/binanceFundingRateHistoryClient'
import { createZeroXRouterCalendarEvidenceAdmissionService } from './macro-calendar/0xrouter-calendar/zeroXRouterCalendarEvidenceAdmissionService'
import { createMacroMarketRuntime, type MacroMarketRuntime } from './macro-market/macroMarketRuntime'
import { createMacroMarketLive } from './macro-market/macroMarketLive'
import { createDashboardFeedStatusQuery, type DashboardFeedStatusQuery } from './macro-market/dashboardFeedStatusQuery'
import type { GoldLiveRuntime } from './macro-market/goldLiveRuntime'
import { macroMarketPolicy } from './macro-market/macroMarketPolicy'
import { requestZeroXRouterCalendarJsonBody } from './application/zeroXRouterHttpTransport'

const PRODUCT_ID = 'market-intelligence'

/**
 * One line at main-process startup naming the bundle that is actually running.
 *
 * The reader and I spent a long stretch comparing a fixed build against a window that had loaded an
 * older one: a renderer reload looks like a restart in the terminal, and the main process quietly
 * keeps the code it started with. Printing the bundle's own modification time (and the start time)
 * makes "which build is live" a fact rather than a deduction.
 */
function logMainStartupBundle(): void {
  try {
    const bundle = statSync(__filename)
    console.log(JSON.stringify({
      marker: 'MI_MAIN_STARTUP', productId: PRODUCT_ID,
      bundleBuiltAt: new Date(bundle.mtimeMs).toISOString(), bundleBytes: bundle.size,
      startedAt: new Date().toISOString(), pid: process.pid
    }))
  } catch {
    // A marker that cannot be read must never stop the product from starting.
  }
}
logMainStartupBundle()

const intelligenceRawRecordStartupRecoveryPolicy = {
  completionObservationTimeoutMs: 30_000,
  definition() {
    return {
      id: 'market-intelligence.startup-recover-pending-raw-records',
      owner: 'product' as const,
      productId: PRODUCT_ID,
      handlerId: INTELLIGENCE_NORMALIZE_RAW_RECORDS_JOB,
      title: 'Recover pending intelligence raw records',
      trigger: { kind: 'startup' as const },
      payload: {}
    }
  },
  async completeBeforeSourceRuntime(jobRuntime: Pick<JobRuntime, 'enqueueDefinition' | 'waitForRunTerminal'>): Promise<void> {
    try {
      const run = await jobRuntime.enqueueDefinition(this.definition())
      await jobRuntime.waitForRunTerminal(run.id, {
        timeoutMs: this.completionObservationTimeoutMs
      })
    } catch {
      // Source runtime recovery remains available when pending raw recovery cannot start or observe completion.
    }
  }
} as const

export type IntelligenceModulePlatformHooks = WebSearchProductHooks & {
  getProviderState?: () => Promise<ProviderState>; /** 平台落盘日志（app.log）：补跑等后台事实走它，console 只在终端里。 */ log?: (level: 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>) => void
  getAppLanguage?: () => Promise<'zh-CN' | 'en-US'>
  /** 模型服务页「默认模型」只读投影；翻译偏好跟随其中的默认翻译模型。 */
  getModelDefaults?: () => Promise<ModelDefaultsSettings>
  eventBusRuntime?: EventBusRuntime
  /** Required: the first call must inject it, and every consumer reads this one. */
  platformFetch: CapitalConditionsPlatformFetch
  /** The shell's single time zone reader; a product job's day boundary follows the setting, never the machine. Required: a missing one used to become UTC silently. */
  getTimeZone: () => string
  /** The reader changed their display zone: the brief schedule follows it without a settings save. */
  onSettingsCommitted?: (listener: (change: Readonly<{ changedKeys: readonly string[]; next: Readonly<{ timeZone: string }> }>) => void) => () => void
  /**
   * The platform's proxy-aware socket constructor, injected lazily. It is a thunk rather than a
   * constructor because the desktop shell can only build it once network settings are readable —
   * binding it eagerly would hand the product a constructor that fails on its first connect.
   */
  createPlatformWebSocket?: () => PlatformWebSocketConstructor
  /** Any source switch, so a product-owned job can arm or drop its own schedule. */
  onSourceEnabledChanged?: (sourceId: string) => void | Promise<void>
  /** Reconcile the automatic calendar job registry after a feed switch. */
  onCalendarEnabledChanged?: () => void | Promise<void>
  createAgentSession?: (input: CreateAgentSessionDto) => Promise<AgentSessionEntity>
  /** 自动会话的幂等窄查（按 agentId + originRef）：同一期只复用一条会话。 */
  findAgentSessionByAutomationRef?: (agentId: string, originRef: string) => Promise<AgentSessionEntity | null>
  sendAgentMessage?: (request: AgentChatRuntimeRequest) => Promise<AgentChatRuntimeResult>
  cancelAgentSession?: (sessionId: string) => Promise<void> | void
  appendAgentSessionMessages?: (input: CreateAgentSessionMessagesDto) => Promise<AgentSessionMessageEntity[]>
  updateAgentSession?: (sessionId: string, patch: UpdateAgentSessionDto) => Promise<AgentSessionEntity>
  deleteAgentSessions?: (sessionIds: string[]) => Promise<unknown>
  updateAgent?: (agentId: string, patch: import('@platform/ai/agent-platform/schemas/agentSchemas').UpdateAgentDto) => Promise<unknown>
  /** 平台通知运行时的提交入口（契约 §3.2）；未注入时来源事件不发通知，采集照常。 */
  submitNotification?: (request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>
  /** 平台「把一条已有记录再推一次手机」的入口（契约 §16.3.4）；只给读者点击的发布按钮用。 */
  redeliverPush?: import('./daily-briefing/dailyBriefingPublishToPhone').BriefingRedeliver
}

let briefingPolicyPathQuery: PolicyPathQueryService | undefined
export type IntelligenceModule = {
  /** Re-anchor the brief schedule after the reader changes their display zone (no settings save). */
  rescheduleBriefingForDisplayTimeZone: (timeZone: string) => Promise<void>
  pipeline: ReturnType<typeof createIntelligencePipeline>
  sourcesService: ReturnType<typeof createIntelligenceSourcesService>
  translationService: ReturnType<typeof createIntelligenceTranslationService>
  newsSentiment: {
    store?: ReturnType<typeof createNewsSentimentSqliteStore>
    settingsStore: ReturnType<typeof createNewsSentimentSettingsStore>
    enrichment?: ReturnType<typeof createNewsSentimentEnrichmentService>
    scoring?: ReturnType<typeof createNewsSentimentScoringService>
    query?: ReturnType<typeof createNewsSentimentQuery>
    bodyTranslation?: ReturnType<typeof createNewsSentimentBodyTranslationService>
    settings: {
      get: () => Promise<NewsSentimentSettingsView>
      save: (patch: Partial<NewsSentimentSettings>) => Promise<NewsSentimentSettingsView>
    }
    /**
     * 读者点「重新抓取所有正文」时的存储入口：库正常就清空重抓；库打不开就先隔离现场再建新库。
     * 返回被隔离的副本路径（没有现场时为 undefined），界面据此说清发生了什么。
     */
    rebuildStorage: () => { quarantinedCopy?: string }
  }
  workerRuntime: ManagedWorkerRuntime
  replayService: ReturnType<typeof createIntelligenceReplayService>
  archiveService: ReturnType<typeof createIntelligenceArchiveService>
  publicQueryService: ReturnType<typeof createMarketIntelligencePublicQueryService>
  dailyBriefingService: DailyBriefingService
  deleteDailyBriefingPeriod: DailyBriefingPeriodDeletion
  /**
   * The reader's period store behind the runtime's list — the same instance, so the settings
   * surface's writes go through the one-time move and cannot create a second, marker-less file.
   */
  briefingPeriods: BriefingPeriodsEditor
  /** The deterministic core-fact pass, exposed for logs and focused verification. */
  dailyBriefFactEnsure: ReturnType<typeof createDailyBriefFactEnsure>
  /**
   * 日报的 **AI 编辑与语言设置**：模型 / WebSearch / 编辑开关 + 全局语言偏好，
   * 由 `dailyBriefingSettingsService` 组合 AI 与语言两个服务而来。抽屉日报屏的 `getSettings` /
   * `saveSettings` 是这组设置**唯一的读写口**——删掉它等于让读者少一组设置（要删必须先给它一条
   * 新路径，B：新增专属 IPC 并切调用点；C：C7 换新面）。
   * 字段名 `dailyBriefingAiSettings` 是历史名（早期只装 AI 那半），改名会动四处调用点，本批不动。
   */
  dailyBriefingAiSettings: DailyBriefingSettingsService
  rawRecordStore: ReturnType<typeof createRawRecordStore>
  macroCalendarEvidenceArchive: ReturnType<typeof createMacroCalendarEvidenceArchive>
  macroCalendarEvidenceReady: boolean
  capitalConditions: ReturnType<typeof createCapitalConditionsSourceIntegration>
  requestGovernanceQueue: ReturnType<typeof createSourceRequestGovernanceQueue>
  sourceProfileStore: ReturnType<typeof createSourceProfileStore>
  crossAssetProfiles: Pick<ReturnType<typeof createSourceProfileStore>, 'getProfile' | 'resolveProfile'>
  /**
   * The credential behind a source profile's `credentialRef`, for a collector that lives outside this
   * module. It returns the record the profile points at — never a masked view — so the caller must
   * treat any URL it builds with it as credential material. The real Nasdaq 100 index feed is the one
   * such caller today; it reads the same key the real dollar index reads, and it never logs it.
   */
  sourceCredentials: { getByRef: (credentialRef: string) => Promise<Readonly<{ apiKey?: string }> | null> }
  zeroXRouterCalendarEvidenceAdmission: ReturnType<typeof createZeroXRouterCalendarEvidenceAdmissionService>
  calendarManualDependencies: {
    getApiKey: () => Promise<string | undefined>
    readReadiness: () => Promise<{ enabled: boolean; hasCredential: boolean }>
    requestJsonBody: typeof requestZeroXRouterCalendarJsonBody
  }
  marketAnalysisRuntime: MarketAnalysisRuntime
  /** The credentialed macro-market series (synthetic dollar, gold, offshore yuan, stablecoin peg). */
  macroMarket: MacroMarketRuntime
  /** Whether that source can spend a credit right now: the reader enabled it and a key is stored. */
  macroMarketReadiness: () => Promise<{ enabled: boolean; hasCredential: boolean }>
  /**
   * The reader's switches and the last collection's verdict for every source the dashboard's macro and
   * cross-asset rows actually read. Read-only, and the credential leaves as a boolean.
   */
  dashboardFeedStatus: Pick<DashboardFeedStatusQuery, 'status'>
  setPolicyPathQuery: (query: PolicyPathQueryService) => void
  bindBriefingCalendarRefresh: (refresh: BriefingCalendarRefresh) => void
  /** The gold price stream. Reads only: it never appends to the macro-market series store. */
  macroMarketLive: GoldLiveRuntime
}

let intelligenceModule: IntelligenceModule | null = null
let modulePlatformHooks: IntelligenceModulePlatformHooks | undefined

function shellTimeZone(): string {
  return resolveBriefingTimeZone(modulePlatformHooks)
}

/** 供产品内其它装配点读取「读者时区」（同一提供者，不另起来源）。 */
export function currentReaderTimeZone(): string {
  return shellTimeZone()
}

function getProductDataDir(): string {
  return join(app.getPath('userData'), 'products', PRODUCT_ID)
}

export function getIntelligenceModule(
  jobRuntime: JobRuntime,
  platformHooks?: IntelligenceModulePlatformHooks
): IntelligenceModule {
  // The module is a singleton and captures its dependencies when it is built. A second set of hooks
  // therefore has no effect on what was already wired — for months that looked like a
  // reconfiguration and silently did nothing. Repeat calls may omit hooks or repeat the same
  // platform fetch; anything else is a wiring bug and fails here instead of turning into an
  // occasional crash at startup. The message names the field; without it the reader must diff
  // eighteen hooks by hand.
  if (intelligenceModule) {
    const rebound = firstReboundSingletonHook(platformHooks, modulePlatformHooks)
    if (rebound) throw new Error(`intelligence-module-hooks-already-bound: ${rebound}`)
    return intelligenceModule
  }
  if (!platformHooks) throw new Error('intelligence-module-hooks-required')
  modulePlatformHooks = platformHooks

  {
    const hooks = modulePlatformHooks
    const dataDir = getProductDataDir()
    const getAppLanguage = hooks?.getAppLanguage ?? (async () => 'zh-CN' as const)
    const profileStore = createSourceProfileStore(
      createProfileJsonStorage(join(dataDir, 'intelligence-source-profiles.json'))
    )
    const rawRecordStorage = createRawRecordJsonStorage(join(dataDir, 'intelligence-raw-records.json'))
    const rawRecordStore = createRawRecordStore({
      storage: rawRecordStorage,
      snapshot: readRawRecordSnapshotSync(join(dataDir, 'intelligence-raw-records.json'))
    })
    const macroCalendarEvidenceArchive = createMacroCalendarEvidenceArchive({
      rawRecords: rawRecordStore,
      archiveDirectory: join(dataDir, 'macro-calendar-evidence')
    })
    const macroCalendarEvidenceMigration = macroCalendarEvidenceArchive.migrateInlineBodies()
    const pipelineStateStorage = createIntelligencePipelineJsonStorage(
      join(dataDir, 'intelligence-pipeline-state.json')
    )
    const runtimeStateStorage = createIntelligenceRuntimeStateJsonStorage(
      join(dataDir, 'intelligence-runtime-state.json')
    )
    const runtimeStateHistoryStorage = createIntelligenceRuntimeStateHistoryJsonStorage(
      join(dataDir, 'intelligence-runtime-state-history.json')
    )
    const translationStorage = createIntelligenceTranslationJsonStorage({
      settingsPath: join(dataDir, 'intelligence-translation-settings.json'),
      recordsPath: join(dataDir, 'intelligence-translation-records.json'),
      appLanguage: getAppLanguage
    })
    const credentialStore = createIntelligenceCredentialStore(
      createIntelligenceCredentialJsonStorage(join(dataDir, 'intelligence-credentials.json'))
    )
    const fetchText = createIntelligenceFetchText({ profileStore, credentialStore })
    const fetchMetricTarget = (target: Parameters<typeof executeIntelligenceFetchTarget>[0], sourceId: string) =>
      executeIntelligenceFetchTarget(target, sourceId, { profileStore, credentialStore })
    const eventPublisher = hooks?.eventBusRuntime
      ? createIntelligenceEventPublisher(hooks.eventBusRuntime)
      : undefined
    const sourceIssues = createSourceIssueWiring({ defaultFreshnessMs: DEFAULT_SOURCE_FRESHNESS_MS, timeZone: shellTimeZone,
      ...(hooks?.submitNotification === undefined ? {} : { submit: hooks.submitNotification }),
      ...(hooks?.log === undefined ? {} : { log: hooks.log }) })
    const pipeline = createIntelligencePipeline({
      profileStore,
      rawRecordStore,
      fetchText,
      fetchMetricTarget,
      snapshot: readIntelligencePipelineSnapshotSync(join(dataDir, 'intelligence-pipeline-state.json')),
      stateStorage: pipelineStateStorage,
      runtimeStateSnapshot: readIntelligenceRuntimeStateSync(join(dataDir, 'intelligence-runtime-state.json')),
      runtimeStateStorage,
      runtimeStateHistorySnapshot: readIntelligenceRuntimeStateHistorySync(
        join(dataDir, 'intelligence-runtime-state-history.json')
      ),
      runtimeStateHistoryStorage,
      eventPublisher,
      ...(sourceIssues.notifier === undefined ? {} : { sourceIssueNotifier: sourceIssues.notifier })
    })
    sourceIssues.bindRuntimeStates(() => pipeline.listRuntimeStates())
    const capitalConditionsStore = createCapitalConditionsCurrentStateStore({
      storage: createCapitalConditionsStateJsonStorage(join(dataDir, 'capital-conditions-state.json'))
    })
    const etfCurrentStateStore = createEtfCurrentStateStore({
      storage: createEtfCurrentStateSqliteStorage(join(dataDir, 'etf-current-state.sqlite'))
    })
    const requestGovernanceQueue = createSourceRequestGovernanceQueue({ now: () => Date.now() })
    const fundingRateHistoryStore = createFundingRateHistorySqliteStore(join(dataDir, 'funding-rate-history.sqlite'))
    const fundingRateHistoryClient = createBinanceFundingRateHistoryClient({ platformFetch: hooks.platformFetch as typeof fetch })
    const fundingRateHistoryRefresh = createFundingRateHistoryRefreshService({
      isEnabled: async () => (await profileStore.resolveProfile('binance-futures-positioning')).enabled,
      requestHistory: fundingRateHistoryClient.requestHistory,
      store: fundingRateHistoryStore,
      now: () => new Date().toISOString()
    })
    // The positioning series is the second half of the same source: a funding rate without the
    // open interest behind it cannot tell deleveraging from crowding.
    const perpetualPositioningStore = createPerpetualPositioningSqliteStore(join(dataDir, 'perpetual-positioning.sqlite'))
    const openInterestClient = createBinanceOpenInterestClient({ platformFetch: hooks.platformFetch as typeof fetch })
    const openInterestRefresh = createOpenInterestRefreshService({
      isEnabled: async () => (await profileStore.resolveProfile('binance-futures-positioning')).enabled,
      client: openInterestClient,
      store: perpetualPositioningStore,
      now: () => new Date().toISOString()
    })
    const openInterestWithSignals = createSignalledOpenInterestRefresh({ refresh: openInterestRefresh.refresh,
      readHistory: input => queryOpenInterestHistoryAsync({ ...input, store: perpetualPositioningStore }),
      ...(hooks?.submitNotification === undefined ? {} : { submit: hooks.submitNotification }) })
    const etfFlowHistoryClient = createZeroXRouterEtfFlowHistoryClient({ requestGovernanceQueue })
    // The macro-market series (dollar, gold, offshore yuan, stablecoin peg) come from a credentialed
    // REST provider, read through the same profile/credential pair every other source uses. The real
    // licensed dollar index is collected by the same runtime into the same store, so the log line
    // takes the failing source id from the collector rather than naming one of the two sources.
    const macroMarket = createMacroMarketRuntime({
      jobRuntime,
      resolveProfile: sourceId => profileStore.resolveProfile(sourceId),
      getCredential: credentialRef => credentialStore.getByRef(credentialRef as never),
      dataDirectory: getIntelligenceProductDataDir(),
      onError: (error, sourceId) => { console.log(JSON.stringify({ marker: 'MI_MACRO_MARKET_ERROR', sourceId, message: String(error).slice(0, 200) })) }
    })
    // The gold stream shares that source's switch and credential but never its store: it is built only
    // when the desktop shell could hand over the platform socket, so a headless run has no stream.
    const macroMarketLive = createMacroMarketLive({
      source: {
        resolveProfile: sourceId => profileStore.resolveProfile(sourceId),
        getCredential: credentialRef => credentialStore.getByRef(credentialRef as never)
      },
      ...(hooks.createPlatformWebSocket ? { createWebSocket: hooks.createPlatformWebSocket } : {}),
      onError: error => { console.log(JSON.stringify({ marker: 'MI_MACRO_MARKET_LIVE_ERROR', sourceId: macroMarketPolicy.sourceId, message: String(error).slice(0, 200) })) }
    })
    const zeroXRouterCredential = async () => {
      const profile = await profileStore.resolveProfile(zeroXRouterSourcePolicy.sourceId)
      return profile.credentialRef ? credentialStore.getByRef(profile.credentialRef) : null
    }
    // One reader for the strip's macro and cross-asset feed lines: the same profile store and
    // credential store the collectors read, the macro store's own outcome notes, and the pipeline's
    // health for the generic FRED collector. The key itself never leaves the credential store.
    const dashboardFeedStatus = createDashboardFeedStatusQuery({
      resolveProfile: sourceId => profileStore.resolveProfile(sourceId),
      hasCredential: async credentialRef => (await credentialStore.getSafeView(credentialRef as never)).hasCredential === true,
      readNote: key => macroMarket.store.readNote(key),
      readHealth: sourceId => pipeline.getHealth(sourceId)
    })
    const zeroXRouterCalendarEvidenceAdmission = createZeroXRouterCalendarEvidenceAdmissionService({
      requestGovernanceQueue,
      getApiKey: async () => (await zeroXRouterCredential())?.apiKey,
      evidence: createMacroCalendarEvidenceStore(macroCalendarEvidenceArchive)
    })
    const etfCurrentStateRefresh = createEtfCurrentStateRefreshService({
      isEnabled: async () => (await profileStore.resolveProfile(zeroXRouterSourcePolicy.sourceId)).enabled,
      hasCredential: async () => Boolean((await zeroXRouterCredential())?.apiKey),
      requestWindow: async () => {
        const credential = await zeroXRouterCredential()
        return credential?.apiKey ? etfFlowHistoryClient.requestWindow(credential.apiKey) : Object.freeze({ state: 'unavailable' as const })
      },
      store: etfCurrentStateStore,
      now: () => new Date().toISOString(),
      // 交接点只交读数；开关、去重参数与事件 id 都在通知层（见 `etfOutflowSignalHandoff`）。
      ...etfOutflowSignalHandoff(hooks?.submitNotification)
    })
    const capitalConditionsRefresh = createCapitalConditionsRefreshService({
      isEnabled: async () => (await profileStore.resolveProfile('defillama-stablecoins')).enabled,
      http: createCapitalConditionsHttpClient({ platformFetch: hooks.platformFetch }),
      store: capitalConditionsStore,
      now: () => new Date().toISOString()
    })
    // The historical reader shares the platform fetch and the source switch with the live refresh,
    // but reads each core asset's own endpoint; the aggregate `stablecoincharts/all` series is never
    // used to answer the core metric. The client streams and caps each per-asset response (~22-24 MB).
    const capitalConditionsAssetHistoryHttp = createCapitalConditionsHttpClient({
      platformFetch: hooks.platformFetch
    })
    const capitalConditions = createCapitalConditionsSourceIntegration({
      refreshService: capitalConditionsRefresh,
      readHealth: async () => {
        const health = await capitalConditionsStore.readHealth()
        return Object.freeze({
          status: health.status,
          ...(health.lastSuccessAt ? { lastSuccessAt: health.lastSuccessAt } : {}),
          consecutiveFailures: health.consecutiveFailures
        })
      }
    })
    const capitalConditionsQuery = createCapitalConditionsSnapshotQueryService({
      store: capitalConditionsStore,
      etfStore: etfCurrentStateStore,
      isEnabled: async () => (await profileStore.resolveProfile('defillama-stablecoins')).enabled
    })
    const workerRuntime = createManagedWorkerRuntime()
    const structuredModelInvocation = createStructuredModelInvocationService({
      getProviderState:
        hooks?.getProviderState ??
        (async () => {
          throw new Error('Model service is unavailable.')
        }),
      fetch: hooks.platformFetch as unknown as typeof fetch
    })
    let newsSentimentStore: ReturnType<typeof createNewsSentimentSqliteStore> | undefined
    const translationService = createIntelligenceTranslationService({
      storage: translationStorage,
      pipeline,
      jobRuntime,
      structuredModelInvocation,
      getAppLanguage,
      getProviderState: hooks?.getProviderState,
      getModelDefaults: hooks?.getModelDefaults
    })
    const newsSentimentSettingsStore = createNewsSentimentSettingsStore(
      createNewsSentimentSettingsJsonStorage(join(dataDir, 'intelligence-news-sentiment-settings.json'))
    )
    const newsSentimentFilePath = join(dataDir, newsSentimentStoragePolicy.fileName)
    try {
      newsSentimentStore = createNewsSentimentSqliteStore(newsSentimentFilePath)
    } catch {
      // A broken database must not take the rest of the product down; news sentiment stays unavailable.
      newsSentimentStore = undefined
    }
    const assembleNewsSentiment = (store: ReturnType<typeof createNewsSentimentSqliteStore>) =>
      createNewsSentimentServices(store, {
        pipeline,
        settingsStore: newsSentimentSettingsStore,
        translationService,
        translationSettingsStorage: translationStorage,
        invoke: structuredModelInvocation.invoke,
        getAppLanguage,
        profileStore,
        hooks,
        dataDir
      })
    const newsSentimentPieces = newsSentimentStore ? assembleNewsSentiment(newsSentimentStore) : undefined
    const newsSentimentEnrichment = newsSentimentPieces?.enrichment
    const newsSentimentScoring = newsSentimentPieces?.scoring
    const newsSentimentBodyTranslation = newsSentimentPieces?.bodyTranslation
    const newsSentimentQuery = newsSentimentPieces?.query
    const readNewsSentimentSettings = async (): Promise<NewsSentimentSettingsView> => {
      const settings = await newsSentimentSettingsStore.getSettings()
      const [providerState, modelDefaults] = await Promise.all([
        hooks?.getProviderState?.().catch(() => undefined) ?? Promise.resolve(undefined),
        hooks?.getModelDefaults?.().catch(() => undefined) ?? Promise.resolve(undefined)
      ])
      const resolution = resolveNewsSentimentModel({
        settings,
        modelDefaults: modelDefaults ?? null,
        providers: providerState?.providers ?? []
      })
      const fastResolution = modelDefaults?.fastModelId
        ? resolveConfiguredModel({
            value: modelDefaults.fastModelId,
            providers: providerState?.providers ?? [],
            isModelAcceptable: (_provider, model) => model.capabilities.chat === true
          })
        : undefined
      return {
        settings,
        resolution,
        ...(fastResolution?.ok
          ? { defaultFastModel: { providerId: fastResolution.ref.providerId, modelId: fastResolution.ref.modelId, name: `${fastResolution.providerName} · ${fastResolution.modelName}` } }
          : {})
      }
    }
    const newsSentimentSettings = {
      get: readNewsSentimentSettings,
      save: async (patch: Partial<NewsSentimentSettings>) => {
        await newsSentimentSettingsStore.save(patch)
        return readNewsSentimentSettings()
      }
    }
    // 一份可更新的出口：读者重建把库换成新的以后，IPC / Agent 读到的是同一份新服务。
    const newsSentimentExposure: IntelligenceModule['newsSentiment'] = {
      settingsStore: newsSentimentSettingsStore,
      ...(newsSentimentStore ? { store: newsSentimentStore } : {}),
      ...(newsSentimentEnrichment ? { enrichment: newsSentimentEnrichment } : {}),
      ...(newsSentimentScoring ? { scoring: newsSentimentScoring } : {}),
      ...(newsSentimentQuery ? { query: newsSentimentQuery } : {}),
      ...(newsSentimentBodyTranslation ? { bodyTranslation: newsSentimentBodyTranslation } : {}),
      settings: newsSentimentSettings,
      rebuildStorage: () => {
        throw new Error('news-sentiment-storage-unavailable')
      }
    }
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
          productId: PRODUCT_ID,
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
    registerIntelligenceDataChangedEvents(PRODUCT_ID)
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
      timeZone: shellTimeZone,
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
    // The dashboard's first screen (sentiment, fear & greed, stablecoin capital) is fed by sources
    // that need no credential; a fresh install should not require toggling them on before the cards
    // can do anything. An existing profile wins, so a reader's "off" is never overridden.
    // 一次性迁移：老安装里「免钥匙 + live」的源曾被旧默认写成关，这里打开一次（标记写在
    // `intelligence-source-migration-markers.json`，之后读者再关就是关）。
    const migrationMarkers = join(dataDir, 'intelligence-source-migration-markers.json')
    const ensureDefaultSources = migrateKeylessSourceDefaults({ markerPath: migrationMarkers, store: profileStore })
      // 第二条：没人用的免钥匙源关回去（第一条先把它们打开了，顺序不能反）。
      .then(() => disableUnusedKeylessSources({ markerPath: migrationMarkers, store: profileStore }))
      .catch(() => undefined)
    // 历史日报编辑会话的身份归位：只改身份字段（消息与内容不动），幂等，失败不阻断启动但要留痕。
    const earlierBriefingSessionMigration = ensureDefaultSources
      .then(() => claimExistingBriefingSessions({
        links: dailyBriefSessionLinks,
        agentId: 'daily-brief-editor',
        ...(hooks.findAgentSessionByAutomationRef ? { findAgentSessionByAutomationRef: hooks.findAgentSessionByAutomationRef } : {}),
        ...(hooks.updateAgentSession ? { updateAgentSession: hooks.updateAgentSession } : {})
      }))
      .then((result) => {
        if (result.updated > 0) hooks.log?.('info', 'daily-brief-session-migration', { updated: result.updated, skipped: result.skipped })
      })
      .catch((error: unknown) => {
        hooks.log?.('warn', 'daily-brief-session-migration-failed', { message: error instanceof Error ? error.message : String(error) })
      })
    const startupReady = earlierBriefingSessionMigration
      .then(() => intelligenceRawRecordStartupRecoveryPolicy.completeBeforeSourceRuntime(jobRuntime))
      .finally(() => sourcesService.initializeRuntime().catch(() => undefined))
      .finally(() => marketAnalysisRuntime.startRecovery().catch(() => undefined))
      .then(() => undefined, () => undefined)
    void startupReady
    // Best-effort seed: `readSettings` already falls back to defaults when the file is absent, so
    // a failed write during shutdown must not surface as an unhandled rejection.
    void (async () => {
      const settingsPath = join(dataDir, 'intelligence-translation-settings.json')
      try {
        await readFile(settingsPath, 'utf8')
      } catch {
        await translationStorage.writeSettings(createDefaultTranslationSettings(await getAppLanguage()))
      }
    })().catch(() => undefined)
    // The daily brief settings own the editor agent's model: saving and a generation-time
    // re-resolution both write the same choice through this one update.
    const applyDailyBriefAgentModel = async (model: string): Promise<void> => {
      await hooks?.updateAgent?.('daily-brief-editor', { model })
    }
    const dailyBriefingAiSettings = createDailyBriefingAiSettingsService({
      store: createDailyBriefingAiSettingsStore(
        createDailyBriefingAiSettingsJsonStorage(join(dataDir, 'daily-briefing-settings.json')),
        () => new Date().toISOString()
      ),
      ...(hooks?.getModelDefaults ? { getModelDefaults: hooks.getModelDefaults } : {}),
      ...(hooks?.getProviderState ? { getProviderState: hooks.getProviderState } : {}),
      onModelSaved: async (settings) => {
        if (!hooks?.updateAgent) return
        const model = settings.providerId && settings.modelId ? `${settings.providerId}:${settings.modelId}` : 'unconfigured:default-chat-model'
        await applyDailyBriefAgentModel(model)
      },
      applyAgentModel: applyDailyBriefAgentModel
    })
    // Periods are the runtime's schedule (§11.6b): the old settings file is still read by the
    // settings surface, but it no longer decides when an edition runs.
    const dailyBriefSessionLinks = createDailyBriefSessionLinkStore(join(dataDir, 'daily-brief-sessions.sqlite'))
    // Periods are the runtime's schedule (§11.6b): the old settings file is still read by the
    // settings surface, but it no longer decides when an edition runs.
    const briefingPeriodsSource = createBriefingPeriodsSource({
      filePath: join(dataDir, 'daily-briefing-periods.json'),
      locale: getAppLanguage,
      // The one-time move of the old settings' periods into this file. Lazy closures on purpose:
      // the two services are assembled further down, and the move runs on the first read, which is
      // the job registration below — after both exist.
      // The one-time move reads the old file through its pure reader — never through a service
      // that could write it — so the file stays exactly as the previous version left it.
      legacyPeriodsMigration: {
        readLegacyPeriods: async () => {
          const raw = await createJsonFileStorage<unknown>(join(dataDir, 'daily-briefing-generation-settings.json'), undefined).read()
          return readDailyBriefingPeriodsSettings(raw, new Date().toISOString()).periods
        },
        additionalLanguages: async () => (await dailyBriefingLanguageSettings.getSettings()).additional,
        ...(hooks?.log ? { log: hooks.log } : {})
      },
      // Asked only when a stored period predates "language belongs to a period": one read of the
      // links before today, then periodId → the languages its editions were actually written in.
      editionLocales: async () => {
        const links = await dailyBriefSessionLinks.listBefore(new Date(Date.now() + 86_400_000).toISOString().slice(0, 10))
        const byPeriod = new Map<string, Set<DailyBriefingLocale>>()
        for (const link of links) {
          const languages = byPeriod.get(link.periodId) ?? new Set<DailyBriefingLocale>()
          languages.add(link.locale)
          byPeriod.set(link.periodId, languages)
        }
        return byPeriod
      }
    })
    const dailyBriefingLanguageSettings = createEditionLanguageSettingsService({
      storage: createEditionLanguageSettingsJsonStorage(join(dataDir, 'daily-briefing-language-settings.json')), uiLanguage: getAppLanguage })
    const dailyBriefingSettings = createDailyBriefingSettingsService({
      ai: dailyBriefingAiSettings,
      language: dailyBriefingLanguageSettings
    })
    const dailyBriefSessionPort = hooks?.createAgentSession && hooks.sendAgentMessage && hooks.appendAgentSessionMessages && hooks.updateAgentSession && hooks.deleteAgentSessions
      ? createDailyBriefEditorSessionPort({
        links: dailyBriefSessionLinks,
        createSession: hooks.createAgentSession,
        ...(hooks.findAgentSessionByAutomationRef ? { findAgentSessionByAutomationRef: hooks.findAgentSessionByAutomationRef } : {}),
        send: hooks.sendAgentMessage,
        cancelAgentSession: hooks.cancelAgentSession,
      })
      : undefined
    const dailyBriefAgentRunner = dailyBriefSessionPort ? createDailyBriefAgentRunner({ port: dailyBriefSessionPort, agentId: 'daily-brief-editor' }) : undefined
    const dailyBriefingStore = createDailyBriefingSqliteStore(join(dataDir, 'daily-briefings.sqlite'))
    const isSourceEnabled = async (sourceId: string): Promise<boolean | undefined> => {
      try {
        return (await profileStore.resolveProfile(sourceId)).enabled
      } catch {
        return undefined
      }
    }
    // The ETF and core-stablecoin readers are memoised per cutoff, not per process: the same cutoff
    // owns one downloaded series (startup ensure, generation ensure and the Agent backfill share
    // it), while a new cutoff must read again because a daily source's newest row is not final
    // until its day ends. The persistent ensure cache still prevents a later launch from asking for
    // the same editionDate|metric|asOf at all.
    const backfillReaders = new Map<string, Readonly<{
      etfHistory: ReturnType<typeof createEtfHistoryAsOf>
      stablecoinHistory: ReturnType<typeof createStablecoinHistoryAsOf>
    }>>()
    const backfillReadersFor = (cutoff: string) => {
      const existing = backfillReaders.get(cutoff)
      if (existing) return existing
      const created = Object.freeze({
        etfHistory: createEtfHistoryAsOf({
          requestWindow: async () => {
            // The same two gates the refresh applies: a switched-off source is not read around, and
            // a missing key is a missing interface rather than a failed request.
            const profile = await profileStore.resolveProfile(zeroXRouterSourcePolicy.sourceId)
            if (!profile.enabled) return Object.freeze({ state: 'not-configured' as const })
            const credential = await zeroXRouterCredential()
            if (!credential?.apiKey) return Object.freeze({ state: 'not-configured' as const })
            return etfFlowHistoryClient.requestWindow(credential.apiKey)
          }
        }),
        stablecoinHistory: createStablecoinHistoryAsOf({
          requestAssetHistory: async (assetId) => {
            // A switched-off stablecoin source is a missing interface, not a reason to bypass it.
            const profile = await profileStore.resolveProfile(DAILY_BRIEFING_SOURCE_IDS.stablecoin)
            if (!profile.enabled) return Object.freeze({ state: 'not-configured' as const })
            return capitalConditionsAssetHistoryHttp.requestStablecoinAssetHistoryPayload(assetId)
          }
        })
      })
      if (backfillReaders.size >= 2) {
        const oldest = backfillReaders.keys().next().value
        if (oldest) backfillReaders.delete(oldest)
      }
      backfillReaders.set(cutoff, created)
      return created
    }
    const backfillFactory = (cutoff: string) => {
      const readers = backfillReadersFor(cutoff)
      return createDailyBriefBackfillExecutor({
        cutoff,
        publicQuery: publicQueryService,
        // The outer gate is what keeps a cached series from outliving a reader's "off": the reader
        // cache answers by asset, so a switch flipped after a successful read would otherwise still
        // be bypassed.
        etfHistory: async (request) => (await isSourceEnabled(zeroXRouterSourcePolicy.sourceId)) === true
          ? readers.etfHistory.read(request)
          : Object.freeze({
            state: 'unavailable' as const,
            asset: request.asset,
            asOf: request.asOf,
            gapCode: 'historical-api-unavailable' as const,
            detail: 'the ETF source is switched off; the gap stays.'
          }),
        stablecoinHistory: async (request) => (await isSourceEnabled(DAILY_BRIEFING_SOURCE_IDS.stablecoin)) === true
          ? readers.stablecoinHistory.read(request)
          : Object.freeze({
            state: 'unavailable' as const,
            asOf: request.asOf,
            gapCode: 'historical-api-unavailable' as const,
            detail: 'the stablecoin source is switched off; the gap stays.'
          }),
        now: () => new Date().toISOString()
      })
    }
    const dailyBriefFactEnsure = createDailyBriefFactEnsure({
      backfillFor: backfillFactory,
      cache: createDailyBriefFactEnsureJsonCache(join(dataDir, 'daily-brief-fact-ensure.json')),
      isSourceEnabled,
      now: () => new Date().toISOString(),
    })
    const briefingCalendar = createBriefingCalendarCommands()
    const dailyBriefingService = createDailyBriefingService({
      source: createDailyBriefingSource({
        repository: marketAnalysisRuntime.repository,
        publicQuery: publicQueryService,
        policyPathQuery: { read: (input) => briefingPolicyPathQuery?.read(input) },
        // 只读取历史版次：早报把窗口内更早的简报结论与分析结论一起综合，不复制其中任何一份。
        briefEditions: dailyBriefingStore,
        news: {
          query: (input) => newsSentimentExposure.query
            ? newsSentimentExposure.query.query(input)
            : unavailableNewsQuery.query(input)
        },
        profiles: profileStore,
        // 来源静默/连续失败（`02` v2.167）：读采集运行状态，写进冻结的日报文档。
        sourceStates: () => pipeline.listRuntimeStates(),
        calendarCommands: briefingCalendar.commands,
        macroWebRead: macroWebReadFromHooks(hooks, () => dailyBriefingAiSettings.getView()),
      }),
      store: dailyBriefingStore,
      ...briefingNotificationPorts(hooks),
      ...(dailyBriefAgentRunner ? { agentRunner: dailyBriefAgentRunner } : {}),
      agentModel: () => dailyBriefingAiSettings.ensureAgentModel(),
      editorialEnabled: async () => (await dailyBriefingAiSettings.getView()).settings.editorialEnabled,
      readiness: createDailyBriefReadinessFor(publicQueryService, hooks?.log ? { log: hooks.log } : {}),
      marketBackfill: currentBriefMarketBackfill,
      generationSettings: async () => (await briefingPeriodsSource.getPeriods())[0]!, readPeriods: () => briefingPeriodsSource.getPeriods(),
      backfillFactory,
      coreFactEnsure: async ({ document, cutoff }) =>
        (await dailyBriefFactEnsure.ensure({ document, cutoff, trigger: 'generation' })).document,
      agentAllowedTools: () => resolveBriefingRunAllowedTools({
        getView: () => dailyBriefingAiSettings.getView(),
        ...(hooks?.isWebSearchProviderReady ? { isWebSearchProviderReady: hooks.isWebSearchProviderReady } : {})
      }),
      // E9「打开会话」：会话 id 只走这一条查找（身份是期 × 语言），列表只消费它的返回值。
      sessionIdOf: (input) => findLatestBriefingSessionId({
        ...(hooks?.findAgentSessionByAutomationRef ? { findAgentSessionByAutomationRef: hooks.findAgentSessionByAutomationRef } : {}),
        ...(hooks?.log ? { log: hooks.log } : {})
      }, { agentId: 'daily-brief-editor', editionDate: input.date, periodId: input.periodId, locale: input.locale })
    })
    // The deterministic pass runs once per module start, after the default sources exist and the
    // source runtime is up: a fresh install would otherwise look as if every source were switched
    // off. It is fire-and-forget so the renderer is never held; the latest stored edition is the
    // only document it may amend.
    void startupReady
      .then(() => ensureDailyBriefFactsAtStartup({
        store: dailyBriefingStore,
        ensure: dailyBriefFactEnsure.ensure,
        locale: getAppLanguage,
        now: () => new Date().toISOString(),
        }))
      .catch(() => undefined)
    const markAttemptCleaned = dailyBriefingStore.markAttemptCleaned?.bind(dailyBriefingStore)
    const rescheduleBriefingForDisplayTimeZone = wireDailyBriefingJobs({
      jobRuntime,
      service: dailyBriefingService,
      getLocale: getAppLanguage,
      timeZone: shellTimeZone,
      periods: briefingPeriodsSource,
      links: dailyBriefSessionLinks,
      ...(markAttemptCleaned ? { markAttemptCleaned: (input) => markAttemptCleaned(input) } : {}), ...(hooks?.log === undefined ? {} : { log: hooks.log }),
      ...(hooks?.deleteAgentSessions ? { deleteAgentSessions: hooks.deleteAgentSessions } : {}),
      ...(hooks?.submitNotification ? { submitNotification: hooks.submitNotification } : {})
    })
    modulePlatformHooks?.onSettingsCommitted?.((change) => { if (change.changedKeys.includes('timeZone')) void rescheduleBriefingForDisplayTimeZone(change.next.timeZone) })
    intelligenceModule = {
      rescheduleBriefingForDisplayTimeZone,
      pipeline,
      workerRuntime,
      archiveService,
      replayService,
      translationService,
      newsSentiment: newsSentimentExposure,
      sourcesService,
      publicQueryService,
      dailyBriefingService, briefingPeriods: briefingPeriodsSource.editor, deleteDailyBriefingPeriod: createDailyBriefingPeriodDeletion({ store: dailyBriefingStore, links: dailyBriefSessionLinks,
        ...(hooks?.deleteAgentSessions ? { deleteAgentSessions: hooks.deleteAgentSessions } : {}) }),
      dailyBriefFactEnsure,
      dailyBriefingAiSettings: dailyBriefingSettings,
      rawRecordStore,
      macroCalendarEvidenceArchive,
      macroCalendarEvidenceReady: macroCalendarEvidenceMigration.state !== 'unavailable',
      capitalConditions,
      requestGovernanceQueue,
      zeroXRouterCalendarEvidenceAdmission,
      sourceProfileStore: profileStore,
      crossAssetProfiles: { getProfile: sourceId => profileStore.getProfile(sourceId), resolveProfile: sourceId => profileStore.resolveProfile(sourceId) },
      sourceCredentials: { getByRef: credentialRef => credentialStore.getByRef(credentialRef as never) },
      calendarManualDependencies: {
        getApiKey: async () => (await zeroXRouterCredential())?.apiKey,
        readReadiness: async () => ({ enabled: (await profileStore.resolveProfile(zeroXRouterSourcePolicy.sourceId)).enabled,
          hasCredential: Boolean((await zeroXRouterCredential())?.apiKey) }),
        requestJsonBody: requestZeroXRouterCalendarJsonBody
      },
      marketAnalysisRuntime,
      macroMarket,
      // One reader for the source's own switch and credential, built from the same profile and
      // credential stores the collector reads, so the dashboard cannot disagree with the collector.
      macroMarketReadiness: async () => {
        const profile = await profileStore.resolveProfile(macroMarketPolicy.sourceId)
        const credential = profile.credentialRef ? await credentialStore.getByRef(profile.credentialRef as never) : null
        return { enabled: profile.enabled === true, hasCredential: Boolean(credential?.apiKey) }
      },
      macroMarketLive,
      dashboardFeedStatus,
      setPolicyPathQuery: (query: PolicyPathQueryService) => {
        briefingPolicyPathQuery = query
        // The analysis reads through the public query service, not the briefing's direct handle.
        // The wrapper owns the one thing the direct handle cannot know: whether the reader has the
        // source switched on. A disabled source answers `disabled`, so the analysis neither leaks
        // stale odds nor reports a gap the reader chose to hide.
        publicQueryService.setPolicyPathQuery({
          read: async ({ asOf }) => {
            try {
              const profile = await profileStore.resolveProfile('policy-path-market')
              if (!profile.enabled) return { state: 'disabled' as const }
              const reading = query.read({ asOf })
              return reading ? { state: 'available' as const, reading } : { state: 'unavailable' as const }
            } catch {
              return { state: 'unavailable' as const }
            }
          }
        })
      },
      bindBriefingCalendarRefresh: briefingCalendar.bind
    }
  }
  return intelligenceModule
}

export function resetIntelligenceModuleForTests(): void {
  intelligenceModule?.requestGovernanceQueue.close()
  intelligenceModule?.marketAnalysisRuntime.dispose()
  intelligenceModule = null
  modulePlatformHooks = undefined
}

export function getIntelligenceProductDataDir(): string {
  return getProductDataDir()
}

export { PRODUCT_ID as INTELLIGENCE_PRODUCT_ID, INTELLIGENCE_REPLAY_WINDOW_JOB }
