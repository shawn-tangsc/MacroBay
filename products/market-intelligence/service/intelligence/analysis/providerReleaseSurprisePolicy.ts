import { marketCalendarSurpriseMagnitude, type MacroCalendarProviderObservation } from '../macro-calendar/marketCalendarObservationNormalization'
import { firstSeenReleaseWindowMs, semanticKeyOf, type PreviousFactKey } from './significanceChangeMatcher'

/**
 * provider 日历的发布**只在显著偏离预期时**进入分析触发流（设计 145 §8 A / 146 §2 选项 3）。
 *
 * 读者 2026-10-16 的原话是"发布了却什么都没发生"：10-15 20:30 那批美国发布拿到了实际值、进了事实集，
 * 却因为没有"数据变化"（值一直都在）而从未触发过分析。所以这里判的不是"变了没有"，而是
 * **"跟市场预期的距离够不够远"**——产品要解释的是意外，例行发布不该花掉一次模型调用。
 *
 * 三条边界，每条都对应一个已定的口径：
 *
 * 1. **US + 高重要性 + 经济指标**（§8 A 的原话）。讲话、会议、别国数据不进这条流——竖线那边早就是
 *    同一个切法（`crossAssetMarketEventLinePolicy`）。
 * 2. **只在这次才看到的实际值**（`freshOnly`）：同一条发布不产生第二次运行。判据与"数据变化"共用
 *    同一份基线（上一个快照的事实），所以一条发布的意外只花掉一次分析，之后基线里已经有它了。
 * 3. **阈值按单位分类**，不是每个指标一张表：provider 的 `displayValue` 没有单位准入
 *    （见 `marketCalendarObservationPolicy.surprise`），分不出"千人"与"万人"。百分数（带 `%`）按
 *    **百分点**，其余裸数字按**相对预期的偏离比例**。实测：核心 PPI 年率 5.0% vs 4.4%（+0.6pp）过线，
 *    初请 199 vs 200（相对 0.5%）不过线。
 *
 * 这个模块只做判断，不做决定：它把"哪几条发布算意外"算出来，由 `analysisSignificancePolicy` 与
 * 宏观序列的变化放在同一张桌前决定——**同一条发布因此不会既触发 provider 线又触发官方线**。
 */
export const providerReleaseSurprisePolicy = Object.freeze({
  version: 'marketIntelligenceProviderReleaseSurprisePolicy.v1',
  qualifyingCountryCode: 'US' as const,
  qualifyingImportance: 'high' as const,
  /** 与 `marketCalendarObservationPolicy` 的 provider 家族映射同名：经济指标才是数据发布。 */
  qualifyingEventFamily: 'economic-indicator' as const,
  thresholds: Object.freeze({
    /** 带 `%` 的值：偏离的**百分点**。0.2pp 高于例行修订，低于真正的意外。 */
    percentPoints: 0.2,
    /** 其余裸数字：相对预期的偏离比例。 */
    relativeFraction: 0.05
  }),
  /** 只判"这次才看到的实际值"，否则同一条发布会一次次进同一条流。 */
  freshOnly: true,
  /** 这个原因码只在**仅由 provider 意外**驱动的那次分析上写进账本；与官方线共用时仍是既有码。 */
  reasonCode: 'provider-surprise-confirmed'
})

export type ProviderReleaseSurprise = Readonly<{
  eventKey: string
  titleKey: string
  /** provider 自己的名字：事实与文案都不得把它说成官方来源。 */
  title: string
  actual: string
  consensus: string
  difference: number
  suffix: string
  relative: number | undefined
}>

/** 与"数据变化"共用同一条事实身份：`domain|subject|metric|eventKey`。 */
export function providerSurpriseBaselineKey(observation: MacroCalendarProviderObservation): PreviousFactKey {
  return semanticKeyOf('macro', observation.eventFamily, 'actual', observation.eventKey)
}

function exceedsThreshold(magnitude: Readonly<{ difference: number; suffix: string; relative: number | undefined }>, thresholds: typeof providerReleaseSurprisePolicy.thresholds): boolean {
  if (magnitude.suffix === '%') return Math.abs(magnitude.difference) >= thresholds.percentPoints
  return magnitude.relative !== undefined && Math.abs(magnitude.relative) >= thresholds.relativeFraction
}

/**
 * 这次采集里算得上"意外"的 provider 发布。
 *
 * `previous` 是上一个快照的事实基线（`projectPreviousBaseline` 的产物），`previousAsOf` 是那个快照的
 * 时刻。没有基线（第一次分析）时按"还没判过"处理。快照里没有这条事件时，只有它确实是**新到的**
 * （`detectedAt` 晚于上一个快照）才算，否则它可能只是掉出了事实预算——这与 `diffSignificance` 里
 * "新增不等于新信息"的判据是同一条。
 */
export function providerReleaseSurprises(input: Readonly<{
  observations: readonly MacroCalendarProviderObservation[]
  previous: ReadonlyMap<PreviousFactKey, string | null> | null
  previousAsOf: string | null
  asOf: string
}>): readonly ProviderReleaseSurprise[] {
  const policy = providerReleaseSurprisePolicy
  const surprises: ProviderReleaseSurprise[] = []
  for (const observation of input.observations) {
    if (observation.countryCode !== policy.qualifyingCountryCode) continue
    if (observation.importance !== policy.qualifyingImportance) continue
    if (observation.eventFamily !== policy.qualifyingEventFamily) continue
    const actual = observation.actual?.displayValue
    const consensus = observation.consensus?.displayValue
    if (!actual || !consensus) continue
    const magnitude = marketCalendarSurpriseMagnitude(observation.actual, observation.consensus)
    if (!magnitude || !exceedsThreshold(magnitude, policy.thresholds)) continue
    if (policy.freshOnly && !isFresh(observation, actual, input)) continue
    surprises.push(Object.freeze({
      eventKey: observation.eventKey, titleKey: observation.titleKey, title: observation.titleKey,
      actual, consensus, difference: magnitude.difference, suffix: magnitude.suffix, relative: magnitude.relative
    }))
  }
  return Object.freeze(surprises)
}

function isFresh(
  observation: MacroCalendarProviderObservation,
  actual: string,
  input: Readonly<{ previous: ReadonlyMap<PreviousFactKey, string | null> | null; previousAsOf: string | null; asOf: string }>
): boolean {
  if (!input.previous || !input.previousAsOf) return true
  const key = providerSurpriseBaselineKey(observation)
  if (input.previous.has(key)) return input.previous.get(key) !== actual
  const detectedAt = Date.parse(observation.detectedAt)
  const scheduledAt = Date.parse(observation.scheduledAt ?? '')
  return detectedAt > Date.parse(input.previousAsOf) &&
    Number.isFinite(scheduledAt) && Date.parse(input.asOf) - scheduledAt <= firstSeenReleaseWindowMs
}
