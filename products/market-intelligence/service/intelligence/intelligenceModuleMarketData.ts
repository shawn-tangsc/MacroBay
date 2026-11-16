import { join } from 'node:path'

import type { JobRuntime } from '@platform/jobs'
import type { NotificationSubmitOutcome, NotificationSubmitRequest } from '@platform/notifications/contracts/notificationContracts'
import type { PlatformWebSocketConstructor } from '@platform/network/platformWebSocket'

import { allSources } from './application/providerRegistry'
import { projectJobRegistration } from './application/sourceJobRegistration'
import { createCryptoEtfFlowClient } from './application/cryptoEtfFlowClient'
import type { EtfFlowHistoryRow } from './etf/etfFlowHistoryParser'
import { mergeEtfAssetDays } from './etf/etfSourceMerge'
import { cryptoEtfSourcePolicy } from './application/cryptoEtfSourcePolicy'
import { zeroXRouterSourcePolicy } from './application/zeroXRouterSourcePolicy'
import { createZeroXRouterEtfFlowHistoryClient } from './application/zeroXRouterEtfFlowHistoryClient'
import { createSourceRequestGovernanceQueue } from './application/sourceRequestGovernance'
import { createEtfCurrentStateRefreshService } from './etf/etfCurrentStateRefreshService'
import { createEtfCurrentStateSqliteStorage, createEtfCurrentStateStore } from './store/etfCurrentStateStore'
import { createFundingRateHistorySqliteStore } from './store/fundingRateHistoryStore'
import { createFundingRateHistoryRefreshService } from './funding-rate/fundingRateHistoryRefreshService'
import { createBinanceFundingRateHistoryClient } from './funding-rate/binanceFundingRateHistoryClient'
import { createPerpetualPositioningSqliteStore } from './store/perpetualPositioningStore'
import { createBinanceOpenInterestClient } from './open-interest/binanceOpenInterestClient'
import { createOpenInterestRefreshService } from './open-interest/openInterestRefreshService'
import { createSignalledOpenInterestRefresh } from './signals/openInterestSignalNotifier'
import { queryOpenInterestHistoryAsync } from './public-query/openInterestHistoryQuery'
import { etfOutflowSignalHandoff } from './signals/etfOutflowSignalHandoff'
import { createMacroMarketRuntime } from './macro-market/macroMarketRuntime'
import { createMacroMarketLive } from './macro-market/macroMarketLive'
import { macroMarketPolicy } from './macro-market/macroMarketPolicy'
import { createDashboardFeedStatusQuery } from './macro-market/dashboardFeedStatusQuery'
import { createCapitalConditionsHttpClient, type CapitalConditionsPlatformFetch } from './capital-conditions/capitalConditionsHttpClient'
import { createCapitalConditionsRefreshService } from './capital-conditions/capitalConditionsRefreshService'
import { createCapitalConditionsSourceIntegration } from './capital-conditions/capitalConditionsSourceIntegration'
import { createCapitalConditionsStateJsonStorage, createCapitalConditionsCurrentStateStore } from './capital-conditions/stablecoinCapitalCurrentStateStore'
import { createCapitalConditionsSnapshotQueryService } from './capital-conditions/capitalConditionsSnapshotQuery'
import { createZeroXRouterCalendarEvidenceAdmissionService } from './macro-calendar/0xrouter-calendar/zeroXRouterCalendarEvidenceAdmissionService'
import { createMacroCalendarEvidenceStore } from './macro-calendar/macroCalendarEvidenceStore'
import { resolveFactSource, type FactSourceResolution, type MarketFactId } from '../../contracts/factSources'
import type { MacroCalendarEvidenceArchive } from './macro-calendar/macroCalendarEvidenceArchive'
import type { IntelligencePipeline } from './application/intelligencePipeline'
import type { RawRecordStore } from './application/rawRecordStore'
import type { SourceProfileStore } from './application/sourceProfileStore'
import type { IntelligenceCredentialStore } from './store/intelligenceCredentialStore'

/**
 * `intelligenceModule` 的市场数据运行时与就绪解析（拆分 M3，2026-11-15，**只搬不改**）。
 *
 * 这一段是 ETF / 资金费率 / 永续持仓 / 宏观市场序列 / 金价流 / 稳定币资金条件的装配，
 * 外加「谁在供 `etf-net-flow`」那一段每轮现算的就绪解析和面板用的来源状态读口。
 * 全部自包含：只吃显式入参（存储、作业运行时、平台取文通道），回给调用方下游要用的那些值。
 *
 * 与搬出来之前相比，**唯一差异是入参解构**：原先读闭包里的 `hooks.platformFetch` /
 * `hooks?.submitNotification` / `hooks.createPlatformWebSocket` 与模块函数
 * `getIntelligenceProductDataDir()`，现在分别由 `platformFetch` / `submitNotification` /
 * `createPlatformWebSocket` / `dataDir` 传入（`dataDir` 与那个函数取的是同一个值）。
 */
