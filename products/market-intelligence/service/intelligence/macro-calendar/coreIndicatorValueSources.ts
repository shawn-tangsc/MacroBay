import { fredIndicatorYoYPolicy } from './fredIndicatorYoY'
import { MACRO_INDICATOR_CARD_KEYS } from './macroIndicatorCardFacts'
import { narwhalMeasureMetricKeys } from './marketCalendarMetricIdentity'

/**
 * 「某个指标的取值源有哪些」——**唯一派生点**。
 *
 * 三条腿各有各的唯一出处，这里只做并集，**不许把任何一条腿再抄一遍**：
 * - Narwhal（数据商）：`narwhalMeasureMetricKeys`（measure ↔ metric_key 双射）；
 * - FRED（官方同比 / 上一期）：`fredIndicatorYoYPolicy.seriesByMetricKey`；
 * - BLS（官方直采）：下面这一个常量——**这是本文件唯一新增的事实**，因为「BLS 覆盖哪些指标」
 *   此前只存在于运行时行数据里（`sourceProviderId`），没有常量。
 *
 * 为什么必须先有这张表：核心指标菜单要给「指标 × 源」各一个开关，存储键是
 * `(metric_key, provider_id)`；没有统一派生点，四个组件会各拼一次，关掉一个源却不知影响哪张卡。
 *
 * 红线（Chief 2026-11-14）：**同一条腿出现两处定义 → 红**。所以这里不出现任何 `US.` 字面量，
 * 除了 BLS 那两条；守卫会读源码断言这一点。
 */
export type CoreIndicatorValueSource = Readonly<{
  providerId: 'narwhal' | 'fred-rates-liquidity' | 'bls'
  /** 界面上那一行小字的类型：官方 / 数据商。 */
  kind: 'official' | 'provider'
  /** 这一条腿负责什么（数据侧口径，不是文案）：本期值 / 官方同比 / 官方净变化。 */
  role: 'current-value' | 'official-yoy' | 'official-change'
}>

/**
 * BLS 官方直采覆盖的指标（**新增事实**，别处没有）。失业率与新增就业同一条非农发布。
 * 注意：BLS 出口当前被 CDN 边缘拦截，登记保留、显示「读不到」——但「覆盖哪些指标」与「能不能取到」是两件事。
 */
export const blsCoveredMetricKeys: readonly string[] = Object.freeze([
  'US.NONFARM.SA.CHANGE',
  'US.UNEMPLOYMENT.SA.RATE'
])

/**
 * 这条腿的「总闸」是哪个源（数据源页那颗开关的 sourceId）。
 *
 * 与上一层的「按指标取舍」分开：总闸管「这个源采不采」，关掉后这一页那一行要置灰。
 * 三处一一对应，写得下就不派生出第二份。
 */
export const gateSourceIdByProviderId: Readonly<Record<CoreIndicatorValueSource['providerId'], string>> = Object.freeze({
  narwhal: 'macro-calendar-narwhal-economic-data',
  'fred-rates-liquidity': 'fred-rates-liquidity',
  bls: 'macro-calendar-bls'
})

/** Narwhal 这一腿是否覆盖该指标：从 measure 映射反查，不另存清单。 */
function narwhalCovers(metricKey: string): boolean {
  return Object.values(narwhalMeasureMetricKeys).includes(metricKey)
}

/** FRED 这一腿是否覆盖该指标：读同比序列映射，不另存清单。 */
function fredCovers(metricKey: string): boolean {
  return (fredIndicatorYoYPolicy.seriesByMetricKey as Readonly<Record<string, string>>)[metricKey] !== undefined
}

/** 一个指标的取值源（顺序即界面顺序：数据商（本期值）在前，官方腿在后）。 */
export function valueSourcesForMetric(metricKey: string): readonly CoreIndicatorValueSource[] {
  const sources: CoreIndicatorValueSource[] = []
  if (narwhalCovers(metricKey)) {
    sources.push({ providerId: 'narwhal', kind: 'provider', role: 'current-value' })
  }
  if (fredCovers(metricKey)) {
    sources.push({ providerId: 'fred-rates-liquidity', kind: 'official', role: 'official-yoy' })
  }
  if (blsCoveredMetricKeys.includes(metricKey)) {
    sources.push({ providerId: 'bls', kind: 'official', role: 'official-change' })
  }
  return Object.freeze(sources)
}

/**
 * 卡片键里**只是卡内一行、不单独成卡**的那些（失业率就在非农卡里那一行）。
 * 这是本文件第二个、也是最后一个新增事实；四个指标名一律从 `MACRO_INDICATOR_CARD_KEYS` 派生，
 * 不在这里再列一遍——列一遍就是第二个真相源。
 */
const rowOnlyCardKeys: readonly string[] = Object.freeze(['US.UNEMPLOYMENT.SA.RATE'])

/** 核心指标菜单要列的四张卡：卡片键去掉「只是某卡里一行」的那些。 */
export const coreIndicatorMetricKeys: readonly string[] = Object.freeze(
  (MACRO_INDICATOR_CARD_KEYS as readonly string[]).filter((key) => !rowOnlyCardKeys.includes(key))
)

/** 页面与存储都读这一份：(metric_key, provider_id) 的完整清单。 */
export function coreIndicatorValueSourceRows(): readonly Readonly<{
  metricKey: string
  source: CoreIndicatorValueSource
}>[] {
  return coreIndicatorMetricKeys.flatMap((metricKey) =>
    valueSourcesForMetric(metricKey).map((source) => Object.freeze({ metricKey, source })))
}

/** 兜底自检：菜单列的四项必须都在卡片键里，否则是两张表各写了一份。 */
export function coreIndicatorKeysMissingFromCards(): readonly string[] {
  return coreIndicatorMetricKeys.filter((key) => !(MACRO_INDICATOR_CARD_KEYS as readonly string[]).includes(key))
}
