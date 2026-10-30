import type { ProductIpcRegistrar } from '@platform/desktop/ipc/productIpcRegistry'
import type { JobRuntime } from '@platform/jobs'
import type { EventBusRuntime } from '@platform/message-bus'
import type { ProviderState } from '@platform/ai/providers/modelProviderTypes'
import type { ProductAgentToolHandlerRegistration } from '@platform/ai/agent-platform/productTools/productAgentToolBootstrapContracts'
import type { ProductCacheRegistrar } from '@platform/storage/cache-governance/productCacheRegistrar'
import type { ProductServiceDisposerRegistrar } from '@platform/product-registry/productServiceDisposerRegistry'
import type { SecretVault } from '@platform/secrets/secretVaultTypes'
import { statSync } from 'node:fs'
import { join } from 'node:path'

import { app } from 'electron'
import { createPlatformWebSocketFactory } from '@platform/network/platformWebSocket'
import type { ModelDefaultsSettings, NetworkSettings } from '@platform/settings/schema/appSettings'
import { createCrossAssetStore, crossAssetStoragePolicy } from './intelligence/cross-asset/crossAssetStore'
import { analysisConclusionCutoffIso } from './intelligence/retention/analysisConclusionRetention'
import { createMarketHistoryRetention, registerMarketHistoryRetentionJob } from './intelligence/retention/marketHistoryRetentionJob'
import { createCrossAssetRuntime } from './intelligence/cross-asset/crossAssetRuntime'
import { createBinanceCrossAssetClient } from './intelligence/cross-asset/binanceCrossAssetClient'
import { createBinanceCrossAssetStream } from './intelligence/cross-asset/binanceCrossAssetStream'
import { createCrossAssetSourceConfiguration } from './intelligence/cross-asset/crossAssetSourceConfiguration'
import { createCrossAssetSnapshotQuery } from './intelligence/cross-asset/crossAssetSnapshotQuery'
import { createCrossAssetIndexRuntime } from './intelligence/cross-asset/crossAssetIndexRuntime'
import { crossAssetPolicy } from './intelligence/cross-asset/crossAssetPolicy'
import { registerCrossAssetIpc } from './intelligence/cross-asset/registerCrossAssetIpc'

import { getIntelligenceModule, getIntelligenceProductDataDir } from './intelligence/intelligenceModule'
import { registerIntelligenceIpc } from './intelligence/ipc/registerIntelligenceIpc'
import { registerIntelligencePublicQueryIpc } from './intelligence/ipc/registerIntelligencePublicQueryIpc'
import { registerIntelligenceSourcesIpc } from './intelligence/ipc/registerIntelligenceSourcesIpc'
import { registerDashboardSourceConnectionIpc } from './intelligence/ipc/registerDashboardSourceConnectionIpc'
import { registerIntelligenceTranslationIpc } from './intelligence/ipc/registerIntelligenceTranslationIpc'
import { registerMarketAnalysisIpc } from './intelligence/ipc/marketAnalysisIpc'
import { registerDailyBriefingIpc } from './intelligence/ipc/registerDailyBriefingIpc'
import type { AnalysisSessionDependencies } from './intelligence/analysis/analysisFollowUpSession'
import { registerIntelligenceAgentToolHandlers } from './intelligence/agent-capabilities/handlerRegistry'
import type {
  CrossAssetOps,
  MacroCalendarOps
} from './intelligence/agent-capabilities/operationFacades'
import { createMacroCalendarScheduleBackend } from './intelligence/macro-calendar/macroCalendarScheduleBackend'
import { createPolicyPathQueryService } from './intelligence/policy-path/policyPathQueryService'
import { registerPolicyPathIpc } from './intelligence/policy-path/ipc/registerPolicyPathIpc'
import { createPolicyPathRuntime } from './intelligence/policy-path/policyPathRuntime'
import { createMacroEconomicCalendarQueryService } from './intelligence/macro-calendar/macroEconomicCalendarQueryService'
import { createMacroCalendarScheduleJobRuntime } from './intelligence/macro-calendar/macroCalendarScheduleJobRuntime'
import { createZeroXRouterCalendarScheduler } from './intelligence/macro-calendar/0xrouter-calendar/zeroXRouterCalendarScheduler'
import { requestMarketAnalysisForCalendarUpdate } from './intelligence/jobs/marketAnalysisCalendarUpdateTrigger'
import { createBeaOfficialReleaseJobRuntime } from './intelligence/macro-calendar/bea-official-release/beaOfficialReleaseJobRuntime'
import { createMacroCalendarProviderSettingsService } from './intelligence/macro-calendar/macroCalendarProviderSettingsService'
import { createUnifiedMacroCalendarProfileStore } from './intelligence/macro-calendar/macroCalendarUnifiedProfileStore'
import { registerMacroEconomicCalendarIpc } from './intelligence/macro-calendar/ipc/registerMacroEconomicCalendarIpc'
import { createMacroCalendarWriteActions } from './intelligence/macro-calendar/macroCalendarWriteActions'
import { registerMacroMarketIpc, registerDashboardFeedStatusIpc } from './intelligence/macro-market/ipc/registerMacroMarketIpc'
import { createMacroMarketSnapshotQuery } from './intelligence/macro-market/macroMarketSnapshotQuery'
import { registerMacroRatesIpc } from './intelligence/macro-rates/ipc/registerMacroRatesIpc'
import { registerProvenanceIpc } from './intelligence/provenance/registerProvenanceIpc'
import { createMacroRatesSnapshotQuery } from './intelligence/macro-rates/macroRatesSnapshotQuery'
import { createDashboardSourceConnectionService } from './intelligence/application/dashboardSourceConnectionService'
import { createBlsApiCompatibilityHost } from './intelligence/macro-calendar/bls-api/blsApiCompatibilityHost'
import type { BlsApiCompatibilityProbe } from './intelligence/macro-calendar/bls-api/blsApiCompatibilityProbe'
import { createBlsEmploymentMvpEvidence } from './intelligence/macro-calendar/bls-employment-refresh/blsEmploymentMvpEvidence'
import { createBlsEmploymentMvpRefreshService } from './intelligence/macro-calendar/bls-employment-refresh/blsEmploymentMvpRefreshService'
import { createBlsPythonRequestsBridge } from './intelligence/macro-calendar/bls-python/blsPythonRequestsBridge'
import { createBlsScheduleAndLatestValuesSyncWorkflow } from './intelligence/macro-calendar/bls-schedule-catch-up/blsScheduleAndLatestValuesSyncWorkflow'
import { createBlsScheduleAndValuesScheduler } from './intelligence/macro-calendar/bls-schedule-catch-up/blsScheduleAndValuesScheduler'
import { autoEnrollCalendarProviders } from './intelligence/macro-calendar/macroCalendarProviderAutoEnrollment'
import { createStoredManualCalendar } from './intelligence/macro-calendar/0xrouter-calendar/zeroXRouterCalendarManualRuntime'
import { createSampleModeRuntime } from './demo/demoModule'

