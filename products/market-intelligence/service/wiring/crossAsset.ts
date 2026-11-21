import { join } from 'node:path'

import { createPlatformWebSocketFactory } from '@platform/network/platformWebSocket'

import type { ProductIpcRegistrar } from '@platform/desktop/ipc/productIpcRegistry'

import { createBinanceCrossAssetClient } from '../intelligence/cross-asset/binanceCrossAssetClient'
import { createBinanceCrossAssetStream } from '../intelligence/cross-asset/binanceCrossAssetStream'
import { createCrossAssetIndexRuntime } from '../intelligence/cross-asset/crossAssetIndexRuntime'
import { createCrossAssetRuntime } from '../intelligence/cross-asset/crossAssetRuntime'
import { createCrossAssetSnapshotQuery } from '../intelligence/cross-asset/crossAssetSnapshotQuery'
import { createCrossAssetSourceConfiguration } from '../intelligence/cross-asset/crossAssetSourceConfiguration'
import { createCrossAssetStore, crossAssetStoragePolicy } from '../intelligence/cross-asset/crossAssetStore'
import { registerCrossAssetIpc } from '../intelligence/cross-asset/registerCrossAssetIpc'
import { installBriefMarketBackfill } from '../intelligence/daily-briefing/dailyBriefMarketBackfill'
import { registerMarketRetention } from '../intelligence/retention/registerMarketRetention'
import { crossAssetPolicy } from '../intelligence/cross-asset/crossAssetPolicy'
import { notifySourceRefusal } from '../intelligence/macro-market/sourceRefusalNotifier'

import type { ProductBootstrapDependencies } from '../bootstrap'
import type { IntelligenceModule } from '../intelligence/intelligenceModule'

/**
 * 跨资产那块装配：源配置、库、Binance 客户端、指数运行时、快照查询、IPC、保留策略，
 * 以及两个读者（分析上下文 / 预测校验）各自的查询口。
 *
 * **只搬家不改行为**（架构师方案 W1）：`try/catch` 仍然是吞掉的（库打不开时其余能力照常可用）、
 * 注册与装配顺序逐字不动、`register` 必须是采样模式包装过的那一个。
 * 判据：`bootstrap.test.ts` 里「跨资产数据库打开失败时其余路由仍在」那条失败分支 + `seal` 87 条。
 */
