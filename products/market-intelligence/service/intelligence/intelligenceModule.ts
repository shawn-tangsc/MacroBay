import { join } from 'node:path'
import { readFile } from 'node:fs/promises'

import type { JobRuntime, ManagedWorkerRuntime } from '@platform/jobs'
import { createManagedWorkerRuntime } from '@platform/jobs'
import type { NotificationSubmitOutcome, NotificationSubmitRequest } from '@platform/notifications/contracts/notificationSubmitContracts'
import type { DailyBriefingLocale } from '../../contracts/dailyBriefing'
import { createStructuredModelInvocationService } from '@platform/ai/invocation/structuredModelInvocation'
import { firstReboundSingletonHook } from './intelligenceModuleHooks'
import { app } from 'electron'

import { createIntelligenceArchiveService } from './application/intelligenceArchiveService'
import { createIntelligencePipeline } from './application/intelligencePipeline'
import { createIntelligenceReplayService } from './application/intelligenceReplayService'
import { createIntelligenceSourcesService } from './application/intelligenceSourcesService'
import { createMarketIntelligencePublicQueryService } from './public-query/publicQueryService'
import { createIntelligenceTranslationService } from './application/intelligenceTranslationService'
import { createDefaultTranslationSettings } from './application/intelligenceTranslationHelpers'
import { createRawRecordStore } from './application/rawRecordStore'
import { createSourceProfileStore } from './application/sourceProfileStore'
import { createNewsSentimentSettingsStore } from './news-sentiment/newsSentimentSettingsStore'
import { createNewsSentimentSqliteStore } from './news-sentiment/newsSentimentStore'
import { createNewsSentimentEnrichmentService } from './news-sentiment/newsSentimentEnrichmentService'
import { createNewsSentimentScoringService, newsPushLedgerPolicy } from './news-sentiment/newsSentimentScoringService'
import { createNewsSentimentQuery } from './news-sentiment/newsSentimentQuery'
import { createNewsSentimentBodyTranslationService } from './news-sentiment/newsSentimentBodyTranslation'
import { createDailyBriefingSqliteStore } from './daily-briefing/dailyBriefingStore'
import { createDailyBriefingSource } from './daily-briefing/dailyBriefingSource'
import { unavailableNewsQuery } from './daily-briefing/dailyBriefingNewsFallback'
import { createDailyBriefingService, createDailyBriefReadinessFor, type DailyBriefingService } from './daily-briefing/dailyBriefingService'
import { macroWebReadFromHooks } from './webSearchProductHooks'
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
import { createDailyBriefEditorSessionPort, findLatestBriefingSessionId } from './daily-briefing/dailyBriefEditorSessionPort'
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
import type { NewsSentimentSettings, NewsSentimentSettingsView } from './schema/newsSentiment'
import { etfOutflowSignalHandoff } from './signals/etfOutflowSignalHandoff'
import { intelligenceHttpRequest } from './adapters/intelligenceHttpClient'
import { INTELLIGENCE_REPLAY_WINDOW_JOB } from './jobs/intelligenceJobIds'
import { enqueueIntelligencePipelineJobs } from './jobs/enqueueIntelligencePipelineJobs'
import { registerMarketAnalysisRuntime, type MarketAnalysisRuntime } from './jobs/registerMarketAnalysisRuntime'
import { createMacroCalendarEvidenceArchive } from './macro-calendar/macroCalendarEvidenceArchive'
import { createCapitalConditionsSourceIntegration } from './capital-conditions/capitalConditionsSourceIntegration'
import { createSourceRequestGovernanceQueue } from './application/sourceRequestGovernance'
import { cryptoEtfSourcePolicy } from './application/cryptoEtfSourcePolicy'
import { resolveFactSource } from '../../contracts/factSources'
import { zeroXRouterSourcePolicy } from './application/zeroXRouterSourcePolicy'
import { createZeroXRouterCalendarEvidenceAdmissionService } from './macro-calendar/0xrouter-calendar/zeroXRouterCalendarEvidenceAdmissionService'
import type { MacroMarketRuntime } from './macro-market/macroMarketRuntime'
import type { DashboardFeedStatusQuery } from './macro-market/dashboardFeedStatusQuery'
import type { GoldLiveRuntime } from './macro-market/goldLiveRuntime'
import { macroMarketPolicy } from './macro-market/macroMarketPolicy'
import { requestZeroXRouterCalendarJsonBody } from './application/zeroXRouterHttpTransport'
import { INTELLIGENCE_PRODUCT_ID as PRODUCT_ID, type IntelligenceModulePlatformHooks } from './intelligenceModuleContracts'
import { createIntelligenceStores } from './intelligenceModuleStores'
import { createIntelligenceMarketData } from './intelligenceModuleMarketData'
import { createIntelligenceNewsSentiment } from './intelligenceModuleNewsSentiment'
import { createIntelligenceRuntimes } from './intelligenceModuleRuntimes'
import { createIntelligenceStartup } from './intelligenceModuleStartup'

