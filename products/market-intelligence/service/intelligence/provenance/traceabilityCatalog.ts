import { crossAssetContractPolicy } from '../../../contracts/crossAssetObservationContracts'
import type { TraceabilityEntry, TraceabilityFamilyId } from '../../../contracts/provenanceContracts'
import {
  analyzeCrossAssetHistory, crossAssetAnalyticsPolicy, crossAssetFlatBand, crossAssetObservationPolicy
} from '../cross-asset/crossAssetAnalytics'
import { crossAssetMacroCurvePolicy, crossAssetMacroCurves } from '../cross-asset/crossAssetMacroCurves'
import { crossAssetPolicy } from '../cross-asset/crossAssetPolicy'
import { crossAssetLegDirection, crossAssetReadingPolicy, resolveCrossAssetReading } from '../cross-asset/crossAssetReading'
import { barRetentionPolicy } from '../retention/barRetention'

/**
 * 口径目录（设计 144）：每个"读者能看到的数"是从哪来、什么时候的、怎么算的。
 *
 * 这条要求来自读者 2026-10-15 的原话：用户直接问 agent 来源时，agent 要能原原本本说清**前因后果、数据来源、
 * 计算公式**。而 agent 能读到的只有分析上下文那一份 fact 集——产品自己的口径却分散在服务策略、快照字段与
 * 渲染文案三处。本文件是那座桥的**服务侧一半**：纯数据，没有 UI、没有流程。
 *
 * 三条不可违反的写法：
 *
 * 1. **按 owner 分处**（设计 144 §4.1 的实现期修正 I1）：服务侧不能 import 渲染代码，所以两侧各有一张目录，
 *    合起来等于契约里 `marketIntelligenceTraceabilityPolicy.families` 那一份读者可见族的清单。
 * 2. **数字与阈值只引用策略常量**：条目的 `policyRefs` 是 id，取值由下面的 `traceabilityPolicyRefs` 在**回答时**
 *    从各自 owner 读出——策略改了，回答跟着改，不存在第二套口径。
 * 3. **算式里的函数按名字引用**，并且那名字必须真实存在：改名而没改目录会红。
 */
export type PolicyRefId =
  | 'flat-band.dxy' | 'flat-band.gold' | 'flat-band.index' | 'flat-band.btc'
  | 'band.window-scale-24h'
  | 'reading.window' | 'correlation.interval' | 'correlation.minimumPairs' | 'correlation.expectedPairs'
  | 'retention.hot-ms' | 'retention.cold-ms'
  | 'chart.stride-7d' | 'macro.carry-ms' | 'macro.anchor-lookback-ms'
  | 'macro.carry-ms' | 'macro.anchor-lookback-ms' | 'bar.interval-ms'

/** 每个引用 id 的**取值方式**：函数而不是常量，所以在回答的那一刻读的是 owner 的当前值。 */
export const traceabilityPolicyRefs: Readonly<Record<PolicyRefId, () => number | string>> = Object.freeze({
  'flat-band.dxy': () => crossAssetObservationPolicy.flatPercent.dxy,
  'flat-band.gold': () => crossAssetObservationPolicy.flatPercent.gold,
  'flat-band.index': () => crossAssetObservationPolicy.flatPercent.index,
  'flat-band.btc': () => crossAssetObservationPolicy.flatPercent.btc,
  // 窗口缩放：1h 档位放大到 24h 用的倍数（√24）。判读只用 24H，所以这里就是那一个数。
  'band.window-scale-24h': () => crossAssetFlatBand('index', '24h') / crossAssetObservationPolicy.flatPercent.index,
  'reading.window': () => crossAssetReadingPolicy.window,
  'correlation.interval': () => crossAssetPolicy.interval,
  'correlation.minimumPairs': () => crossAssetContractPolicy.minimumPairs,
  'correlation.expectedPairs': () => crossAssetContractPolicy.expectedPairs,
  'retention.hot-ms': () => barRetentionPolicy.hotMs,
  'retention.cold-ms': () => barRetentionPolicy.coldMs,
  'chart.stride-7d': () => crossAssetAnalyticsPolicy.curveStride['7d'],
  'macro.carry-ms': () => crossAssetMacroCurvePolicy.maxCarryMs,
  'macro.anchor-lookback-ms': () => crossAssetMacroCurvePolicy.anchorLookbackMs,
  // 5 分钟网格的 owner 是契约（线协议校验用的同一个数）；`crossAssetPolicy` 里的那个路径不是它的形状。
  'bar.interval-ms': () => crossAssetContractPolicy.intervalMs
})

/** 算式里引用到的函数名，必须真实存在。 */
export const traceabilityFunctionRefs: Readonly<Record<string, unknown>> = Object.freeze({
  crossAssetLegDirection, resolveCrossAssetReading, analyzeCrossAssetHistory, crossAssetMacroCurves
})

/**
 * 这一侧负责的族。渲染侧负责它自己算的那些（日频行的 bp 取整）；两边合起来必须等于契约里的族清单，
 * 且互不重叠——那条断言写在渲染侧的测试里（那一侧可以同时 import 两张表）。
 */