export function wireCrossAsset(input: Readonly<{
  register: ProductIpcRegistrar
  deps: Pick<ProductBootstrapDependencies, 'jobRuntime' | 'platformFetch' | 'getNetworkSettings'>
  intelligenceModule: IntelligenceModule
  productDataDir: string
}>): Readonly<{
  crossAssetConfiguration: ReturnType<typeof createCrossAssetSourceConfiguration>
  crossAssetStore: ReturnType<typeof createCrossAssetStore> | undefined
  crossAssetRuntime: ReturnType<typeof createCrossAssetRuntime> | undefined
  crossAssetIndexRuntime: ReturnType<typeof createCrossAssetIndexRuntime> | undefined
  crossAssetQuery: ReturnType<typeof createCrossAssetSnapshotQuery> | undefined
}> {
  const crossAssetConfiguration = createCrossAssetSourceConfiguration({ profileStore: input.intelligenceModule.crossAssetProfiles })
  let crossAssetStore: ReturnType<typeof createCrossAssetStore> | undefined
  try { crossAssetStore = createCrossAssetStore(join(input.productDataDir, crossAssetStoragePolicy.fileName)) }
  catch { /* Preserve the unavailable feature database; other product capabilities remain usable. */ }
  const crossAssetClient = createBinanceCrossAssetClient({ platformFetch: input.deps.platformFetch ?? (async () => { throw new Error('dependency-unavailable') }), requestGovernanceQueue: input.intelligenceModule.requestGovernanceQueue })
  if (crossAssetStore) installBriefMarketBackfill(crossAssetStore, crossAssetClient)
  // The real Nasdaq 100 index is collected by its own five-minute job into the same store the Binance
  // proxy writes to: the row prefers the licensed index and falls back to the labelled proxy, and both
  // legs have to be on disk for that choice to be made from data rather than from hope. One store, one
  // connection — two writers of one SQLite file would be a second writer of one table.
  const crossAssetIndexRuntime = crossAssetStore ? createCrossAssetIndexRuntime({
    jobRuntime: input.deps.jobRuntime,
    store: crossAssetStore,
    resolveProfile: sourceId => input.intelligenceModule.crossAssetProfiles.resolveProfile(sourceId),
    getCredential: credentialRef => input.intelligenceModule.sourceCredentials.getByRef(credentialRef),
    onError: (error, sourceId) => {
      // A code, a symbol and nothing else: the failure message names the source, never the URL the key
      // travelled in.
      console.log(JSON.stringify({ marker: 'MI_CROSS_ASSET_INDEX_ERROR', sourceId, symbolCode: crossAssetPolicy.index.symbol, message: String(error).slice(0, 200) }))
    },
    /**
     * 真实纳指这条腿被永久拒绝时也通知一次：它只在"指数休市/代理拿不到"时才接手，永远拒绝的话
     * 读者只会看到代理，永远不知道已付费的那条腿其实没在用（用户 2026-11-16）。
     */
    onPermanentRefusal: (symbolCode) => {
      const submit = input.intelligenceModule.submitNotification
      if (submit === undefined) return
      void notifySourceRefusal(submit, { sourceId: crossAssetPolicy.index.sourceId, symbols: [symbolCode] }, new Date().toISOString())
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
      if (!input.deps.getNetworkSettings) throw new Error('dependency-unavailable')
      return createBinanceCrossAssetStream({ now: Date.now, onState,
        platformWebSocket: createPlatformWebSocketFactory({ getNetworkSettings: input.deps.getNetworkSettings }) })
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
    macroSeries: (seriesId, fromMs, toMs) => input.intelligenceModule.macroMarket.store.series(seriesId, fromMs, toMs)
  }) : undefined
  registerCrossAssetIpc(input.register, { now: Date.now, runtime: crossAssetRuntime, query: crossAssetQuery, configuration: crossAssetConfiguration })
  // Both market stores answer one retention policy, by one daily job and one look at startup: a store
  // that has been kept since the product shipped has months of folding to do, and waiting for the first
  // midnight would leave the reader's disk exactly as it was for a day.
  if (crossAssetStore) {
    const newsStore = input.intelligenceModule.newsSentiment.store
    registerMarketRetention({
      jobRuntime: input.deps.jobRuntime,
      macroStore: input.intelligenceModule.macroMarket.store,
      crossAssetStore,
      analysisRepository: input.intelligenceModule.marketAnalysisRuntime.repository,
      ...(newsStore ? { newsStore } : {}),
      // 原始记录也挂这一跑（0.4.5 缺陷③ 的接线）：它没有自己的开关，也就不该有自己的调度。
      rawRecordStore: input.intelligenceModule.rawRecordStore
    })
  }
  // One cross-asset source, two readers with two shapes: the analysis context reads through the
  // public query method, which validates with the renderer's own parser, while the prediction
  // verifier takes the raw synchronous query and parses the snapshot itself. Handing the async
  // method to the verifier would make `parseCrossAssetSnapshot(Promise)` return undefined and
  // silently produce no observations at all.
  if (crossAssetQuery) {
    input.intelligenceModule.publicQueryService.setCrossAssetQuery({ query: input => crossAssetQuery.query(input) })
    input.intelligenceModule.marketAnalysisRuntime.setCrossAssetQuery(input => crossAssetQuery.query(input))
  }

  return Object.freeze({
    crossAssetConfiguration, crossAssetStore, crossAssetRuntime, crossAssetIndexRuntime, crossAssetQuery
  })
}