const blsApiCompatibilityHost = createBlsApiCompatibilityHost()
const blsPythonRequestsBridge = createBlsPythonRequestsBridge({})

export type ProductBootstrapDependencies = AnalysisSessionDependencies & {
  register: ProductIpcRegistrar
  jobRuntime: JobRuntime
  eventBusRuntime: EventBusRuntime
  getProviderState?: () => Promise<ProviderState>
  getAppLanguage?: () => Promise<'zh-CN' | 'en-US'>
  /** 模型服务页「默认模型」只读投影（翻译偏好跟随其中的默认翻译模型）。 */
  getModelDefaults?: () => Promise<ModelDefaultsSettings>
  registerProductAgentToolHandler: (registration: ProductAgentToolHandlerRegistration) => void
  registerProductCache: ProductCacheRegistrar
  registerProductDisposer?: ProductServiceDisposerRegistrar
  secretVault?: SecretVault
  platformFetch?: typeof fetch
  getNetworkSettings?: () => Promise<NetworkSettings>
}

export function getBlsApiCompatibilityProbe(): BlsApiCompatibilityProbe | undefined {
  return blsApiCompatibilityHost.getProbe()
}

/**
 * 录制目录（仅开发）：`MB_SAMPLE_RECORD=1` 且不是打包运行时才有。
 *
 * 这里对 `app` 做能力判断而不是直接调，因为测试会用一个只实现路径 API 的替身。
 */
/**
 * 开发期的场景目录：只有从源码运行时才走磁盘，打包后一律用构建期打平的 JSON。
 *
 * 这让「改一份示例 JSON」不再需要重启主进程——重新进入示例即可生效。
 */
function sampleModeScenarioDirectory(): string | undefined {
  if (typeof app?.getAppPath !== 'function' || app.isPackaged) return undefined
  const directory = join(app.getAppPath(), 'products/market-intelligence/demo/scenarios')
  try {
    return statSync(directory).isDirectory() ? directory : undefined
  } catch {
    return undefined
  }
}

function sampleModeRecorderDirectory(): string | undefined {
  if (process.env.MB_SAMPLE_RECORD !== '1') return undefined
  if (typeof app?.getAppPath !== 'function' || app.isPackaged) return undefined
  return join(app.getAppPath(), 'products/market-intelligence/demo/raw')
}

