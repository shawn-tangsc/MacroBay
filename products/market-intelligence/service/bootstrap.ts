import type { ProductIpcRegistrar } from '@platform/desktop/ipc/productIpcRegistry'
import type { JobRuntime } from '@platform/jobs'
import { getNotificationRuntime } from '@platform/notifications'
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
import { registerMarketRetention } from './intelligence/retention/registerMarketRetention'
import { createCrossAssetRuntime } from './intelligence/cross-asset/crossAssetRuntime'
import { createBinanceCrossAssetClient } from './intelligence/cross-asset/binanceCrossAssetClient'
import { createBinanceCrossAssetStream } from './intelligence/cross-asset/binanceCrossAssetStream'
import { createCrossAssetSourceConfiguration } from './intelligence/cross-asset/crossAssetSourceConfiguration'
import { createCrossAssetSnapshotQuery } from './intelligence/cross-asset/crossAssetSnapshotQuery'
import { createCrossAssetIndexRuntime } from './intelligence/cross-asset/crossAssetIndexRuntime'
import { crossAssetPolicy } from './intelligence/cross-asset/crossAssetPolicy'
import { installBriefMarketBackfill } from './intelligence/daily-briefing/dailyBriefMarketBackfill'
import { registerCrossAssetIpc } from './intelligence/cross-asset/registerCrossAssetIpc'

import { currentReaderTimeZone, getIntelligenceModule, getIntelligenceProductDataDir } from './intelligence/intelligenceModule'
import { registerIntelligenceIpc } from './intelligence/ipc/registerIntelligenceIpc'
import { createNotificationTestWiring } from './intelligence/ipc/notificationTestWiring'
import { createEnabledCalendarFeeds, createEnabledZeroXRouterFeeds } from './intelligence/macro-calendar/enabledCalendarFeeds'
import { registerIntelligencePublicQueryIpc } from './intelligence/ipc/registerIntelligencePublicQueryIpc'
import { registerIntelligenceSourcesIpc } from './intelligence/ipc/registerIntelligenceSourcesIpc'
import { registerDashboardSourceConnectionIpc } from './intelligence/ipc/registerDashboardSourceConnectionIpc'
import { registerIntelligenceTranslationIpc } from './intelligence/ipc/registerIntelligenceTranslationIpc'
import { wireCalendarReadings } from './wiring/calendarReadings'
import { wireZeroXRouterCalendarSchedule } from './wiring/zeroXRouterCalendarSchedule'
import { scheduleHistoricalValueFill, syncOfficialStandardRowsAtStartup } from './wiring/calendarStandardRows'
import { wireCrossAsset } from './wiring/crossAsset'
import { registerTranslationRecordsCache } from './wiring/translation'
import { newsInterpretationWiring, registerMarketAnalysisIpc } from './intelligence/ipc/marketAnalysisIpc'
import { registerDailyBriefingIpc } from './intelligence/ipc/registerDailyBriefingIpc'
import type { ProductAgentPlatformDeps } from '@platform/desktop/main/productAgentPlatformWiring'
import type { AnalysisSessionDependencies } from './intelligence/analysis/analysisFollowUpSession'
import { createRunSessionPortFromDeps } from './intelligence/jobs/analysisRunSessionWiring'
import { mountSignalAnalysisReader } from './intelligence/signals/mountSignalAnalysisReader'
import { registerIntelligenceAgentToolHandlers } from './intelligence/agent-capabilities/handlerRegistry'
import type {
  CrossAssetOps,
  MacroCalendarOps
} from './intelligence/agent-capabilities/operationFacades'
import { createMacroCalendarScheduleBackend } from './intelligence/macro-calendar/macroCalendarScheduleBackend'
import { landedFilterReader, registerCalendarEventReminder } from './intelligence/macro-calendar/registerCalendarEventReminder'
import { createCalendarReminderSettingsStore } from './intelligence/macro-calendar/calendarEventReminderSettingsStore'
import { createPolicyPathQueryService } from './intelligence/policy-path/policyPathQueryService'
import { registerPolicyPathIpc } from './intelligence/policy-path/ipc/registerPolicyPathIpc'
import { createMacroIndicatorReadService } from './intelligence/macro-calendar/macroIndicatorReadService'
import { registerMacroIndicatorIpc } from './intelligence/macro-calendar/ipc/registerMacroIndicatorIpc'
import { createFredObservationsFetcher, readFredIndicatorYoY, readFredObservationForPeriod } from './intelligence/macro-calendar/fredIndicatorYoY'
import { readNextReleaseForMetric } from './intelligence/macro-calendar/marketCalendarStandardMonthRead'
import { readStandardActuals } from './intelligence/macro-calendar/macroIndicatorStandardActuals'
import { readPolymarketConsensus } from './intelligence/macro-calendar/polymarketConsensus'
import { registerSyncRunIpc } from './intelligence/audit/ipc/registerSyncRunIpc'
import { readPublishedTargetRange } from './intelligence/policy-path/readPublishedTargetRange'
import { createSyncAuditStoreIfAvailable } from './intelligence/audit/syncAuditStore'
import { withSyncAudit } from './intelligence/audit/syncAuditRecorder'
import { createPolicyPathRuntime } from './intelligence/policy-path/policyPathRuntime'
import { createMacroEconomicCalendarQueryService } from './intelligence/macro-calendar/macroEconomicCalendarQueryService'
import { createMacroCalendarScheduleJobRuntime } from './intelligence/macro-calendar/macroCalendarScheduleJobRuntime'
import { getPlatformFetch } from '@platform/network/platformFetch'
import { allSources } from './intelligence/application/providerRegistry'
import { dualWriteMeasureRows } from './intelligence/macro-calendar/marketCalendarStandardDualWrite'
import { ensureCalendarStandardTables, recordCalendarUnmapped } from './intelligence/macro-calendar/marketCalendarStandardTable'
import { promoteSourceIdentities } from './intelligence/macro-calendar/marketCalendarSourcePromotion'
import { marketCalendarCodeTable, marketCalendarCodeTableMeta } from './intelligence/macro-calendar/marketCalendarCodeTable'
import { marketCalendarCountryCodeTable } from './intelligence/macro-calendar/marketCalendarCountryCodeTable'
import { recomputeUnmappedReasons } from './intelligence/macro-calendar/marketCalendarUnmappedReasonBackfill'
import { syncOfficialStandardRows } from './intelligence/macro-calendar/marketCalendarOfficialSourceRows'
import { createStandardMonthPageReader } from './intelligence/macro-calendar/marketCalendarStandardMonthPage'
import { eventTypeNameByCode, nameByMetricKey } from './intelligence/macro-calendar/marketCalendarCodeNames'
import { narwhalSourcePolicy } from './intelligence/application/narwhalSourcePolicy'
import { calendarStandardConservation } from './intelligence/macro-calendar/marketCalendarStandardConservation'
import { createNarwhalCalendarAssembly } from './intelligence/macro-calendar/narwhal-calendar/narwhalCalendarAssembly'
import { createNarwhalCalendarBriefingRefresh }
  from './intelligence/macro-calendar/narwhal-calendar/narwhalCalendarBriefingCatchUp'
