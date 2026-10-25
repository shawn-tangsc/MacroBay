import { join } from 'node:path'
import { readFile } from 'node:fs/promises'

import type { JobRuntime, ManagedWorkerRuntime } from '@platform/jobs'
import { createManagedWorkerRuntime } from '@platform/jobs'
import type { EventBusRuntime } from '@platform/message-bus'
import type { PlatformWebSocketConstructor } from '@platform/network/platformWebSocket'
import type { ProviderState } from '@platform/ai/providers/modelProviderTypes'
import { createStructuredModelInvocationService } from '@platform/ai/invocation/structuredModelInvocation'
import type { ModelDefaultsSettings } from '@platform/settings/schema/appSettings'
import { app } from 'electron'

import { createIntelligenceFetchText, executeIntelligenceFetchTarget } from './adapters/intelligenceHttpFetch'
import { createIntelligenceArchiveService } from './application/intelligenceArchiveService'
import { createIntelligencePipeline } from './application/intelligencePipeline'
import { createIntelligenceEventPublisher } from './application/intelligenceEventPublisher'
import { createIntelligenceReplayService } from './application/intelligenceReplayService'
import { createIntelligenceSourcesService } from './application/intelligenceSourcesService'
import { createMarketIntelligencePublicQueryService } from './public-query/publicQueryService'
import { createIntelligenceTranslationService } from './application/intelligenceTranslationService'
import { createMarketAnalysisSettingsJsonStorage, createMarketAnalysisSettingsStore } from './application/marketAnalysisSettingsStore'
import { createMarketAnalysisSettingsService } from './application/marketAnalysisSettingsService'
import { createDefaultTranslationSettings } from './application/intelligenceTranslationHelpers'
import { createRawRecordStore } from './application/rawRecordStore'
import { createProfileJsonStorage, createSourceProfileStore } from './application/sourceProfileStore'
import {
  createFocusSettingsJsonStorage,
  createIntelligenceFocusSettingsStore
} from './application/intelligenceFocusSettingsStore'
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
import { createNewsSentimentEnrichmentService } from './news-sentiment/newsSentimentEnrichmentService'
import { createNewsSentimentScoringService } from './news-sentiment/newsSentimentScoringService'
import { createNewsSentimentQuery } from './news-sentiment/newsSentimentQuery'
import { resolveNewsSentimentModel } from './news-sentiment/newsSentimentSettings'
import { NEWS_SENTIMENT_SOURCE_IDS } from './schema/newsSentiment'
import type { NewsSentimentSettings, NewsSentimentSettingsView } from './schema/newsSentiment'
import { intelligenceHttpRequest } from './adapters/intelligenceHttpClient'
import { INTELLIGENCE_DEFAULT_USER_AGENT } from './adapters/intelligenceHttpFetch'
import {
  createRawRecordJsonStorage,
  readRawRecordSnapshotSync
} from './store/rawRecordStorage'
import {
  INTELLIGENCE_NORMALIZE_RAW_RECORDS_JOB,
  INTELLIGENCE_REPLAY_WINDOW_JOB
} from './jobs/intelligenceJobIds'
import { registerIntelligenceJobs } from './jobs/registerIntelligenceJobs'
import { enqueueIntelligencePipelineJobs } from './jobs/enqueueIntelligencePipelineJobs'
import { INTELLIGENCE_ENRICH_NEWS_DOCUMENTS_JOB, INTELLIGENCE_SCORE_NEWS_SENTIMENT_JOB } from './jobs/intelligenceJobIds'
import { registerMarketAnalysisRuntime, type MarketAnalysisRuntime } from './jobs/registerMarketAnalysisRuntime'
import { statSync } from 'node:fs'
import { getPlatformFetch } from '@platform/network/platformFetch'
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

export type IntelligenceModulePlatformHooks = {
  getProviderState?: () => Promise<ProviderState>
  getAppLanguage?: () => Promise<'zh-CN' | 'en-US'>
  /** 模型服务页「默认模型」只读投影；翻译偏好跟随其中的默认翻译模型。 */
  getModelDefaults?: () => Promise<ModelDefaultsSettings>
  eventBusRuntime?: EventBusRuntime
  platformFetch?: CapitalConditionsPlatformFetch
  /**
   * The platform's proxy-aware socket constructor, injected lazily. It is a thunk rather than a
   * constructor because the desktop shell can only build it once network settings are readable —
   * binding it eagerly would hand the product a constructor that fails on its first connect.
   */
  createPlatformWebSocket?: () => PlatformWebSocketConstructor
  /** Reconcile the automatic calendar job registry after a feed switch. */
  onCalendarEnabledChanged?: () => void | Promise<void>
}

