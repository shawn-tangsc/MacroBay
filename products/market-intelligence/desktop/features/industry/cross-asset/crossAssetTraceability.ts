import { macroRatesSnapshotPublicPolicy } from '../../../../contracts/macro/macroRatesSnapshotContracts'
import type { TraceabilityEntry, TraceabilityFamilyId } from '../../../../contracts/provenanceContracts'
import { buildUstRows, changeSet } from '../ust-curve/ustCurveModel'

/**
 * 口径目录（设计 144）的**渲染侧一半**：`daily-rate-row` 这一族。
 *
 * 它描述的数现在**由国债收益率卡算**（`features/industry/ust-curve`，用户 2026-11-22 把日频两行从
 * 「市场状态」表里搬走之后，owner 就跟着换了）：表里四档变化由 `changeSet` 取整，价差行与
 * 「两腿不同日不给差值」由 `buildUstRows` 判。渲染侧旧实现（面板日频行的 extras）随块一起删掉了，
 * 别再把 `functionRefs` 指回去。
 *
 * 算式在这一侧，服务侧不能 import 渲染代码——所以目录按 owner 分处（设计 144 §4.1 的实现期修正 I1）。
 * 公共形状与"读者可见族"的清单在契约里，两侧由测试断言互不重叠且合起来等于它。数字与阈值同样只
 * **引用** owner：`traceabilityPolicyRefs` 在回答时现读。
 */
export type RendererPolicyRefId = 'daily.series-ids' | 'daily.release-cadence' | 'daily.bp-unit' | 'daily.maximum-readings'

export const traceabilityPolicyRefs: Readonly<Record<RendererPolicyRefId, () => number | string | readonly string[]>> = Object.freeze({
  'daily.series-ids': () => macroRatesSnapshotPublicPolicy.seriesIds,
  'daily.release-cadence': () => macroRatesSnapshotPublicPolicy.releaseCadence,
  'daily.bp-unit': () => 'bp',
  'daily.maximum-readings': () => macroRatesSnapshotPublicPolicy.maximumReadings
})

/**
 * 本侧目录的条目形状：契约的 `TraceabilityEntry` **去掉 `label`**。
 *
 * `label` 是**服务侧可读标签**——agent 的常驻索引（`buildProvenanceIndex`）读它，因为那个进程解析不了
 * `nameKey`。本侧解析得了 `nameKey`，再填一个 label 就成了同一族的第二种叫法：没人读它，还会与文案各自
 * 漂移。所以这一半只声明自己填得出来的字段；形状本身仍由契约定义（`Omit` 不另写一份）。
 */
export type RendererTraceabilityEntry = Omit<TraceabilityEntry, 'label'>

/** 算式里引用到的函数名，必须真实存在：改名而没改目录会红。 */
export const traceabilityFunctionRefs: Readonly<Record<string, unknown>> = Object.freeze({
  changeSet, buildUstRows
})

/** 这一侧负责的族：取整与"不同日不给差值"由国债卡在渲染侧算。 */
export const traceabilityFamiliesOwnedHere: readonly TraceabilityFamilyId[] = Object.freeze(['daily-rate-row'])

export const traceabilityCatalog: readonly RendererTraceabilityEntry[] = Object.freeze([
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
      // 表里四档变化取整到整数 bp（读者要的是「涨了几个基点」）；契约里的两条价差与图上的归一读法按
      // 0.1bp 取整。负号一律写 −（不写连字符），两种精度都用同一个符号规则。
      expression: '日频变化 = 最新观测收盘 − 上一观测收盘，取整到整数 bp（四舍五入，b 与 p 之间不留小数）；'
        + '契约里那两条价差（10Y−2Y、10Y−3M）按 0.1bp 取整，图上的起点归一也按 0.1bp；负号一律写 −。'
        + '期限利差只在两条腿**观察日相同**时给差值，缺一条腿或两腿不同日就留空并给原因；'
        + '通胀补偿是自己一条序列，永远带自己的观察日。',
      policyRefs: Object.freeze(['daily.series-ids', 'daily.release-cadence', 'daily.bp-unit', 'daily.maximum-readings']),
      functionRefs: Object.freeze(['changeSet', 'buildUstRows'])
    }),
    substitutions: Object.freeze([]),
    degradations: Object.freeze(['macro-rates-mixed-observation-dates', 'provider-row-not-published-yet']),
    // caveat id 用产品既有那一批（分析侧同一批字符串），不在这里另造。
    caveatIds: Object.freeze(['macro-rates-mixed-observation-dates'])
  })
])

/** 这一族有口径记录时返回它，否则 undefined —— 目录之外的族宁可说"没有"，也不猜。 */
export function resolveTraceability(id: string): RendererTraceabilityEntry | undefined {
  return traceabilityCatalog.find(entry => entry.id === id)
}

export function isTraceabilityFamilyOwnedHere(id: string): boolean {
  return (traceabilityFamiliesOwnedHere as readonly string[]).includes(id)
}

export function resolveTraceabilityPolicyRefs(entry: RendererTraceabilityEntry): Readonly<Record<string, number | string | readonly string[]>> {
  return Object.fromEntries(entry.formula.policyRefs.map(ref => [ref, traceabilityPolicyRefs[ref as RendererPolicyRefId]()]))
}