export function createIntelligenceMarketData(input: {
  jobRuntime: JobRuntime
  dataDir: string
  profileStore: SourceProfileStore
  credentialStore: IntelligenceCredentialStore
  pipeline: IntelligencePipeline
  macroCalendarEvidenceArchive: MacroCalendarEvidenceArchive
  platformFetch: CapitalConditionsPlatformFetch
  submitNotification?: (request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>
  createPlatformWebSocket?: () => PlatformWebSocketConstructor
}) {
  const {
    jobRuntime, dataDir, profileStore, credentialStore, pipeline, macroCalendarEvidenceArchive,
    platformFetch, submitNotification, createPlatformWebSocket
  } = input
  const capitalConditionsStore = createCapitalConditionsCurrentStateStore({
    storage: createCapitalConditionsStateJsonStorage(join(dataDir, 'capital-conditions-state.json'))
  })
  const etfCurrentStateStore = createEtfCurrentStateStore({
    storage: createEtfCurrentStateSqliteStorage(join(dataDir, 'etf-current-state.sqlite'))
  })
  const requestGovernanceQueue = createSourceRequestGovernanceQueue({ now: () => Date.now() })
  const fundingRateHistoryStore = createFundingRateHistorySqliteStore(join(dataDir, 'funding-rate-history.sqlite'))
  const fundingRateHistoryClient = createBinanceFundingRateHistoryClient({ platformFetch: platformFetch as typeof fetch })
  const fundingRateHistoryRefresh = createFundingRateHistoryRefreshService({
    isEnabled: async () => (await profileStore.resolveProfile('binance-futures-positioning')).enabled,
    requestHistory: fundingRateHistoryClient.requestHistory,
    store: fundingRateHistoryStore,
    now: () => new Date().toISOString()
  })
  // The positioning series is the second half of the same source: a funding rate without the
  // open interest behind it cannot tell deleveraging from crowding.
  const perpetualPositioningStore = createPerpetualPositioningSqliteStore(join(dataDir, 'perpetual-positioning.sqlite'))
  const openInterestClient = createBinanceOpenInterestClient({ platformFetch: platformFetch as typeof fetch })
  const openInterestRefresh = createOpenInterestRefreshService({
    isEnabled: async () => (await profileStore.resolveProfile('binance-futures-positioning')).enabled,
    client: openInterestClient,
    store: perpetualPositioningStore,
    now: () => new Date().toISOString()
  })
  const openInterestWithSignals = createSignalledOpenInterestRefresh({ refresh: openInterestRefresh.refresh,
    readHistory: input => queryOpenInterestHistoryAsync({ ...input, store: perpetualPositioningStore }),
    ...(submitNotification === undefined ? {} : { submit: submitNotification }) })
  const cryptoEtfFlowClient = createCryptoEtfFlowClient({ platformFetch })
  // The macro-market series (dollar, gold, offshore yuan, stablecoin peg) come from a credentialed
  // REST provider, read through the same profile/credential pair every other source uses. The real
  // licensed dollar index is collected by the same runtime into the same store, so the log line
  // takes the failing source id from the collector rather than naming one of the two sources.
  const macroMarket = createMacroMarketRuntime({
    jobRuntime,
    resolveProfile: sourceId => profileStore.resolveProfile(sourceId),
    getCredential: credentialRef => credentialStore.getByRef(credentialRef as never),
    dataDirectory: dataDir,
    onError: (error, sourceId) => { console.log(JSON.stringify({ marker: 'MI_MACRO_MARKET_ERROR', sourceId, message: String(error).slice(0, 200) })) },
    // 品种被供应商永久拒绝（套餐不含/品种下架）要主动说一次：只写在卡面上读者不会去看
    // （用户 2026-11-16「出现这种情况，还要通知出来」）。
    ...(submitNotification === undefined ? {} : { submitNotification })
  })
  // The gold stream shares that source's switch and credential but never its store: it is built only
  // when the desktop shell could hand over the platform socket, so a headless run has no stream.
  const macroMarketLive = createMacroMarketLive({
    source: {
      resolveProfile: sourceId => profileStore.resolveProfile(sourceId),
      getCredential: credentialRef => credentialStore.getByRef(credentialRef as never)
    },
    ...(createPlatformWebSocket === undefined ? {} : { createWebSocket: createPlatformWebSocket }),
    onError: error => { console.log(JSON.stringify({ marker: 'MI_MACRO_MARKET_LIVE_ERROR', sourceId: macroMarketPolicy.sourceId, message: String(error).slice(0, 200) })) }
  })
  const zeroXRouterCredential = async () => {
    const profile = await profileStore.resolveProfile(zeroXRouterSourcePolicy.sourceId)
    return profile.credentialRef ? credentialStore.getByRef(profile.credentialRef) : null
  }
  const cryptoEtfCredential = async () => {
    const profile = await profileStore.resolveProfile(cryptoEtfSourcePolicy.sourceId)
    return profile.credentialRef ? credentialStore.getByRef(profile.credentialRef) : null
  }
  /**
   * ETF 两个源的优先级（用户 2026-11-17：**新的覆盖旧的、旧的补新的**）。
   * 数组顺序就是优先级：主源 CryptoETF 在前，备源 0xrouter 在后。
   */
  const etfSourcePrecedence = [cryptoEtfSourcePolicy.sourceId, zeroXRouterSourcePolicy.sourceId] as const
  /** 每个源读它自己 profile 上的凭据；备源用的是 0xRouter 那把 key（与三路日历共用）。 */
  const etfApiKey = async (sourceId: string): Promise<string | undefined> => {
    const credential = sourceId === zeroXRouterSourcePolicy.sourceId ? await zeroXRouterCredential() : await cryptoEtfCredential()
    return credential?.apiKey
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
  /**
   * 每轮现算「谁在供 etf-net-flow」：声明 + 读者开着 + 作业真的注册着 + 就绪。
   * 不缓存——排期异步注册，启动早于排期的那几轮必须解析成 none，而不是被冻结的错误答案。
   */
  const resolveEtfFactSource = async (): Promise<FactSourceResolution> => {
    const scheduled = new Set(jobRuntime.listSchedules().map((definition) => definition.id))
    const registration = projectJobRegistration(allSources(), scheduled)
    const declared = allSources().filter((source) => source.provides?.includes('etf-net-flow') === true)
    const candidates: Array<Readonly<{ sourceId: string; provides: readonly MarketFactId[]; enabled: boolean; jobRegistered: boolean; readiness: string }>> = []
    for (const source of declared) {
      const profile = await profileStore.resolveProfile(source.sourceId)
      candidates.push({
        sourceId: source.sourceId,
        provides: source.provides as readonly MarketFactId[],
        enabled: profile.enabled,
        jobRegistered: registration[source.sourceId] === true,
        readiness: source.readiness
      })
    }
    // **优先级，不是冲突**（用户 2026-11-17：旧源加回来、互相补充、新的覆盖旧的）。
    // 主源 CryptoETF 合格就用它；它不可用（没开/没作业/没就绪）才退到备源 0xRouter。
    // 两个都开着时不再 fail-closed——那会让「两源互补」变成「两源都不采」。
    const byId = new Map(candidates.map((candidate) => [candidate.sourceId, candidate]))
    for (const sourceId of etfSourcePrecedence) {
      const candidate = byId.get(sourceId)
      if (candidate && candidate.enabled && candidate.jobRegistered && candidate.readiness === 'live') {
        return Object.freeze({ kind: 'resolved' as const, sourceId })
      }
    }
    return Object.freeze({ kind: 'none' as const })
  }
  const zeroXRouterEtfFlowClient = createZeroXRouterEtfFlowHistoryClient({ requestGovernanceQueue })
  const etfCurrentStateRefresh = createEtfCurrentStateRefreshService({
    resolveFactSource: resolveEtfFactSource,
    // 每个源读**它自己的**开关与凭据：备源关了就是它不采，不会被主源的 key 顶替。
    isEnabled: async (sourceId: string) => (await profileStore.resolveProfile(sourceId)).enabled,
    hasCredential: async (sourceId: string) => Boolean(await etfApiKey(sourceId)),
    /**
     * 取窗口 = **主源 + 备源各取一次，逐日合并**（用户 2026-11-17：「互相补充，新的覆盖旧的，
     * 只有数据变化的时候」）：
     * - 同一天两个源都有值：**值相同保留旧行**（不翻来源、不产生一次变更）；值不同用主源的；
     * - 只有一边有值：用那一边（备源把主源缺的天补上）；
     * - 每一行写它自己的 `source`，窗口归属由 `etfWindowSource` 回答（主源在场就是主源）。
     */
    requestWindow: async (sourceId: string) => {
      const primaryId = sourceId
      const standbyId = etfSourcePrecedence.find((candidate) => candidate !== primaryId)
      const read = async (id: string | undefined): Promise<Readonly<{ btc?: readonly EtfFlowHistoryRow[]; eth?: readonly EtfFlowHistoryRow[] }>> => {
        if (id === undefined) return Object.freeze({})
        const profile = await profileStore.resolveProfile(id)
        const apiKey = profile.enabled ? await etfApiKey(id) : undefined
        if (!apiKey) return Object.freeze({})
        const toRows = (days: readonly Readonly<{ tradingDate: string; netFlowUsd: number }>[]): readonly EtfFlowHistoryRow[] =>
          days.map((day) => Object.freeze({ date: Date.parse(`${day.tradingDate}T00:00:00.000Z`), changeUsd: day.netFlowUsd, source: id }))
        if (id === zeroXRouterSourcePolicy.sourceId) {
          // 备源失败现在**不静默**：以前它吞掉原因，界面只表现为「没补上」，谁都查不出为什么。
          // 每支的传输阶段与解析结果各记一条 marker，落 app.log。
          const zero = await zeroXRouterEtfFlowClient.requestWindow(apiKey, (diagnostic) => {
            console.log(JSON.stringify({ marker: 'MI_ETF_STANDBY_DIAGNOSTIC', sourceId: id, asset: diagnostic.asset, transportStage: diagnostic.transportStage, parser: diagnostic.parser }))
          })
          const tag = (rows: readonly EtfFlowHistoryRow[] | undefined) => rows?.map((row) => Object.freeze({ ...row, source: id }))
          return Object.freeze({ ...(zero.state !== 'unavailable' && zero.btc ? { btc: tag(zero.btc) } : {}), ...(zero.state !== 'unavailable' && zero.eth ? { eth: tag(zero.eth) } : {}) })
        }
        const result = await cryptoEtfFlowClient.readSettledWindow(apiKey)
        if (result.state === 'available') return Object.freeze({ btc: toRows(result.btc.days), eth: toRows(result.eth.days) })
        if (result.state === 'partial') {
          return Object.freeze({
            ...(result.btc?.state === 'available' ? { btc: toRows(result.btc.days) } : {}),
            ...(result.eth?.state === 'available' ? { eth: toRows(result.eth.days) } : {})
          })
        }
        return Object.freeze({})
      }
      const primary = await read(primaryId)
      const standby = await read(standbyId)
      const btc = mergeEtfAssetDays(primary.btc, standby.btc)
      const eth = mergeEtfAssetDays(primary.eth, standby.eth)
      // 合并结果本身也留一条：主源/备源各给几天、并完几天——「有没有补上」不必再靠猜。
      console.log(JSON.stringify({
        marker: 'MI_ETF_MERGE', primary: primaryId, standby: standbyId ?? null,
        primaryBtcDays: primary.btc?.length ?? 0, standbyBtcDays: standby.btc?.length ?? 0, mergedBtcDays: btc?.length ?? 0
      }))
      if (btc && eth) return Object.freeze({ state: 'available' as const, btc, eth })
      if (btc || eth) return Object.freeze({ state: 'partial' as const, ...(btc ? { btc } : {}), ...(eth ? { eth } : {}) })
      return Object.freeze({ state: 'unavailable' as const })
    },
    store: etfCurrentStateStore,
    now: () => new Date().toISOString(),
    // 交接点只交读数；开关、去重参数与事件 id 都在通知层（见 `etfOutflowSignalHandoff`）。
    ...etfOutflowSignalHandoff(submitNotification)
  })
  const capitalConditionsRefresh = createCapitalConditionsRefreshService({
    isEnabled: async () => (await profileStore.resolveProfile('defillama-stablecoins')).enabled,
    http: createCapitalConditionsHttpClient({ platformFetch }),
    store: capitalConditionsStore,
    now: () => new Date().toISOString()
  })
  // The historical reader shares the platform fetch and the source switch with the live refresh,
  // but reads each core asset's own endpoint; the aggregate `stablecoincharts/all` series is never
  // used to answer the core metric. The client streams and caps each per-asset response (~22-24 MB).
  const capitalConditionsAssetHistoryHttp = createCapitalConditionsHttpClient({
    platformFetch
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
  return {
    requestGovernanceQueue,
    fundingRateHistoryStore,
    perpetualPositioningStore,
    fundingRateHistoryRefresh,
    openInterestWithSignals,
    macroMarket,
    macroMarketLive,
    zeroXRouterCredential,
    cryptoEtfCredential,
    dashboardFeedStatus,
    zeroXRouterCalendarEvidenceAdmission,
    resolveEtfFactSource,
    etfCurrentStateRefresh,
    capitalConditions,
    capitalConditionsQuery,
    cryptoEtfFlowClient,
    capitalConditionsAssetHistoryHttp
  }
}