/* 产品 id、启动 bundle 标记、原始记录补跑策略、平台 hooks 类型 → `intelligenceModuleContracts.ts`（M1）。
   hooks 类型从原路径**再导出**：`newsSentimentServices.ts` 等调用的 import 路径一个字没变。 */
export type { IntelligenceModulePlatformHooks } from './intelligenceModuleContracts'

let briefingPolicyPathQuery: PolicyPathQueryService | undefined
export type IntelligenceModule = {
  /** 模块启动链的完成信号（默认源迁移 → 会话归位 → 补跑 → 恢复）；一次性工作挂这里，别用微任务。 */
  startupReady: Promise<void>
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
  /**
   * 带凭据的取文通道（key 由模块内部的 profile/credential 存储解析，**永远不出模块**）。
   *
   * 暴露它是因为「读官方序列」这类只读取数需要一个凭据出口，而另建一套读凭据的路迟早与这份漂开。
   * 只加这一个方法：pipeline 里已有的 `fetchText` 用法不动。
   */
  fetchText: (url: string, sourceId: string) => Promise<string>
  macroMarket: MacroMarketRuntime
  /** Whether that source can spend a credit right now: the reader enabled it and a key is stored. */
  macroMarketReadiness: () => Promise<{ enabled: boolean; hasCredential: boolean }>
  /**
   * The reader's switches and the last collection's verdict for every source the dashboard's macro and
   * cross-asset rows actually read. Read-only, and the credential leaves as a boolean.
   */
  dashboardFeedStatus: Pick<DashboardFeedStatusQuery, 'status'>
  /** 通知提交口（平台注入）：装配层用它给「品种被永久拒绝」这类事件发一次提醒（用户 2026-11-16）。 */
  submitNotification?: (request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>
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
    const stores = createIntelligenceStores({
      dataDir,
      getAppLanguage,
      timeZone: shellTimeZone,
      ...(hooks?.eventBusRuntime === undefined ? {} : { eventBusRuntime: hooks.eventBusRuntime }), ...(hooks?.submitNotification === undefined ? {} : { submitNotification: hooks.submitNotification }),
      ...(hooks?.log === undefined ? {} : { log: hooks.log })
    })
    /* 名字在这里解构出来：下文近百处引用一个字没改。 */
    const {
      profileStore, rawRecordStore, macroCalendarEvidenceArchive, macroCalendarEvidenceMigration,
      translationStorage, credentialStore, fetchText, pipeline
    } = stores
    const marketData = createIntelligenceMarketData({
      jobRuntime,
      dataDir,
      profileStore,
      credentialStore,
      pipeline,
      macroCalendarEvidenceArchive,
      platformFetch: hooks.platformFetch,
      ...(hooks?.submitNotification === undefined ? {} : { submitNotification: hooks.submitNotification }),
      ...(hooks.createPlatformWebSocket === undefined ? {} : { createPlatformWebSocket: hooks.createPlatformWebSocket })
    })
    /* 名字在这里解构出来：下文引用一个字没改。 */
    const {
      requestGovernanceQueue, fundingRateHistoryStore, perpetualPositioningStore, fundingRateHistoryRefresh,
      openInterestWithSignals, macroMarket, macroMarketLive, zeroXRouterCredential, cryptoEtfCredential,
      dashboardFeedStatus, zeroXRouterCalendarEvidenceAdmission, resolveEtfFactSource, etfCurrentStateRefresh,
      capitalConditions, capitalConditionsQuery, cryptoEtfFlowClient, capitalConditionsAssetHistoryHttp
    } = marketData
    const workerRuntime = createManagedWorkerRuntime()
    const structuredModelInvocation = createStructuredModelInvocationService({
      getProviderState:
        hooks?.getProviderState ??
        (async () => {
          throw new Error('Model service is unavailable.')
        }),
      fetch: hooks.platformFetch as unknown as typeof fetch
    })
    const translationService = createIntelligenceTranslationService({
      storage: translationStorage,
      pipeline,
      jobRuntime,
      structuredModelInvocation,
      getAppLanguage,
      getProviderState: hooks?.getProviderState,
      getModelDefaults: hooks?.getModelDefaults
    })
    const newsSentiment = createIntelligenceNewsSentiment({
      dataDir,
      pipeline,
      translationService,
      translationStorage,
      structuredModelInvocation,
      getAppLanguage,
      profileStore,
      hooks
    })
    /* 表面读它；重建与作业依赖都在 M5 那个工厂里消费整份。 */
    const { newsSentimentExposure } = newsSentiment
    const runtimes = createIntelligenceRuntimes({
      jobRuntime,
      dataDir,
      timeZone: shellTimeZone,
      getAppLanguage,
      pipeline,
      rawRecordStore,
      translationService,
      capitalConditions,
      capitalConditionsQuery,
      fundingRateHistoryStore,
      perpetualPositioningStore,
      etfCurrentStateRefresh,
      fundingRateHistoryRefresh,
      openInterestWithSignals,
      newsSentiment,
      profileStore,
      workerRuntime,
      credentialStore,
      requestGovernanceQueue,
      structuredModelInvocation,
      hooks
    })
    /* 名字在这里解构出来：表面与启动链引用一个字没改。 */
    const { archiveService, replayService, publicQueryService, marketAnalysisRuntime, sourcesService } = runtimes
    const startup = createIntelligenceStartup({
      jobRuntime,
      dataDir,
      profileStore,
      sourcesService,
      marketAnalysisRuntime,
      /* 惰性读：链接存储的构造在下面日报那段，晚于这里。 */
      briefingSessionLinks: () => dailyBriefSessionLinks,
      hooks
    })
    const { startupReady } = startup
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
      ...(hooks?.getModelDefaults ? { getModelDefaults: hooks.getModelDefaults } : {}), ...(hooks?.getProviderState ? { getProviderState: hooks.getProviderState } : {}),
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
            // 同样的两道闸：源关着不绕过去读；没有密钥是「没有接口」，不是「这次读失败」。
            // 2026-11-13 用户拍板：日报回溯改读 CryptoETF（免费档只保留 30 天；今天切，受影响
            // 的历史日报为 0 份）。旧源保留不动，但这里不再是它的读取点。
            const profile = await profileStore.resolveProfile(cryptoEtfSourcePolicy.sourceId)
            if (!profile.enabled) return Object.freeze({ state: 'not-configured' as const })
            const credential = await cryptoEtfCredential()
            if (!credential?.apiKey) return Object.freeze({ state: 'not-configured' as const })
            const window = await cryptoEtfFlowClient.readSettledWindow(credential.apiKey)
            const rowsOf = (reading: { days?: readonly { tradingDate: string; netFlowUsd: number }[] } | undefined) =>
              reading?.days?.map(day => ({ date: Date.parse(`${day.tradingDate}T00:00:00.000Z`), changeUsd: day.netFlowUsd }))
            if (window.state === 'available') {
              return Object.freeze({ state: 'available' as const, btc: rowsOf(window.btc), eth: rowsOf(window.eth) })
            }
            if (window.state === 'partial') {
              return Object.freeze({
                state: 'partial' as const,
                ...(window.btc === undefined ? {} : { btc: rowsOf(window.btc) }),
                ...(window.eth === undefined ? {} : { eth: rowsOf(window.eth) })
              })
            }
            return Object.freeze({ state: 'unavailable' as const })
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
      resolveFactSource: resolveEtfFactSource,
      now: () => new Date().toISOString(),
    })
    const briefingCalendar = createBriefingCalendarCommands(() => jobRuntime.listSchedules().map((definition) => definition.id))
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
      ...(hooks?.deleteAgentSessions ? { deleteAgentSessions: hooks.deleteAgentSessions } : {}), ...(hooks?.submitNotification ? { submitNotification: hooks.submitNotification } : {})
    })
    modulePlatformHooks?.onSettingsCommitted?.((change) => { if (change.changedKeys.includes('timeZone')) void rescheduleBriefingForDisplayTimeZone(change.next.timeZone) })
    intelligenceModule = {
      startupReady,
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
      fetchText,
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