export const traceabilityFamiliesOwnedHere: readonly TraceabilityFamilyId[] = Object.freeze(['cross-market-reading', 'chart-sampling'])

export const traceabilityCatalog: readonly TraceabilityEntry[] = Object.freeze([
  Object.freeze({
    id: 'cross-market-reading' as const,
    nameKey: 'provenance.cross-market-reading.title', label: '跨市场判读',
    source: Object.freeze({
      route: 'cross-asset snapshot (derived, not a provider)',
      providerIds: Object.freeze(['binance-cross-asset', 'macro-market']),
      seriesIds: Object.freeze(['index/btc/eth bars', 'dxy-real|dxy-synthetic', 'xau-usd'])
    }),
    cadence: Object.freeze({ kind: 'bar' as const, intervalMsRef: 'bar.interval-ms' }),
    instant: Object.freeze({ rule: 'bar-end' as const }),
    formula: Object.freeze({
      id: 'leg-direction-then-scenario-match',
      expression: '每条腿：收益 > 界线 → 涨；< −界线 → 跌；否则没变化。界线 = 该腿典型 1h 波动 × √(窗口小时 / 1)。'
        + '五剧本按固定顺序比对四条腿（美元、黄金、纳指、BTC）；恰好一条腿不符的剧本列为「不像」；ρ 只作背书，'
        + '且恒为 24 小时 5 分钟收益算出的那一个。',
      policyRefs: Object.freeze([
        'flat-band.dxy', 'flat-band.gold', 'flat-band.index', 'flat-band.btc',
        'band.window-scale-24h', 'reading.window', 'correlation.interval', 'correlation.minimumPairs', 'correlation.expectedPairs'
      ]),
      functionRefs: Object.freeze(['crossAssetLegDirection', 'resolveCrossAssetReading'])
    }),
    substitutions: Object.freeze(['index-proxy', 'dxy-synthetic', 'gold-synthetic']),
    degradations: Object.freeze(['legs-missing', 'stale', 'window-not-judged', 'no-match']),
    caveatIds: Object.freeze([])
  }),
  Object.freeze({
    id: 'chart-sampling' as const,
    nameKey: 'provenance.chart-sampling.title', label: '同起点收益率取样',
    source: Object.freeze({
      route: 'cross-asset + macro stores under the retention policy',
      providerIds: Object.freeze(['binance-cross-asset', 'macro-market']),
      seriesIds: Object.freeze(['index/btc/eth bars', 'dxy-real|dxy-synthetic', 'xau-usd'])
    }),
    cadence: Object.freeze({ kind: 'bar' as const, intervalMsRef: 'bar.interval-ms' }),
    instant: Object.freeze({ rule: 'bar-end' as const }),
    formula: Object.freeze({
      id: 'same-anchor-return-on-a-sampled-grid',
      expression: '同起点收益 = 100 × (该点收盘 / 锚点收盘 − 1)。1H/24H 每 5 分钟一点，7D 每小时一点；'
        + '锚点取窗口起点（或之前最近一根收盘）；准入窗口都在 8 天热层以内，因此每个点取的是**精确同一时刻**的收盘，'
        + '没有携带、也没有冷层取点；覆盖按该窗口自己的网格计数。',
      policyRefs: Object.freeze([
        'retention.hot-ms', 'retention.cold-ms', 'chart.stride-7d',
        'macro.carry-ms', 'macro.anchor-lookback-ms', 'bar.interval-ms'
      ]),
      functionRefs: Object.freeze(['analyzeCrossAssetHistory', 'crossAssetMacroCurves'])
    }),
    substitutions: Object.freeze(['index-proxy', 'dxy-synthetic', 'gold-synthetic']),
    // 准入窗口都在热层、且都有锚点：被稀释与携带受限这两条对已交付的图表不可达。
    degradations: Object.freeze(['no-anchor']),
    caveatIds: Object.freeze(['proxy-tokenised-index', 'synthetic-dollar'])
  })
])

/** 这一族有口径记录时返回它，否则 undefined —— 目录之外的族宁可说"没有"，也不猜（设计 144 §5.7）。 */
export function resolveTraceability(id: string): TraceabilityEntry | undefined {
  return traceabilityCatalog.find(entry => entry.id === id)
}

/** 这一侧是否负责该族：问别的族要老实说"不在这一侧"，而不是编一条。 */
export function isTraceabilityFamilyOwnedHere(id: string): boolean {
  return (traceabilityFamiliesOwnedHere as readonly string[]).includes(id)
}

/** 回答时现读每个引用：返回的就是 owner 此刻的值，不是目录里抄下来的快照。 */
export function resolveTraceabilityPolicyRefs(entry: TraceabilityEntry): Readonly<Record<string, number | string>> {
  return Object.fromEntries(entry.formula.policyRefs.map(ref => [ref, traceabilityPolicyRefs[ref as PolicyRefId]()]))
}