type IntelligenceModule = {
  pipeline: ReturnType<typeof createIntelligencePipeline>
  sourcesService: ReturnType<typeof createIntelligenceSourcesService>
  translationService: ReturnType<typeof createIntelligenceTranslationService>
  newsSentiment: {
    store?: ReturnType<typeof createNewsSentimentSqliteStore>
    settingsStore: ReturnType<typeof createNewsSentimentSettingsStore>
    enrichment?: ReturnType<typeof createNewsSentimentEnrichmentService>
    scoring?: ReturnType<typeof createNewsSentimentScoringService>
    query?: ReturnType<typeof createNewsSentimentQuery>
    settings: {
      get: () => Promise<NewsSentimentSettingsView>
      save: (patch: Partial<NewsSentimentSettings>) => Promise<NewsSentimentSettingsView>
    }
  }
  workerRuntime: ManagedWorkerRuntime
  replayService: ReturnType<typeof createIntelligenceReplayService>
  archiveService: ReturnType<typeof createIntelligenceArchiveService>
  publicQueryService: ReturnType<typeof createMarketIntelligencePublicQueryService>
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
  /** The gold price stream. Reads only: it never appends to the macro-market series store. */
  macroMarketLive: GoldLiveRuntime
}

let intelligenceModule: IntelligenceModule | null = null
let modulePlatformHooks: IntelligenceModulePlatformHooks | undefined

function getProductDataDir(): string {
  return join(app.getPath('userData'), 'products', PRODUCT_ID)
}

/**
 * Publishers disagree about who may read them: SEC.gov returns 403 to a browser user agent but 200
 * to the identified collector, while CoinDesk hands a body-less variant to the collector UA. Pick
 * the headers per host instead of one global article fingerprint.
 */
/**
 * Electron's net.fetch shares Chromium's HTTP cache. A body-less variant fetched once can be
 * served again to every later request for the same URL, even with different headers, so article
 * reads carry a unique query key as well as no-store.
 */
function articleFetchUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.hostname.endsWith('coindesk.com') || parsed.hostname.endsWith('okx.com')) {
      parsed.searchParams.set('mb_nocache', String(Date.now()))
    }
    return parsed.toString()
  } catch {
    return url
  }
}

function articleFetchHeaders(url: string): Record<string, string> {
  if (url.includes('sec.gov')) {
    return { Accept: 'text/html', 'User-Agent': INTELLIGENCE_DEFAULT_USER_AGENT, 'Cache-Control': 'no-cache' }
  }
  if (url.includes('binance.com/bapi')) {
    return { Accept: 'application/json', 'User-Agent': INTELLIGENCE_DEFAULT_USER_AGENT, 'Cache-Control': 'no-cache' }
  }
  return {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache'
  }
}