import { readStandardTableLastWrittenAt }
  from './intelligence/macro-calendar/marketCalendarFreshnessFromJobs'
import { requestMarketAnalysisForCalendarUpdate } from './intelligence/jobs/marketAnalysisCalendarUpdateTrigger'
import { createBeaOfficialReleaseJobRuntime } from './intelligence/macro-calendar/bea-official-release/beaOfficialReleaseJobRuntime'
import { createMacroCalendarProviderSettingsService } from './intelligence/macro-calendar/macroCalendarProviderSettingsService'
import { createUnifiedMacroCalendarProfileStore } from './intelligence/macro-calendar/macroCalendarUnifiedProfileStore'
import { registerMacroEconomicCalendarIpc } from './intelligence/macro-calendar/ipc/registerMacroEconomicCalendarIpc'
import { createMacroCalendarProviderProfileJsonStorage, createMacroCalendarProviderProfileStore } from './intelligence/macro-calendar/macroCalendarProviderProfileStore'
import { createMacroCalendarWriteActions } from './intelligence/macro-calendar/macroCalendarWriteActions'
import { registerMacroMarketIpc, registerDashboardFeedStatusIpc } from './intelligence/macro-market/ipc/registerMacroMarketIpc'
import { createMacroMarketSnapshotQuery } from './intelligence/macro-market/macroMarketSnapshotQuery'
import { registerMacroRatesIpc } from './intelligence/macro-rates/ipc/registerMacroRatesIpc'
import { createMacroHistoryAsOfQuery } from './intelligence/public-query/macroHistoryAsOf'
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
import { composeStoredManualCalendar } from './intelligence/macro-calendar/0xrouter-calendar/storedCalendarComposition'
import { createSampleModeRuntime } from './demo/demoModule'

const blsApiCompatibilityHost = createBlsApiCompatibilityHost()
const blsPythonRequestsBridge = createBlsPythonRequestsBridge({})

/**
 * 产品启动依赖 = 宿主注入面 + 产品自己的会话端口 + **平台的智能体会话契约**。
 *
 * 第三项过去是这里自己抄的一份（字段相同、名字不同），两次因为两边漂移而红；
 * 现在形状只有一个出处：`ProductAgentPlatformDeps`。与 `AnalysisSessionDependencies` 的交集是有意的——
 * 那个端口只关心 `{ sessions }` 与 `SessionRef`，比契约更窄，窄的那一份各自留在自己的模块里。
 */
