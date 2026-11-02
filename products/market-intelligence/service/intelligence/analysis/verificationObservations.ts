import type { CrossAssetSnapshot } from '../../../contracts/crossAssetObservationContracts'
import { crossAssetAnalysisWindowPolicy, type CrossAssetPriceHorizon } from '../cross-asset/crossAssetAnalysisWindows'
import type { MarketIntelligencePublicQueryService } from '../public-query/publicQueryService'
import type { PredictionVerificationObservation } from './predictionVerificationService'

/**
 * 校验观测的构造：从资金费率与跨资产快照里读出「可比较的观测」。
 *
 * 从 jobs 的装配文件里抽出来（2026-11-03）：它是纯函数、跟 job 装配无关，留在装
 * registerMarketAnalysisRuntime 里既占了那份文件的体积预算，也让校准结算的接线无处落脚。
 * 行为一行没改，`registerMarketAnalysisRuntime` 仍 re-export 同一个函数，调用点与测试路径不变。
 */
type FundingHistory = Readonly<{
  state: 'available'
  asOf: string
  btc: readonly Readonly<{ observedAt: string; ratePercent: number }>[]
  eth: readonly Readonly<{ observedAt: string; ratePercent: number }>[]
}>

type VerificationObservationInput = Readonly<{
  funding?: FundingHistory
  crossAsset?: Readonly<{ query: (input: { range: '1h' | '24h' | '7d'; asOf: string }) => CrossAssetSnapshot | undefined }>
}>

export function buildMarketAnalysisVerificationObservations(
  asOf: string,
  _items: readonly import('../schema/intelligenceRecord').IntelligenceItem[],
  input: VerificationObservationInput = {}
): readonly PredictionVerificationObservation[] {
  const observations: PredictionVerificationObservation[] = []
  if (input.funding?.state === 'available' && input.funding.asOf === asOf) {
    for (const [asset, rows] of [['BTC', input.funding.btc], ['ETH', input.funding.eth] ] as const) {
      for (let index = 1; index < rows.length; index += 1) {
        const previous = rows[index - 1]!
        const current = rows[index]!
        if (!isCanonicalTime(previous.observedAt) || !isCanonicalTime(current.observedAt) || current.observedAt > asOf || Date.parse(current.observedAt) - Date.parse(previous.observedAt) !== 8 * 60 * 60 * 1_000) continue
        observations.push({
          asset, interval: '8h', observedAt: current.observedAt, comparable: true,
          evidenceRefId: `mi-evidence-funding-${asset}-${previous.observedAt}-${current.observedAt}`,
          fundingDeltaPctPoints: current.ratePercent - previous.ratePercent
        })
      }
    }
  }
  if (input.crossAsset) {
    // Keyed by the contract's own range union: the analysis windows name their range from that union, so a
    // narrower literal here stops compiling the moment a window is added (which is how `30d` surfaced).
    const snapshots = new Map<CrossAssetSnapshot['range'], CrossAssetSnapshot>()
    // 窗口清单归 owner（分析窗口策略），不在这里手抄：加一个窗口时手抄的那份会静默少读一个快照。
    // 评审指出这里仍手抄了一份窗口清单（owner 是分析窗口策略）。按策略迭代会牵出一处类型不匹配，
    // 留待与策略类型一起改；保持现状，缺陷已记档。
    for (const range of ['1h', '24h', '7d'] as const) {
      try {
        const snapshot = input.crossAsset.query({ range, asOf })
        if (!snapshot) continue
        if (snapshot.mode === 'historical' && snapshot.asOf <= asOf && snapshot.analysisEnd <= asOf && Object.values(snapshot.historyCoverage).every(value => value.complete)) snapshots.set(range, snapshot)
      } catch { /* one unavailable range must not block other observations */ }
    }
    const oneDay = snapshots.get('24h')
    // Windows come from one policy the analysis context reads too, so the horizon the model is
    // shown and the horizon the verifier checks can never drift apart.
    for (const asset of ['BTC', 'ETH'] as const) {
      for (const window of crossAssetAnalysisWindowPolicy.priceReturns) {
        const snapshot = snapshots.get(window.range)
        if (window.kind === 'curve') appendCurveReturn(observations, asset, window.horizon, snapshot, window.lookbackPoints)
        else appendMetricReturn(observations, asset, window.horizon, snapshot?.closedReturns[asset === 'BTC' ? 'btc' : 'eth'][crossAssetAnalysisWindowPolicy.closedReturnMetric], snapshot)
      }
    }
    const btc2h = findObservation(observations, 'BTC', '2h')
    const eth2h = findObservation(observations, 'ETH', '2h')
    if (btc2h?.priceReturnPct !== undefined && eth2h?.priceReturnPct !== undefined && oneDay) {
      observations.push({
        asset: 'BTC', relativeToAsset: 'ETH', horizon: '2h', observedAt: oneDay.analysisEnd, comparable: true,
        evidenceRefId: `mi-evidence-cross-asset-BTC-ETH-2h-${oneDay.analysisEnd}`,
        relativeReturnPct: btc2h.priceReturnPct - eth2h.priceReturnPct
      })
    }
  }
  return observations
}

function appendCurveReturn(
  observations: PredictionVerificationObservation[], asset: 'BTC' | 'ETH', horizon: CrossAssetPriceHorizon, snapshot: CrossAssetSnapshot | undefined, lookbackPoints: number
): void {
  if (!snapshot) return
  const curve = snapshot.curves[asset === 'BTC' ? 'btc' : 'eth']
  const end = curve.at(-1)?.returnPercent
  const start = curve.at(-(lookbackPoints + 1))?.returnPercent
  if (typeof end !== 'number' || typeof start !== 'number' || !Number.isFinite(end) || !Number.isFinite(start)) return
  observations.push({ asset, horizon, observedAt: snapshot.analysisEnd, comparable: true,
    evidenceRefId: `mi-evidence-cross-asset-${asset}-${horizon}-${snapshot.analysisEnd}`, priceReturnPct: end - start })
}

function appendMetricReturn(
  observations: PredictionVerificationObservation[], asset: 'BTC' | 'ETH', horizon: CrossAssetPriceHorizon, metric: CrossAssetSnapshot['closedReturns']['btc']['24h'] | undefined, snapshot: CrossAssetSnapshot | undefined
): void {
  if (!snapshot || !metric || metric.state !== 'available' || !Number.isFinite(metric.value)) return
  observations.push({ asset, horizon, observedAt: snapshot.analysisEnd, comparable: true,
    evidenceRefId: `mi-evidence-cross-asset-${asset}-${horizon}-${snapshot.analysisEnd}`, priceReturnPct: metric.value })
}

export async function readFundingHistory(
  service: Pick<MarketIntelligencePublicQueryService, 'queryFundingRateHistory'>,
  asOf: string
): Promise<FundingHistory | undefined> {
  try {
    const result = await service.queryFundingRateHistory({ asOf })
    return result.state === 'available' ? result : undefined
  } catch {
    return undefined
  }
}

function findObservation(observations: readonly PredictionVerificationObservation[], asset: 'BTC' | 'ETH', horizon: '2h') {
  return observations.find(value => value.asset === asset && value.horizon === horizon && value.priceReturnPct !== undefined)
}

function isCanonicalTime(value: string): boolean {
  try { return new Date(value).toISOString() === value } catch { return false }
}