export function getIntelligenceModule(
  jobRuntime: JobRuntime,
  platformHooks?: IntelligenceModulePlatformHooks
): IntelligenceModule {
  if (platformHooks) {
    modulePlatformHooks = platformHooks
  }

  if (!intelligenceModule) {
    const hooks = modulePlatformHooks
    const dataDir = getProductDataDir()
    const getAppLanguage = hooks?.getAppLanguage ?? (async () => 'zh-CN' as const)
    const profileStore = createSourceProfileStore(
      createProfileJsonStorage(join(dataDir, 'intelligence-source-profiles.json'))
    )
    const focusSettingsStore = createIntelligenceFocusSettingsStore(
      createFocusSettingsJsonStorage(join(dataDir, 'intelligence-focus-settings.json'))
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
      eventPublisher
    })
    const capitalConditionsStore = createCapitalConditionsCurrentStateStore({
      storage: createCapitalConditionsStateJsonStorage(join(dataDir, 'capital-conditions-state.json'))
    })
    const etfCurrentStateStore = createEtfCurrentStateStore({
      storage: createEtfCurrentStateSqliteStorage(join(dataDir, 'etf-current-state.sqlite'))
    })
    const requestGovernanceQueue = createSourceRequestGovernanceQueue({ now: () => Date.now() })
    const fundingRateHistoryStore = createFundingRateHistorySqliteStore(join(dataDir, 'funding-rate-history.sqlite'))
    const fundingRateHistoryClient = createBinanceFundingRateHistoryClient({ platformFetch: (hooks?.platformFetch ?? getPlatformFetch()) as typeof fetch })
    const fundingRateHistoryRefresh = createFundingRateHistoryRefreshService({
      isEnabled: async () => (await profileStore.resolveProfile('binance-futures-positioning')).enabled,
      requestHistory: fundingRateHistoryClient.requestHistory,
      store: fundingRateHistoryStore,
      now: () => new Date().toISOString()
    })
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
      ...(hooks?.createPlatformWebSocket ? { createWebSocket: hooks.createPlatformWebSocket } : {}),
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
      now: () => new Date().toISOString()
    })
    const capitalConditionsRefresh = createCapitalConditionsRefreshService({
      isEnabled: async () => (await profileStore.resolveProfile('defillama-stablecoins')).enabled,
      http: createCapitalConditionsHttpClient({ platformFetch: hooks?.platformFetch }),
      store: capitalConditionsStore,
      now: () => new Date().toISOString()
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
      fetch: getPlatformFetch()
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
    const newsSentimentSettingsStore = createNewsSentimentSettingsStore(
      createNewsSentimentSettingsJsonStorage(join(dataDir, 'intelligence-news-sentiment-settings.json'))
    )
    let newsSentimentStore: ReturnType<typeof createNewsSentimentSqliteStore> | undefined
    try {
      newsSentimentStore = createNewsSentimentSqliteStore(join(dataDir, newsSentimentStoragePolicy.fileName))
    } catch {
      // A broken database must not take the rest of the product down; news sentiment stays unavailable.
      newsSentimentStore = undefined
    }
    const newsSentimentEnrichment = newsSentimentStore
      ? createNewsSentimentEnrichmentService({
          pipeline,
          store: newsSentimentStore,
          fetchArticle: async (url) => {
            const response = await intelligenceHttpRequest(
              {
                url: articleFetchUrl(url),
                method: 'GET',
                headers: articleFetchHeaders(url),
                cache: 'no-store',
                timeoutMs: 15_000
              },
              { retryPolicy: { maxAttempts: 1 } }
            )
            return { status: response.status, bodyText: response.bodyText }
          },
          now: () => new Date().toISOString()
        })
      : undefined
    const newsSentimentScoring = newsSentimentStore
      ? createNewsSentimentScoringService({
          pipeline,
          store: newsSentimentStore,
          settingsStore: newsSentimentSettingsStore,
          ...(hooks?.getProviderState ? { getProviderState: hooks.getProviderState } : {}),
          ...(hooks?.getModelDefaults ? { getModelDefaults: hooks.getModelDefaults } : {}),
          invoke: structuredModelInvocation.invoke,
          now: () => new Date().toISOString()
        })
      : undefined
    const newsSentimentQuery = newsSentimentStore
      ? createNewsSentimentQuery({
          store: newsSentimentStore,
          pipeline,
          translation: translationService,
          now: () => new Date().toISOString()
        })
      : undefined
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

    registerIntelligenceJobs(jobRuntime, {
      pipeline,
      archiveService,
      replayService,
      translationService,
      capitalConditions,
      etfFlowHistory: etfCurrentStateRefresh,
      fundingRateHistory: fundingRateHistoryRefresh,
      ...(newsSentimentEnrichment && newsSentimentScoring
        ? { newsSentiment: { enrichItems: newsSentimentEnrichment.enrichItems, scoreItems: newsSentimentScoring.scoreItems } }
        : {})
    })
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
    const publicQueryService = createMarketIntelligencePublicQueryService({ pipeline, capitalConditionsQuery, fundingRateHistoryStore })
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
      eventBusRuntime: hooks?.eventBusRuntime,
      pipeline,
      publicQueryService,
      structuredModelInvocation,
      settingsService: marketAnalysisSettingsService,
      getAppLanguage,
      dataDir
    })
    const sourcesService = createIntelligenceSourcesService({
      profileStore,
      focusSettingsStore,
      pipeline,
      jobRuntime,
      workerRuntime,
      replayService,
      capitalConditions,
      credentialStore,
      onCalendarEnabledChanged: hooks?.onCalendarEnabledChanged,
      requestGovernanceQueue,
      ...(hooks?.platformFetch ? { platformFetch: hooks.platformFetch as typeof fetch } : {})
    })
    // These four need no credential and feed the dashboard's sentiment card; a fresh install should
    // not require toggling them on before the feature can do anything. An existing profile wins.
    const ensureDefaultNewsSources = (async () => {
      for (const sourceId of NEWS_SENTIMENT_SOURCE_IDS) {
        if ((await profileStore.getProfile(sourceId)) === undefined) {
          await profileStore.saveProfile({ sourceId, enabled: true })
        }
      }
    })().catch(() => undefined)
    void ensureDefaultNewsSources
      .then(() => intelligenceRawRecordStartupRecoveryPolicy.completeBeforeSourceRuntime(jobRuntime))
      .finally(() => sourcesService.initializeRuntime().catch(() => undefined))
      .finally(() => marketAnalysisRuntime.startRecovery().catch(() => undefined))
    void (async () => {
      const settingsPath = join(dataDir, 'intelligence-translation-settings.json')
      try {
        await readFile(settingsPath, 'utf8')
      } catch {
        await translationStorage.writeSettings(createDefaultTranslationSettings(await getAppLanguage()))
      }
    })()
    intelligenceModule = {
      pipeline,
      workerRuntime,
      archiveService,
      replayService,
      translationService,
      newsSentiment: {
        settingsStore: newsSentimentSettingsStore,
        ...(newsSentimentStore ? { store: newsSentimentStore } : {}),
        ...(newsSentimentEnrichment ? { enrichment: newsSentimentEnrichment } : {}),
        ...(newsSentimentScoring ? { scoring: newsSentimentScoring } : {}),
        ...(newsSentimentQuery ? { query: newsSentimentQuery } : {}),
        settings: newsSentimentSettings
      },
      sourcesService,
      publicQueryService,
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
      dashboardFeedStatus
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
