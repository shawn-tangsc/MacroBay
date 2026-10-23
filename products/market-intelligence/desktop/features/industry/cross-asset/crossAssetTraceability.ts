import { macroRatesSnapshotPublicPolicy } from '../../../../contracts/macro/macroRatesSnapshotContracts'
import type { TraceabilityEntry, TraceabilityFamilyId } from '../../../../contracts/provenanceContracts'
import { basisPointsText, crossAssetRatesDailyExtras } from './crossAssetRatesDaily'

/**
 * 口径目录（设计 144）的**渲染侧一半**：日频行。
 *
 * 它的算式（bp 取整、两腿不同日不给差值）在这一侧，服务侧不能 import 渲染代码——所以目录按 owner 分处
 * （设计 144 §4.1 的实现期修正 I1）。公共形状与"读者可见族"的清单在契约里，两侧由测试断言互不重叠且
 * 合起来等于它。数字与阈值同样只**引用** owner：`traceabilityPolicyRefs` 在回答时现读。
 */
export type RendererPolicyRefId = 'daily.series-ids' | 'daily.release-cadence' | 'daily.bp-unit' | 'daily.maximum-readings'

export const traceabilityPolicyRefs: Readonly<Record<RendererPolicyRefId, () => number | string | readonly string[]>> = Object.freeze({
  'daily.series-ids': () => macroRatesSnapshotPublicPolicy.seriesIds,
  'daily.release-cadence': () => macroRatesSnapshotPublicPolicy.releaseCadence,
  'daily.bp-unit': () => 'bp',
  'daily.maximum-readings': () => macroRatesSnapshotPublicPolicy.maximumReadings
})

/** 算式里引用到的函数名，必须真实存在：改名而没改目录会红。 */
export const traceabilityFunctionRefs: Readonly<Record<string, unknown>> = Object.freeze({
  basisPointsText, crossAssetRatesDailyExtras
})

/** 这一侧负责的族：日频行的取整与"不同日不给差值"是渲染侧算的。 */
export const traceabilityFamiliesOwnedHere: readonly TraceabilityFamilyId[] = Object.freeze(['daily-rate-row'])

export const traceabilityCatalog: readonly TraceabilityEntry[] = Object.freeze([
  Object.freeze({
    id: 'daily-rate-row' as const,
    nameKey: 'provenance.daily-rate-row.title',
    source: Object.freeze({
      route: 'macro rates snapshot (official daily closes)',
      providerIds: Object.freeze([macroRatesSnapshotPublicPolicy.sourceId]),
      seriesIds: macroRatesSnapshotPublicPolicy.seriesIds
    }),
    cadence: Object.freeze({ kind: 'release' as const, releaseCadence: macroRatesSnapshotPublicPolicy.releaseCadence }),
    instant: Object.freeze({ rule: 'release-day' as const }),
    formula: Object.freeze({
      id: 'daily-close-change-and-spread',
      expression: '日频变化 = 最新观测收盘 − 上一观测收盘，取整到整数 bp（四舍五入，b 与 p 之间不留小数）。'
        + '期限利差 = 10Y − 2Y，只在两条腿**观察日相同**时给差值；通胀预期是自己一条序列，永远带自己的观察日。',
      policyRefs: Object.freeze(['daily.series-ids', 'daily.release-cadence', 'daily.bp-unit', 'daily.maximum-readings']),
      functionRefs: Object.freeze(['basisPointsText', 'crossAssetRatesDailyExtras'])
    }),
    substitutions: Object.freeze([]),
    degradations: Object.freeze(['macro-rates-mixed-observation-dates', 'provider-row-not-published-yet']),
    // caveat id 用产品既有那一批（分析侧同一批字符串），不在这里另造。
    caveatIds: Object.freeze(['macro-rates-mixed-observation-dates'])
  })
])

/** 这一族有口径记录时返回它，否则 undefined —— 目录之外的族宁可说"没有"，也不猜。 */
export function resolveTraceability(id: string): TraceabilityEntry | undefined {
  return traceabilityCatalog.find(entry => entry.id === id)
}

export function isTraceabilityFamilyOwnedHere(id: string): boolean {
  return (traceabilityFamiliesOwnedHere as readonly string[]).includes(id)
}

export function resolveTraceabilityPolicyRefs(entry: TraceabilityEntry): Readonly<Record<string, number | string | readonly string[]>> {
  return Object.fromEntries(entry.formula.policyRefs.map(ref => [ref, traceabilityPolicyRefs[ref as RendererPolicyRefId]()]))
}