export type ProductBootstrapDependencies = AnalysisSessionDependencies & ProductAgentPlatformDeps & {
  register: ProductIpcRegistrar
  jobRuntime: JobRuntime
  eventBusRuntime: EventBusRuntime
  getProviderState?: () => Promise<ProviderState>
  getAppLanguage?: () => Promise<'zh-CN' | 'en-US'>
  /** 模型服务页「默认模型」只读投影（翻译偏好跟随其中的默认翻译模型）。 */
  getModelDefaults?: () => Promise<ModelDefaultsSettings>; /** Reader zone: schedule and day boundary follow it. */ getTimeZone: () => string
  registerProductAgentToolHandler: (registration: ProductAgentToolHandlerRegistration) => void
  registerProductCache: ProductCacheRegistrar
  registerProductDisposer?: ProductServiceDisposerRegistrar
  secretVault?: SecretVault
  platformFetch?: typeof fetch
  getNetworkSettings?: () => Promise<NetworkSettings>
  log?: (level: 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>) => void
  onSettingsCommitted?: (listener: (change: Readonly<{ changedKeys: readonly string[]; next: Readonly<{ timeZone: string }> }>) => void) => () => void
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
  // A product-owned job arms its own schedule from the switch; the module only forwards the event.
  const sourceEnableListeners = new Map<string, () => void>()
  const platformFetch = deps.platformFetch ?? (() => { throw new Error('market-intelligence-platform-fetch-required') })
  const intelligenceModule = getIntelligenceModule(deps.jobRuntime, {
    ...(deps.log ? { log: deps.log } : {}),
    getProviderState: deps.getProviderState,
    getAppLanguage: deps.getAppLanguage,
    getModelDefaults: deps.getModelDefaults, getTimeZone: deps.getTimeZone,
    eventBusRuntime: deps.eventBusRuntime,
    platformFetch,
    createAgentSession: deps.createAgentSession,
    findAgentSessionByAutomationRef: deps.findAgentSessionByAutomationRef,
    sendAgentMessage: deps.sendAgentMessage,
    cancelAgentSession: deps.cancelAgentSession,
    appendAgentSessionMessages: deps.appendAgentSessionMessages,
    updateAgentSession: deps.updateAgentSession,
    deleteAgentSessions: deps.deleteAgentSessions,
    updateAgent: deps.updateAgent,
    isWebSearchProviderReady: deps.isWebSearchProviderReady,
    // 通知运行时是平台单例，等用的时候再取：装配完成在注册产品服务之后。
    submitNotification: async (request) => getNotificationRuntime().submit(request),
    // 读者点「推送到手机」时走这条：平台只重投那一条已有记录，不新建、不改内容。
    redeliverPush: (input) => getNotificationRuntime().redeliverPush(input),
    // The gold price stream needs the proxy-aware platform socket, and the shell can only build that
    // once network settings are readable — so it is handed over as a thunk, never as a raw WebSocket.
    ...(deps.getNetworkSettings
      ? { createPlatformWebSocket: () => createPlatformWebSocketFactory({ getNetworkSettings: deps.getNetworkSettings! }) }
      : {}),
    ...(deps.onSettingsCommitted ? { onSettingsCommitted: deps.onSettingsCommitted } : {}), onCalendarEnabledChanged: () => { void narwhalCalendarAssembly?.syncSchedule() },
    // 读者一拨开关，产品自有作业就跟着排期/撤期（`sourceEnableListeners` 在下面装配时登记）。
    // 通用采集作业与宏观市场、DXY、Nasdaq 100 那几条不由这里管：它们的闸是服务里的同一处。
    onSourceEnabledChanged: (sourceId) => { sourceEnableListeners.get(sourceId)?.() }
  })
  // A reader who changes their display zone means "08:05 is my 08:05 from now on", and they will not
  // also open the briefing setting to press save. The platform tells us after the new zone is in
  // effect, and the module moves its stored zone and re-registers the run.
  // 退出示例后按既有 profile 重新注册调度：与启动走同一条编排，不复制一份调度逻辑。
  resumeProductWork = async () => {
    await intelligenceModule.sourcesService.initializeRuntime()
    await intelligenceModule.marketAnalysisRuntime.startRecovery()
  }
  // One switch store for both readers: the settings panel writes the unified profile, and the
  // collector must read that same flag or it reports the provider as disabled behind an enabled UI.
  // The legacy file stays only as the pre-migration fallback for installations that still hold it.
  const legacyCalendarProfiles = createMacroCalendarProviderProfileStore(
    createMacroCalendarProviderProfileJsonStorage(join(getIntelligenceProductDataDir(), 'macro-calendar-provider-profiles.json'))
  )
  const calendarProfiles = createUnifiedMacroCalendarProfileStore(intelligenceModule.sourceProfileStore, legacyCalendarProfiles)
  const macroCalendarBackend = createMacroCalendarScheduleBackend({
    dataDir: getIntelligenceProductDataDir(),
    rawRecords: intelligenceModule.rawRecordStore,
    blsScheduleBridge: blsPythonRequestsBridge,
    evidenceArchive: intelligenceModule.macroCalendarEvidenceArchive,
    evidenceReady: intelligenceModule.macroCalendarEvidenceReady,
    profiles: calendarProfiles,
    // 采集失败的现场必须进主进程日志：`console.warn` 走 stdout，打包后直接丢。
    ...(deps.log === undefined ? {} : { log: deps.log })
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
    observations: macroCalendarBackend.repository.policyObservations,
    marketLinks: macroCalendarBackend.repository.policyMarketLinks,
    // The parsed statement wins when it exists; between meetings the published FRED series is the
    // only current source of the range.
    readTargetRange: () => readPublishedTargetRange(intelligenceModule.pipeline.listMetricEvents())
  })
  intelligenceModule.setPolicyPathQuery(policyPathQueryService)
  policyPathRuntime.start()
  sourceEnableListeners.set('policy-path-market', () => { void policyPathRuntime.sync() })
  const {
    crossAssetConfiguration, crossAssetStore, crossAssetRuntime, crossAssetIndexRuntime, crossAssetQuery
  } = wireCrossAsset({ register, deps, intelligenceModule, productDataDir: getIntelligenceProductDataDir() })
  const blsEmploymentMvpRefresh = createBlsEmploymentMvpRefreshService({
    valuesBridge: blsPythonRequestsBridge,
    evidence: intelligenceModule.macroCalendarEvidenceReady
      ? createBlsEmploymentMvpEvidence({ archive: intelligenceModule.macroCalendarEvidenceArchive })
      : undefined,
    repository: macroCalendarBackend.repository,
    now: () => new Date().toISOString()
  })
  // 只刷读者没关掉的 feed（没建过档案默认开）；规则在日历域的 `enabledCalendarFeeds`。
  const readEnabledCalendarFeeds = createEnabledCalendarFeeds({
    listProfiles: () => intelligenceModule.sourceProfileStore.listProfiles()
  })
  // 「事件发生后也告诉我」那一行要真的影响落地通知：配置只存一处，日历经这个读取器拿它。
  const calendarReminderSettings = createCalendarReminderSettingsStore(
    join(getIntelligenceProductDataDir(), 'calendar-event-reminder.json')
  )
  const marketCalendar = composeStoredManualCalendar({ storage: macroCalendarBackend.storage,
    archive: intelligenceModule.macroCalendarEvidenceArchive, evidenceReady: intelligenceModule.macroCalendarEvidenceReady,
    requestGovernanceQueue: intelligenceModule.requestGovernanceQueue,
    readEnabledFeeds: readEnabledCalendarFeeds,
    // 「立刻跑一次日历采集」＝排一次 tick 作业，**拿到句柄才算触发**（失败不吞，返回 failed）。
    // 用 enqueueManual 而不是 enqueueDefinition：后者要在这里保留一份作业定义，那是第二个真相源。
    triggerCollection: async () => {
      try {
        await deps.jobRuntime.enqueueManual('market-intelligence.refreshNarwhalCalendarTick.automatic')
        return 'triggered' as const
      } catch { return 'failed' as const }
    },
    jobRuntime: deps.jobRuntime,
    // 读取器在提醒模块里，bootstrap 只传引用（这份文件的体积基线只许变小，逻辑不往这里堆）。
    readLandedFilter: landedFilterReader(calendarReminderSettings),
    ...intelligenceModule.calendarManualDependencies })
  const zeroXRouterSchedule = wireZeroXRouterCalendarSchedule({ jobRuntime: deps.jobRuntime, database: macroCalendarBackend.storage.database, refreshAutomatic: (feeds) => marketCalendar.refreshAutomatic(feeds), readReadiness: intelligenceModule.calendarManualDependencies.readReadiness, readEnabledFeeds: createEnabledZeroXRouterFeeds({ listProfiles: () => intelligenceModule.sourceProfileStore.listProfiles() }), ...(deps.log === undefined ? {} : { log: deps.log }) })
  // The analysis macro route reads the 0xRouter observations through the same public page
  // service the calendar page uses, so both routes share one admission and one projection.
  // Freshness rides on the same binding: the age is computed once, in the calendar runtime.
  // 日历读侧（标准表月查询 + 新鲜度 + 提醒 + 日报补跑）整段在 wiring/calendarReadings.ts。
  const { standardCalendarReader, calendarReminder } = wireCalendarReadings({
    database: macroCalendarBackend.storage.database,
    jobRuntime: deps.jobRuntime,
    calendarReminderSettings,
    intelligenceModule,
    submitNotification: async (request) => getNotificationRuntime().submit(request),
    timeZone: () => currentReaderTimeZone()
  })
  const blsScheduleAndLatestValues = createBlsScheduleAndLatestValuesSyncWorkflow({
    schedule: macroCalendarBackend.blsEmploymentSchedule,
    repository: macroCalendarBackend.repository,
    refresh: blsEmploymentMvpRefresh,
    now: () => new Date().toISOString()
  })
  const macroCalendarJobs = createMacroCalendarScheduleJobRuntime({
    jobRuntime: deps.jobRuntime,
    profiles: calendarProfiles,
    health: macroCalendarBackend.health,
    ...(deps.log === undefined ? {} : { log: deps.log }),
    releaseValues: { database: macroCalendarBackend.storage.database, readActual: async (metricKey, periodKey) => (await readFredObservationForPeriod(metricKey, periodKey, fredObservations))?.value }
  })
  const beaOfficialReleaseJobs = macroCalendarBackend.beaOfficialReleaseRefresh ? createBeaOfficialReleaseJobRuntime({ jobRuntime: deps.jobRuntime, profiles: calendarProfiles, refresh: macroCalendarBackend.beaOfficialReleaseRefresh }) : undefined
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
  // **码表只审计、不导入**（用户 2026-11-18 选 A）：文件是唯一真源，运行时只读内存表；
  // 这一行让「这一版带的是哪张码表」在 app.log 里查得到，而库内不建副本、不搞同步。
  deps.log?.('info', 'macro-calendar.code-table', {
    version: marketCalendarCodeTableMeta?.version ?? null,
    contentHash: marketCalendarCodeTableMeta?.contentHash ?? null,
    rows: Object.keys({ ...marketCalendarCodeTable, ...marketCalendarCountryCodeTable }).length,
    source: 'file'
  })
  // 启动同步官方发布进标准表，失败不阻断启动（详见 wiring/calendarStandardRows.ts，吞错语义不变）。
  // 历史补值也挂这一点：`after` 是模块启动完成信号，`readLatest` 是惰性闭包（FRED fetcher 建在后面）。
  syncOfficialStandardRowsAtStartup({
    database: macroCalendarBackend.storage.database,
    listEffectiveMonthAsOf: macroCalendarBackend.repository.listEffectiveMonthAsOf,
    after: intelligenceModule.startupReady,
    readLatest: (metricKey, periodKey) => readFredObservationForPeriod(metricKey, periodKey, fredObservations),
    // 启动迁移的每一步都要能在 `app.log` 里查到：主进程的 `console.warn` 不写进那份日志。
    ...(deps.log === undefined ? {} : { log: deps.log })
  })
  // Narwhal 日历：装配零件只差三行（构造 / initialize / dispose），细节全在工厂里。
  let narwhalCalendarAssembly: ReturnType<typeof createNarwhalCalendarAssembly> | undefined
  narwhalCalendarAssembly = createNarwhalCalendarAssembly({
    jobRuntime: deps.jobRuntime,
    repository: macroCalendarBackend.repository,
    // **观测表停写**（2026-11-14 定）：日历已改读标准表，三处可能的读方逐处核过——证据抽屉走
    // 联动共识（新读取模型）、其余读方都在要删的旧源目录里、存储盘点只数行不读内容。
    // **只停写、不删历史行**：`mi_macro_calendar_market_event_observations` 里的行原样留着，
    // 少写的只是「同一批采集顺便多写一份」。
    // 标准行按 measure 拆：一次发布里的每个 measure 各一行，身份各算各的。
    appendStandardRows: (rows, unmapped, sourceTotals) => {
      try {
        const database = macroCalendarBackend.storage.database
        ensureCalendarStandardTables(database)
        const observedAt = new Date().toISOString()
        // **启动/采集前先转正存量**：补映射之前写进去的 `source` 行，现在算得出身份的就地改码。
        // 只报三个数、不上界面；dryRun 的入口给补完映射后先看数用。
        const promotion = promoteSourceIdentities(database)
        if (promotion.scanned > 0) {
          console.warn(`[macro-calendar] 源内身份转正：扫描 ${promotion.scanned} / 转正 ${promotion.promoted} / 仍无身份 ${promotion.stillSource}`)
        }
        // **原因也要自己保持正确**（2026-11-18 用户定）：`missing-country` 是写入那一刻的原因，
        // 国家后来补上、码后来建出来，那一行却还挂着旧原因，盘点读到的永远是假数。转正之后再重算，
        // 顺序不能反：转正会删掉清单里的过期条目，先重算会把「已转正」算成缺码。幂等，跑前备份。
        const reasons = recomputeUnmappedReasons(database)
        if (reasons.deleted > 0 || reasons.updated > 0) {
          const detail = Object.entries(reasons.counts).map(([reason, count]) => `${reason} ${count}`).join(' / ')
          console.warn(`[macro-calendar] 未映射原因重算：扫描 ${reasons.scanned} / 删过期 ${reasons.deleted} / 改判 ${reasons.updated}（${detail}）`)
        }
        for (const item of unmapped) {
          // `reason` **原样落库**：这里曾用三段白名单映射，任何新原因都会被悄悄改写成
          // `unknown-event-type`（`no-values` 就会以「未知事件类型」的样子出现，指向错误的修法）。
          recordCalendarUnmapped(database, { providerId: 'narwhal', sourceKey: item.sourceKey,
            detectedAt: observedAt, rawJson: JSON.stringify({ name: item.name, measureKeys: item.measureKeys ?? [] }),
            reason: item.reason })
        }
        const counts = dualWriteMeasureRows(database, {
          providerId: 'narwhal', parserVersion: 'narwhal-calendar-mc1-v3', observedAt, rows
        }, { onError: (message) => console.warn(`[macro-calendar] 标准表写入失败：${message}`) })
        // 算式只有一份实现（`calendarStandardConservation`，带能跑红的用例）：写在这里的
        // 闭包里没人能测，而它已经错过两版（恒平、恒红）。
        const conservation = calendarStandardConservation({ sourceTotals, rows, unmapped, failed: counts.failed })
        const { releaseDiff, measureDiff } = conservation
        console.warn(`[macro-calendar] 标准行一批：发布层 输入 ${sourceTotals.releases} = 认领 ${conservation.creditedReleases}（落表∪未映射，按 id 去重）+ 失败 ${counts.failed}（差 ${releaseDiff}）；测度层 输入 ${sourceTotals.measures} = 指标行 ${conservation.landedMeasures} + 未映射 measure ${conservation.unmappedMeasures} + 事件型随行 ${conservation.excludedMeasures}（差 ${measureDiff}）`)
        if (releaseDiff !== 0) console.warn(`[macro-calendar] 发布层守恒式不成立：${releaseDiff} 条既没落表也没记未映射`)
        if (measureDiff !== 0) console.warn(`[macro-calendar] 测度层守恒式不成立：${measureDiff} 个 measure 没对上`)
        if (counts.failed > 0) console.warn(`[macro-calendar] 标准行写入失败 ${counts.failed} 条（已计入守恒式）`)
        // 三种「没有值」必须分开数：源标了已发布却没值（真缺口）、还没到发布日（排期先行）、
        // 以及**按源内身份显示**的行。混成一个数就会报出一个假缺口——今天已经数错过两次。
        const publishedNoValue = rows.filter((row) => row.status === 'published' && row.fromMeasure !== true).length
        const scheduledAhead = rows.filter((row) => row.status === 'scheduled' && row.fromMeasure !== true).length
        const sourceIdentityRows = rows.filter((row) => row.identityKind === 'source').length
        console.warn(`[macro-calendar] 身份：标准码 ${rows.length - sourceIdentityRows} 行 / 源内 ${sourceIdentityRows} 行（源内不参与跨源合并）；无值：已发布 ${publishedNoValue} 行 / 排期 ${scheduledAhead} 行；工作清单 ${unmapped.length} 条`)
      } catch (error) {
        console.warn(`[macro-calendar] 标准行接线异常（已忽略）：${(error as Error)?.message ?? 'unknown'}`)
      }
    },
    fetchImpl: getPlatformFetch(),
    getCredential: credentialRef => intelligenceModule.sourceCredentials.getByRef(credentialRef),
    // 采集前的门：读者关掉、或源还锁着（`visibility: 'pending'`），一个请求都不发。
    // 可见性读注册表（静态事实），开关读读者档案（运行时事实）；读不到就**不采**（fail-closed）。
    readSourceGate: async () => {
      const sourceId = 'macro-calendar-narwhal-economic-data'
      const source = allSources().find((candidate) => candidate.sourceId === sourceId)
      if (source === undefined) return { visibility: 'hidden', enabled: false }
      const profile = (await calendarProfiles.list()).find((candidate) => candidate.providerId === source.providerId)
      return { visibility: source.visibility, enabled: profile?.enabled === true }
    },
    now: Date.now
  })
  void narwhalCalendarAssembly.initialize()
  blsScheduleAndValuesScheduler.initialize()
  void autoEnrollCalendarProviders({ profiles: calendarProfiles, readyProviderIds: readyCalendarProviders })
    .then(() => {
      void macroCalendarJobs.initialize()
      return beaOfficialReleaseJobs?.initialize()
    })
    .catch(() => undefined)
  // Product-side audit lives beside the calendar but in its own file: it must not carry the
  // calendar's schema version or backup policy.
  const syncAudit = createSyncAuditStoreIfAvailable(join(getIntelligenceProductDataDir(), 'sync-audit.sqlite'))
  // Catch-up: the decision refresh otherwise only runs while a release window is open, so a machine
  // that was asleep on the meeting day would never collect that statement - and the policy card
  // would keep a dash where the vote belongs.
  void (async () => {
    const refresh = macroCalendarBackend.fedFomcRefresh
    if (!refresh) return
    const now = new Date().toISOString()
    const meetingDate = macroCalendarBackend.repository.policyFacts.readLatestMeeting(now)
    if (!meetingDate) return
    const decided = macroCalendarBackend.repository.policyFacts.read(meetingDate)
    // Nothing decided yet, or decided without the meeting before it: the second case is what makes
    // "hold or move" unreadable, so one refresh fills the prior statement's range.
    const hasEarlier = macroCalendarBackend.repository.policyFacts.readLatestDecisionBefore(meetingDate) !== undefined
    if (decided?.targetRange && hasEarlier) return
    // The manual refresh service wants the event key and an explicit confirmation, not a run id.
    await refresh.refresh({ eventKey: `US.FOMC.${meetingDate}`, confirmed: true })
  })().catch(() => undefined)

  deps.registerProductDisposer?.(async () => {
    // The gold stream closes first: it must not survive the module whose store it reports against.
    await intelligenceModule.macroMarketLive.dispose()
    crossAssetIndexRuntime?.dispose()
    await crossAssetRuntime?.dispose()
    crossAssetStore?.close()
    narwhalCalendarAssembly.dispose()
    blsScheduleAndValuesScheduler.dispose()
    await marketCalendar.dispose()
    await beaOfficialReleaseJobs?.dispose()
    macroCalendarJobs.dispose(); zeroXRouterSchedule.dispose()
    macroCalendarBackend.dispose()
    intelligenceModule.marketAnalysisRuntime.dispose()
    syncAudit?.close()
  })
  // 翻译记录缓存的注册细节搬到了 `wiring/translation.ts`（组合根按域拆的第一段）：这个文件每涨一行
  // 都要有人问「为什么必须在这里」。
  registerTranslationRecordsCache({
    registerProductCache: deps.registerProductCache,
    translation: intelligenceModule.translationService
  })

  // Audit the reader's own actions on the IPC seam: one place sees the payload, the duration and
  // the failure, so no service has to grow a logging dependency for it.
  const auditedRegister = syncAudit ? withSyncAudit(register, syncAudit) : register

  // 装配细节在 `ipc/notificationTestWiring.ts`：这个文件每涨一行都要有人问「为什么必须在这里」。
  registerIntelligenceIpc(register, deps.jobRuntime, intelligenceModule, calendarReminder, createNotificationTestWiring({
    readEnabledCalendarFeeds, readTimeZone: currentReaderTimeZone, getAppLanguage: deps.getAppLanguage
  }), () => getNotificationRuntime().resolvePushChannels())
  registerIntelligencePublicQueryIpc(register, deps.jobRuntime, intelligenceModule)
  registerIntelligenceSourcesIpc(auditedRegister, deps.jobRuntime, intelligenceModule, { onProfilesChanged: async () => { await zeroXRouterSchedule.syncSchedule(); await narwhalCalendarAssembly.syncSchedule() } })
  registerDashboardSourceConnectionIpc(register, createDashboardSourceConnectionService())
  registerIntelligenceTranslationIpc(register, deps.jobRuntime, intelligenceModule)
  registerMarketAnalysisIpc(register, intelligenceModule.marketAnalysisRuntime.repository, {
    // The same two queries the analysis macro route reads, so an event's context matches it.
    queryMacroEconomicCalendarMonth: macroEconomicCalendarQueryService.queryMonth,
    queryMarketCalendarMonth: standardCalendarReader.queryMonth
  }, {
    ...deps,
    // 时间线的「哪个开盘」也按设置的读者时区换算。
    timeZone: () => currentReaderTimeZone(),
    requestInitialAnalysis: intelligenceModule.marketAnalysisRuntime.requestInitialAnalysis,
    ...newsInterpretationWiring(intelligenceModule.marketAnalysisRuntime),
    getAnalysisSettings: intelligenceModule.marketAnalysisRuntime.getSettings,
    updateAnalysisSettings: intelligenceModule.marketAnalysisRuntime.updateSettings
  })
  // 自动分析会话：构造留在装配模块，这里只交依赖与时钟（固定智能体下按 runId 幂等）。
  intelligenceModule.marketAnalysisRuntime.setRunSessionPort(createRunSessionPortFromDeps(deps, {
    timeZone: () => currentReaderTimeZone(),
    log: deps.log
  }))
  // 「这条信号分析过没有」的读口：装配层这里挂一次，卡片才有状态可显示。漏挂不会报错，只会
  // 让每张卡都显示「这次没查到」，所以这一处有专门的用例断言它真的被调用。
  mountSignalAnalysisReader({
    addReader: reader => intelligenceModule.publicQueryService.addSignalAnalysisReader(reader),
    repository: intelligenceModule.marketAnalysisRuntime.repository,
    analysisOffByReader: async () => !(await intelligenceModule.marketAnalysisRuntime.getSettings()).enabled
  })
  registerDailyBriefingIpc(register, intelligenceModule.dailyBriefingService, intelligenceModule.dailyBriefingAiSettings, intelligenceModule.deleteDailyBriefingPeriod, intelligenceModule.briefingPeriods)
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
  // FRED 的 key 只从模块那份凭据存储出（`fetchText` 负责加 `api_key`），这里不碰凭据本身。
  const fredObservations = createFredObservationsFetcher((url, sourceId) => intelligenceModule.fetchText(url, sourceId))
  // 排期只问标准表一处（编一个期次会去查一个不存在的盘）；盘口走预测市场那个源的出口，
  // 它是 `authMode: none`，和 FRED 一样不在这里碰凭据。
  const standardCalendarDatabase = macroCalendarBackend.storage.database
  registerMacroIndicatorIpc(register, createMacroIndicatorReadService(macroCalendarBackend.repository, {
    readOfficialYoY: (metricKey) => readFredIndicatorYoY(metricKey, fredObservations),
    nextReleaseFor: (metricKey, asOf) => readNextReleaseForMetric(standardCalendarDatabase, { metricKey, asOf }),
    readStandardActual: (metricKey, asOf) => readStandardActuals(standardCalendarDatabase, { metricKey, asOf }),
    readMarketConsensus: (input) => readPolymarketConsensus({ ...input, fetchText: (url) => intelligenceModule.fetchText(url, 'policy-path-market') })
  }))
  registerSyncRunIpc(register, deps.jobRuntime, undefined, syncAudit, {
    // Read-only: the run log joins a task to the analysis it produced, and never writes either side.
    listRuns: () => intelligenceModule.marketAnalysisRuntime.repository.listRuns()
  })
  registerMacroEconomicCalendarIpc(auditedRegister, macroCalendarBackend.repository, macroCalendarBackend.manualBlsIcs, macroCalendarProviderSettings, {
    ...macroCalendarBackend,
    releaseTimeOverrides: macroCalendarBackend.releaseTimeOverrides, releaseTimeOverrideStore: macroCalendarBackend.releaseTimeOverrideStore
  }, blsEmploymentMvpRefresh, blsScheduleAndLatestValues, macroCalendarBackend.fedFomcRefresh, marketCalendar,
    { database: macroCalendarBackend.storage.database })
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
  // The daily brief's backfill tool reads those same two stores as of an earlier instant — the stored
  // macro-market points for the dollar and gold, and the stored FRED closes for the two 10-year yields.
  // A projection can only answer from what was already collected; this wiring adds no request.
  const macroHistoryAsOf = createMacroHistoryAsOfQuery({
    macroMarket: intelligenceModule.macroMarket.store,
    listMetricEvents: () => intelligenceModule.pipeline.listMetricEvents()
  })
  // 口径查询：只读、无依赖（内核是纯函数），agent 侧按需问"这个数从哪来"用。
  registerProvenanceIpc(register)
  // The analysis reads the same two snapshots the panel reads, through the public query service rather
  // than through the IPC handlers: one producer, one shape, and no second read path that could drift
  // from the table the reader is looking at.
  intelligenceModule.publicQueryService.setMacroMarketSnapshotQuery({ snapshot: macroMarketSnapshot.snapshot })
  intelligenceModule.publicQueryService.setMacroRatesSnapshotQuery({ snapshot: macroRatesSnapshot.snapshot })
  intelligenceModule.publicQueryService.setMacroHistoryAsOfQuery(macroHistoryAsOf)
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
    cancelInterfaceTest: async () => (crossAssetRuntime ? crossAssetRuntime.cancelInterfaceTest() : ({ state: 'unavailable' as const })),
    readConfiguration: () => crossAssetConfiguration.read(),
    readLeaseState: async () => crossAssetRuntime?.leaseState() ?? 'unknown'
  }
  registerIntelligenceAgentToolHandlers(deps.registerProductAgentToolHandler, {
    jobRuntime: deps.jobRuntime,
    intelligenceModule,
    getAppLanguage: deps.getAppLanguage,
    macroCalendarOps,
    crossAssetOps,
    policyPath: { read: (input: { asOf: string }) => policyPathQueryService.read(input) }
  })
}