export function registerServices(deps: ProductBootstrapDependencies): void {
  blsApiCompatibilityHost.initialize(Object.freeze({ platformFetch: deps.platformFetch }))
  /**
   * 示例模式（设计 155/156）。整份产品只有这一个拦截点：包装注册表，方法集合不变，只换执行。
   * 暂停/恢复复用启动编排，示例模式自己不排任何班。
   */
  let resumeProductWork: () => Promise<void> = async () => undefined
  const recorderDirectory = sampleModeRecorderDirectory()
  const scenarioDirectory = sampleModeScenarioDirectory()
  const sampleMode = createSampleModeRuntime({
    productId: 'market-intelligence',
    jobRuntime: deps.jobRuntime,
    getLanguage: deps.getAppLanguage ?? (async () => 'zh-CN' as const),
    resumeWork: () => resumeProductWork(),
    ...(recorderDirectory ? { recorderDirectory } : {}),
    ...(scenarioDirectory ? { scenarioDirectory } : {})
  })
  const register: ProductIpcRegistrar = sampleMode.wrap(deps.register)
  sampleMode.registerIpc(register)
  let syncMarketCalendarSchedule: (() => Promise<void>) | undefined
  const intelligenceModule = getIntelligenceModule(deps.jobRuntime, {
    getProviderState: deps.getProviderState,
    getAppLanguage: deps.getAppLanguage,
    getModelDefaults: deps.getModelDefaults,
    eventBusRuntime: deps.eventBusRuntime,
    platformFetch: deps.platformFetch,
    // The gold price stream needs the proxy-aware platform socket, and the shell can only build that
    // once network settings are readable — so it is handed over as a thunk, never as a raw WebSocket.
    ...(deps.getNetworkSettings
      ? { createPlatformWebSocket: () => createPlatformWebSocketFactory({ getNetworkSettings: deps.getNetworkSettings! }) }
      : {}),
    onCalendarEnabledChanged: () => syncMarketCalendarSchedule?.()
  })
  // 退出示例后按既有 profile 重新注册调度：与启动走同一条编排，不复制一份调度逻辑。
  resumeProductWork = async () => {
    await intelligenceModule.sourcesService.initializeRuntime()
    await intelligenceModule.marketAnalysisRuntime.startRecovery()
  }
  const macroCalendarBackend = createMacroCalendarScheduleBackend({
    dataDir: getIntelligenceProductDataDir(),
    rawRecords: intelligenceModule.rawRecordStore,
    blsScheduleBridge: blsPythonRequestsBridge,
    evidenceArchive: intelligenceModule.macroCalendarEvidenceArchive,
    evidenceReady: intelligenceModule.macroCalendarEvidenceReady
  })
  const macroEconomicCalendarQueryService = createMacroEconomicCalendarQueryService({ repository: macroCalendarBackend.repository })
  intelligenceModule.publicQueryService.setMacroEconomicCalendarQuery(macroEconomicCalendarQueryService)
  const policyPathRuntime = createPolicyPathRuntime({
    jobRuntime: deps.jobRuntime,
    repository: macroCalendarBackend.repository,
    // Never fall back to the global fetch here: it would bypass the platform proxy and the
    // collector would fail silently on a machine that needs one.
    fetch: url => deps.platformFetch
      ? deps.platformFetch(url)
      : Promise.resolve({ ok: false, status: 0, text: async () => '' }),
    isEnabled: async () => (await intelligenceModule.sourceProfileStore.resolveProfile('policy-path-market')).enabled
  })
  const policyPathQueryService = createPolicyPathQueryService({
    calendar: macroEconomicCalendarQueryService,
    facts: macroCalendarBackend.repository.policyFacts,
    observations: macroCalendarBackend.repository.policyObservations
  })
  policyPathRuntime.start()
  const crossAssetConfiguration = createCrossAssetSourceConfiguration({ profileStore: intelligenceModule.crossAssetProfiles })
  let crossAssetStore: ReturnType<typeof createCrossAssetStore> | undefined
  try { crossAssetStore = createCrossAssetStore(join(getIntelligenceProductDataDir(), crossAssetStoragePolicy.fileName)) }
  catch { /* Preserve the unavailable feature database; other product capabilities remain usable. */ }
  const crossAssetClient = createBinanceCrossAssetClient({
    platformFetch: deps.platformFetch ?? (async () => { throw new Error('dependency-unavailable') }),
    requestGovernanceQueue: intelligenceModule.requestGovernanceQueue
  })
  // The real Nasdaq 100 index is collected by its own five-minute job into the same store the Binance
  // proxy writes to: the row prefers the licensed index and falls back to the labelled proxy, and both
  // legs have to be on disk for that choice to be made from data rather than from hope. One store, one
  // connection — two writers of one SQLite file would be a second writer of one table.
  const crossAssetIndexRuntime = crossAssetStore ? createCrossAssetIndexRuntime({
    jobRuntime: deps.jobRuntime,
    store: crossAssetStore,
    resolveProfile: sourceId => intelligenceModule.crossAssetProfiles.resolveProfile(sourceId),
    getCredential: credentialRef => intelligenceModule.sourceCredentials.getByRef(credentialRef),
    onError: (error, sourceId) => {
      // A code, a symbol and nothing else: the failure message names the source, never the URL the key
      // travelled in.
      console.log(JSON.stringify({ marker: 'MI_CROSS_ASSET_INDEX_ERROR', sourceId, symbolCode: crossAssetPolicy.index.symbol, message: String(error).slice(0, 200) }))
    }
  }) : undefined
  const crossAssetRuntime = crossAssetStore ? createCrossAssetRuntime({
    now: Date.now, store: crossAssetStore, client: crossAssetClient,
    readEnabled: async () => {
      const configuration = await crossAssetConfiguration.read()
      if (configuration.state === 'unknown') throw new Error('configuration-unavailable')
      return configuration.enabled
    },
    createStream: onState => {
      if (!deps.getNetworkSettings) throw new Error('dependency-unavailable')
      return createBinanceCrossAssetStream({ now: Date.now, onState,
        platformWebSocket: createPlatformWebSocketFactory({ getNetworkSettings: deps.getNetworkSettings }) })
    }
  }) : undefined
  const crossAssetQuery = crossAssetStore && crossAssetRuntime ? createCrossAssetSnapshotQuery({
    now: Date.now, store: crossAssetStore, live: crossAssetRuntime.snapshot,
    // The row's leg is chosen from what the licensed feed last managed to do, never from the clock: a
    // closed session is a successful tick and keeps the real index on the row.
    indexFeed: () => crossAssetIndexRuntime?.state() ?? { state: 'pending' },
    // The dollar and gold lines: the very macro store the 市场状态 table's rows are read from, so a
    // chart line and a table cell can never disagree about what the dollar did. Read on every query
    // rather than cached with the analysis — it is another database on another cadence.
    macroSeries: (seriesId, fromMs, toMs) => intelligenceModule.macroMarket.store.series(seriesId, fromMs, toMs)
  }) : undefined
  registerCrossAssetIpc(register, { now: Date.now, runtime: crossAssetRuntime, query: crossAssetQuery, configuration: crossAssetConfiguration })
  // Both market stores answer one retention policy, by one daily job and one look at startup: a store
  // that has been kept since the product shipped has months of folding to do, and waiting for the first
  // midnight would leave the reader's disk exactly as it was for a day.
  if (crossAssetStore) {
    const macroStore = intelligenceModule.macroMarket.store
    const analysisRepository = intelligenceModule.marketAnalysisRuntime.repository
    registerMarketHistoryRetentionJob(deps.jobRuntime, createMarketHistoryRetention({
      stores: {
        macro: { retention: ({ cutoffs }) => macroStore.retention(cutoffs), note: (key, value) => macroStore.note(key, value) },
        crossAsset: { retention: ({ cutoffs }) => crossAssetStore.retention(cutoffs), note: (key, value) => crossAssetStore.note(key, value) },
        // The conclusions keep their own window: fourteen days, then the whole graph goes. The bar
        // cutoffs are ignored rather than reinterpreted — two policies, one clock.
        analysis: {
          retention: ({ atMs }) => ({ thinned: 0, ...analysisRepository.retention(analysisConclusionCutoffIso(atMs)) }),
          note: (key, value) => analysisRepository.note(key, value)
        }
      }
    }).run)
  }
  // One cross-asset source, two readers with two shapes: the analysis context reads through the
  // public query method, which validates with the renderer's own parser, while the prediction
  // verifier takes the raw synchronous query and parses the snapshot itself. Handing the async
  // method to the verifier would make `parseCrossAssetSnapshot(Promise)` return undefined and
  // silently produce no observations at all.
  if (crossAssetQuery) {
    intelligenceModule.publicQueryService.setCrossAssetQuery({ query: input => crossAssetQuery.query(input) })
    intelligenceModule.marketAnalysisRuntime.setCrossAssetQuery(input => crossAssetQuery.query(input))
  }
  const blsEmploymentMvpRefresh = createBlsEmploymentMvpRefreshService({
    valuesBridge: blsPythonRequestsBridge,
    evidence: intelligenceModule.macroCalendarEvidenceReady
      ? createBlsEmploymentMvpEvidence({ archive: intelligenceModule.macroCalendarEvidenceArchive })
      : undefined,
    repository: macroCalendarBackend.repository,
    now: () => new Date().toISOString()
  })
  // A feed is registered with the automatic calendar job only while it is enabled;
  // an absent profile defaults to enabled so a fresh install keeps collecting.
  const readEnabledCalendarFeeds = async (): Promise<readonly string[]> => {
    const ids = [
      'macro-calendar-0xrouter-economic-data',
      'macro-calendar-0xrouter-financial-events',
      'macro-calendar-0xrouter-central-bank-activities'
    ]
    const profiles = await intelligenceModule.sourceProfileStore.listProfiles()
    const byId = new Map(profiles.map((profile) => [profile.sourceId, profile.enabled]))
    return ids.filter((id) => byId.get(id) !== false)
  }
  const marketCalendar = createStoredManualCalendar({ storage: macroCalendarBackend.storage,
    archive: intelligenceModule.macroCalendarEvidenceArchive, evidenceReady: intelligenceModule.macroCalendarEvidenceReady,
    requestGovernanceQueue: intelligenceModule.requestGovernanceQueue,
    readEnabledFeeds: readEnabledCalendarFeeds,
    ...intelligenceModule.calendarManualDependencies })
  // The analysis macro route reads the 0xRouter observations through the same public page
  // service the calendar page uses, so both routes share one admission and one projection.
  intelligenceModule.publicQueryService.setMarketCalendarQuery({ queryMonth: marketCalendar.queryMonth })
  const blsScheduleAndLatestValues = createBlsScheduleAndLatestValuesSyncWorkflow({
    schedule: macroCalendarBackend.blsEmploymentSchedule,
    repository: macroCalendarBackend.repository,
    refresh: blsEmploymentMvpRefresh,
    now: () => new Date().toISOString()
  })
  const calendarProfiles = createUnifiedMacroCalendarProfileStore(intelligenceModule.sourceProfileStore, macroCalendarBackend.profiles)
  const macroCalendarJobs = createMacroCalendarScheduleJobRuntime({
    jobRuntime: deps.jobRuntime,
    profiles: calendarProfiles,
    health: macroCalendarBackend.health
  })
  const marketCalendarScheduler = createZeroXRouterCalendarScheduler({
    jobRuntime: deps.jobRuntime,
    readReadiness: intelligenceModule.calendarManualDependencies.readReadiness,
    readEnabledFeeds: readEnabledCalendarFeeds,
    refreshAutomatic: (enabledFeeds) => marketCalendar.refreshAutomatic(enabledFeeds),
    // A calendar update must be able to produce a new conclusion. The request is
    // bounded by the existing trigger budget and cooldown, and it fires only when the
    // refresh actually stored observations.
    onRefreshCompleted: async (items) => {
      await requestMarketAnalysisForCalendarUpdate(items, {
        requestRefresh: () => intelligenceModule.marketAnalysisRuntime.requestInitialAnalysis(undefined, undefined, 'refresh', 'calendar-refresh')
      })
    }
  })
  const beaOfficialReleaseJobs = macroCalendarBackend.beaOfficialReleaseRefresh
    ? createBeaOfficialReleaseJobRuntime({ jobRuntime: deps.jobRuntime, profiles: calendarProfiles, refresh: macroCalendarBackend.beaOfficialReleaseRefresh })
    : undefined
  const blsScheduleAndValuesScheduler = createBlsScheduleAndValuesScheduler({
    jobRuntime: deps.jobRuntime,
    workflow: blsScheduleAndLatestValues,
    readEnabled: async () => (await calendarProfiles.list()).some(profile => profile.providerId === 'macro-calendar-bls' && profile.enabled),
    now: () => new Date()
  })
  const macroCalendarProviderSettings = createMacroCalendarProviderSettingsService({
    profiles: calendarProfiles,
    health: macroCalendarBackend.healthStore,
    jobs: macroCalendarJobs
  })
  // The product owner decision is that every calendar source refreshes without a
  // manual step, so credential-free providers are enrolled before the schedules
  // are registered. Providers whose runtime dependency is missing this boot are
  // never enabled, and an already-enabled provider keeps its own timestamp.
  const readyCalendarProviders = [
    'macro-calendar-fed',
    ...(macroCalendarBackend.beaOfficialReleaseRefresh ? ['macro-calendar-bea' as const] : []),
    ...(macroCalendarBackend.blsEmploymentSchedule ? ['macro-calendar-bls' as const] : [])
  ] as const
  syncMarketCalendarSchedule = () => marketCalendarScheduler.syncSchedule()
  void marketCalendarScheduler.initialize()
  blsScheduleAndValuesScheduler.initialize()
  void autoEnrollCalendarProviders({ profiles: calendarProfiles, readyProviderIds: readyCalendarProviders })
    .then(() => {
      void macroCalendarJobs.initialize()
      return beaOfficialReleaseJobs?.initialize()
    })
    .catch(() => undefined)
  deps.registerProductDisposer?.(async () => {
    // The gold stream closes first: it must not survive the module whose store it reports against.
    await intelligenceModule.macroMarketLive.dispose()
    crossAssetIndexRuntime?.dispose()
    await crossAssetRuntime?.dispose()
    crossAssetStore?.close()
    marketCalendarScheduler.dispose()
    blsScheduleAndValuesScheduler.dispose()
    await marketCalendar.dispose()
    await beaOfficialReleaseJobs?.dispose()
    macroCalendarJobs.dispose()
    macroCalendarBackend.dispose()
    intelligenceModule.marketAnalysisRuntime.dispose()
  })
  deps.registerProductCache('market-intelligence', {
    cacheId: 'market-intelligence.translation-records',
    displayName: 'Translation records',
    displayNameI18n: {
      'zh-CN': '翻译记录',
      'en-US': 'Translation records'
    },
    description: 'Derived translation records for localized intelligence display text.',
    descriptionI18n: {
      'zh-CN': '用于情报展示本地化文本的派生翻译记录。',
      'en-US': 'Derived translation records for localized intelligence display text.'
    },
    category: 'derived-data',
    cacheKind: 'json-file',
    durability: 'persisted-derived',
    sensitivity: 'contains-user-content',
    clearable: true,
    compactable: true,
    backupPolicy: 'exclude',
    warnings: ['This cache only stores derived translations. Raw source records and intelligence evidence are not cleared here.'],
    warningsI18n: [
      {
        'zh-CN': '这里只保存派生翻译结果，不会清理原始来源记录或情报证据。',
        'en-US': 'This cache only stores derived translations. Raw source records and intelligence evidence are not cleared here.'
      }
    ],
    provider: {
      inspect: async () => {
        const records = await intelligenceModule.translationService.listRecords()
        const latestTranslatedAt = records
          .map((record) => (record.translatedAt ? Date.parse(record.translatedAt) : Number.NaN))
          .filter((value) => Number.isFinite(value))
          .sort((left, right) => right - left)[0]
        return {
          cacheId: 'market-intelligence.translation-records',
          status: records.length > 0 ? 'ready' : 'empty',
          recordCount: records.length,
          sizeBytes: Buffer.byteLength(JSON.stringify(records), 'utf8'),
          lastUpdatedAt: Number.isFinite(latestTranslatedAt) ? new Date(latestTranslatedAt).toISOString() : undefined,
          rebuildable: true,
          message: 'Translation display records can be regenerated from product-owned source items.'
        }
      },
      clear: async ({ dryRun }) => {
        const records = await intelligenceModule.translationService.listRecords()
        const removedBytes = Buffer.byteLength(JSON.stringify(records), 'utf8')
        if (dryRun === true) {
          return {
            cacheId: 'market-intelligence.translation-records',
            operation: 'clear',
            dryRun: true,
            status: records.length > 0 ? 'skipped' : 'succeeded',
            removedBytes,
            removedRecords: records.length,
            message: records.length > 0 ? 'Dry run only. Translation records would be cleared.' : 'Cache is already empty.'
          }
        }
        await intelligenceModule.translationService.replaceRecords([])
        return {
          cacheId: 'market-intelligence.translation-records',
          operation: 'clear',
          dryRun: false,
          status: 'succeeded',
          removedBytes,
          removedRecords: records.length,
          message: records.length > 0 ? 'Translation records cache cleared.' : 'Translation records cache was already empty.'
        }
      },
      compact: async ({ dryRun }) => {
        const records = await intelligenceModule.translationService.listRecords()
        if (dryRun === true) {
          const result = await intelligenceModule.translationService.previewCompaction({ retentionMode: 'balanced' })
          return {
            cacheId: 'market-intelligence.translation-records',
            operation: 'compact',
            dryRun: true,
            status: result.removedCount > 0 ? 'skipped' : 'succeeded',
            removedRecords: result.removedCount,
            removedBytes: Buffer.byteLength(JSON.stringify(records), 'utf8'),
            message:
              result.removedCount > 0
                ? 'Dry run only. Translation records would be compacted.'
                : 'No stale translation records need compaction.'
          }
        }
        const result = await intelligenceModule.translationService.compactDerivedRecords({ retentionMode: 'balanced' })
        return {
          cacheId: 'market-intelligence.translation-records',
          operation: 'compact',
          dryRun: false,
          status: 'succeeded',
          removedRecords: result.removedCount,
          removedBytes: Buffer.byteLength(JSON.stringify(records), 'utf8'),
          message:
            result.removedCount > 0 ? 'Translation records compaction finished.' : 'No stale translation records needed compaction.'
        }
      }
    }
  })

  registerIntelligenceIpc(register, deps.jobRuntime)
  registerIntelligencePublicQueryIpc(register, deps.jobRuntime)
  registerIntelligenceSourcesIpc(register, deps.jobRuntime)
  registerDashboardSourceConnectionIpc(register, createDashboardSourceConnectionService())
  registerIntelligenceTranslationIpc(register, deps.jobRuntime)
  registerMarketAnalysisIpc(register, intelligenceModule.marketAnalysisRuntime.repository, {
    // The same two queries the analysis macro route reads, so an event's context matches it.
    queryMacroEconomicCalendarMonth: macroEconomicCalendarQueryService.queryMonth,
    queryMarketCalendarMonth: marketCalendar.queryMonth
  }, {
    ...deps,
    requestInitialAnalysis: intelligenceModule.marketAnalysisRuntime.requestInitialAnalysis,
    getAnalysisSettings: intelligenceModule.marketAnalysisRuntime.getSettings,
    updateAnalysisSettings: intelligenceModule.marketAnalysisRuntime.updateSettings
  })
  registerDailyBriefingIpc(register, intelligenceModule.dailyBriefingService, intelligenceModule.dailyBriefingAiSettings)
  // Read-only startup diagnostic. The timeline renders the same empty state for "the
  // table is empty" and "the read failed", so the main process states the count it
  // can actually read. Counts only: no row contents and no credentials.
  try {
    const analysisRepository = intelligenceModule.marketAnalysisRuntime.repository
    console.log(JSON.stringify({
      marker: 'MI_ANALYSIS_READ_DIAGNOSTIC',
      timeline: analysisRepository.listTimeline({ limit: 50 }).items.length,
      groups: analysisRepository.listEventGroups().length,
      runs: analysisRepository.listRuns().length,
      newestTimelineAt: analysisRepository.listTimeline({ limit: 1 }).items[0]?.occurredAt ?? null
    }))
  } catch (error) {
    console.log(JSON.stringify({ marker: 'MI_ANALYSIS_READ_DIAGNOSTIC', state: 'failed', errorCode: error instanceof Error ? error.message : 'unknown' }))
  }
  registerPolicyPathIpc(register, policyPathQueryService)
  registerMacroEconomicCalendarIpc(register, macroCalendarBackend.repository, macroCalendarBackend.manualBlsIcs, macroCalendarProviderSettings, {
    ...macroCalendarBackend,
    releaseTimeOverrides: macroCalendarBackend.releaseTimeOverrides,
    releaseTimeOverrideStore: macroCalendarBackend.releaseTimeOverrideStore
  }, blsEmploymentMvpRefresh, blsScheduleAndLatestValues, macroCalendarBackend.fedFomcRefresh, marketCalendar)
  // The dashboard's 市场状态 block reads the collected macro series (synthetic dollar, gold) here.
  // Gold's 最新 cell additionally reads the live tick, which is reported beside the stored level and
  // is read by no window: the returns in this snapshot are computed from stored points alone.
  const macroMarketSnapshot = createMacroMarketSnapshotQuery({
    store: intelligenceModule.macroMarket.store, now: Date.now, live: intelligenceModule.macroMarketLive.snapshot
  })
  registerMacroMarketIpc(register, { snapshot: macroMarketSnapshot.snapshot, readiness: intelligenceModule.macroMarketReadiness })
  // The 来源状态 strip names each feed separately, so it needs each source's own switch, credential and
  // last outcome rather than the one line the snapshot carries. Read-only, and it re-parses its own
  // answer through the public boundary.
  registerDashboardFeedStatusIpc(register, intelligenceModule.dashboardFeedStatus)
  // The same block's two rate rows read the FRED metric events the generic collector stored: official
  // daily closes, so every reading carries its observation date and the `official-daily-close` caveat.
  const macroRatesSnapshot = createMacroRatesSnapshotQuery({ listMetricEvents: () => intelligenceModule.pipeline.listMetricEvents() })
  registerMacroRatesIpc(register, { snapshot: macroRatesSnapshot.snapshot })
  // 口径查询：只读、无依赖（内核是纯函数），agent 侧按需问"这个数从哪来"用。
  registerProvenanceIpc(register)
  // The analysis reads the same two snapshots the panel reads, through the public query service rather
  // than through the IPC handlers: one producer, one shape, and no second read path that could drift
  // from the table the reader is looking at.
  intelligenceModule.publicQueryService.setMacroMarketSnapshotQuery({ snapshot: macroMarketSnapshot.snapshot })
  intelligenceModule.publicQueryService.setMacroRatesSnapshotQuery({ snapshot: macroRatesSnapshot.snapshot })
  // Start only now that the socket constructor is bound: a first reconcile before this would fail
  // once and then sit in backoff for a whole profile-check interval.
  void intelligenceModule.macroMarketLive.reconcile().catch(() => undefined)
  // The agent write surface reaches these two runtimes only through the facades below. The calendar
  // writes are the same functions `registerMacroEconomicCalendarIpc` calls (one factory, one result
  // boundary), and the three reads are what the audit records before/after and what the calendar
  // revision hashes. The cross-asset lease runtime stays the single implementation too.
  const macroCalendarWriteActions = createMacroCalendarWriteActions({
    manualBlsIcs: macroCalendarBackend.manualBlsIcs,
    providerSettings: macroCalendarProviderSettings,
    connection: {
      testProviderConnection: macroCalendarBackend.testProviderConnection,
      releaseTimeOverrides: macroCalendarBackend.releaseTimeOverrides,
      releaseTimeOverrideStore: macroCalendarBackend.releaseTimeOverrideStore
    },
    blsEmploymentRefresh: blsEmploymentMvpRefresh,
    blsEmploymentSchedule: blsScheduleAndLatestValues,
    fedFomcRefresh: macroCalendarBackend.fedFomcRefresh
  })
  const macroCalendarOps: MacroCalendarOps = {
    saveProviderProfile: (input) => macroCalendarWriteActions.saveProviderProfile(input),
    runProviderNow: (providerId) => macroCalendarWriteActions.runProviderNow({ providerId }),
    testProviderConnection: (providerId) =>
      macroCalendarWriteActions.testProviderConnection({ providerId }),
    setReleaseTime: (input) => macroCalendarWriteActions.setReleaseTime(input),
    clearReleaseTime: (eventKey) => macroCalendarWriteActions.clearReleaseTime({ eventKey }),
    refreshBlsEmployment: (input) => macroCalendarWriteActions.refreshBlsEmployment(input),
    refreshFedFomc: (input) => macroCalendarWriteActions.refreshFedFomc(input),
    syncBlsSchedule: (input) => macroCalendarWriteActions.syncBlsSchedule(input),
    previewManualIcs: (input) => macroCalendarWriteActions.previewManualIcs(input),
    importManualIcs: (input) => macroCalendarWriteActions.importManualIcs(input),
    readConfiguration: async () => {
      const [profiles, overrides] = await Promise.all([
        calendarProfiles.list(),
        macroCalendarBackend.releaseTimeOverrideStore.list()
      ])
      return {
        providers: Object.fromEntries(
          profiles.map((profile) => [profile.providerId, profile.enabled === true])
        ),
        releaseTimes: Object.fromEntries(
          overrides.map((override) => [
            override.eventKey,
            { scheduledAt: override.scheduledAt, scheduledDate: override.scheduledDate }
          ])
        )
      }
    },
    readProviderState: async (providerId) => {
      const profiles = await calendarProfiles.list()
      const profile = profiles.find((candidate) => candidate.providerId === providerId)
      return profile ? profile.enabled === true : null
    },
    readReleaseTime: async (eventKey) => {
      const override = await macroCalendarBackend.releaseTimeOverrideStore.get(eventKey)
      return override
        ? { scheduledAt: override.scheduledAt, scheduledDate: override.scheduledDate }
        : null
    }
  }
  const crossAssetOps: CrossAssetOps = {
    acquire: async () => (crossAssetRuntime ? crossAssetRuntime.acquire() : { state: 'unavailable' as const }),
    renew: async (leaseId) => (crossAssetRuntime ? crossAssetRuntime.renew(leaseId) : { state: 'unavailable' as const }),
    release: async (leaseId) => (crossAssetRuntime ? crossAssetRuntime.release(leaseId) : { state: 'unavailable' as const }),
    refresh: async (leaseId) => (crossAssetRuntime ? crossAssetRuntime.refresh(leaseId) : { state: 'unavailable' as const }),
    testInterface: async () => (crossAssetRuntime ? crossAssetRuntime.testInterface() : { state: 'unavailable' as const }),
    cancelInterfaceTest: async () =>
      crossAssetRuntime ? crossAssetRuntime.cancelInterfaceTest() : ({ state: 'unavailable' as const }),
    readConfiguration: () => crossAssetConfiguration.read(),
    readLeaseState: async () => crossAssetRuntime?.leaseState() ?? 'unknown'
  }
  registerIntelligenceAgentToolHandlers(deps.registerProductAgentToolHandler, {
    jobRuntime: deps.jobRuntime,
    getAppLanguage: deps.getAppLanguage,
    macroCalendarOps,
    crossAssetOps
  })
}
