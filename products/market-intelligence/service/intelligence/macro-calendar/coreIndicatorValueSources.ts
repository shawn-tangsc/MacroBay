import { fredIndicatorYoYPolicy } from './fredIndicatorYoY'
import { macroCalendarReleaseValueMappings } from './macroCalendarReleaseValueMappingPolicy'
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
  /**
   * 这一条腿负责什么（数据侧口径，不是文案）：本期值 / 官方同比 / 官方月率 / 官方净变化 / 官方水平。
   *
   * 四档官方的分法由策略表的 `unit` 机械推出，**不在调用处按码分支**——
   * 界面那行小字要按它写「官方月率」还是「官方同比」，写错等于给这一格贴错口径标签。
   */
  role: 'current-value' | 'official-yoy' | 'official-mom' | 'official-change' | 'official-level'
}>

/** 策略表的 `unit` → 官方腿的 role。新增单位就加一行，不在代码里判断是哪个码。 */
const roleByReleaseUnit: Readonly<Record<string, CoreIndicatorValueSource['role']>> = Object.freeze({
  '12-month percent change': 'official-yoy',
  'monthly percent change': 'official-mom',
  thousands: 'official-change',
  percent: 'official-level'
})

/**
 * BLS 官方直采覆盖的指标——**从发布取值策略派生，不再手抄清单**。
 *
 * 2026-11-14 Chief 核出的缺陷：这里原来写死两条（非农、失业率），而
 * `macroCalendarReleaseValueMappingPolicy` 把 **5 个**指标标成 `releaseLabel: 'BLS official release'`
 * （CPI 年率、核心 CPI 年率、非农、失业率、时薪月率），真库里也确实有对应的
 * `macro-calendar-bls` 行。少登记 3 个的后果不是少一行字：设置页上那三格的 BLS 腿**根本不出现**，
 * 读者没法单独关掉它，页面也在少报源。手抄清单会漏，派生不会。
 *
 * `releaseLabel` 是策略表里已有的事实，这里只筛不改；BLS 出口当前被 CDN 边缘拦截，
 * 「覆盖哪些指标」与「能不能取到」是两件事，登记照留。
 */
export const blsCoveredMetricKeys: readonly string[] = Object.freeze(
  macroCalendarReleaseValueMappings
    .filter((mapping) => mapping.releaseLabel === 'BLS official release')
    .map((mapping) => mapping.metricKey)
)

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
    const mapping = macroCalendarReleaseValueMappings.find((row) =>
      row.metricKey === metricKey && row.releaseLabel === 'BLS official release')
    const role = mapping === undefined ? 'official-yoy' : (roleByReleaseUnit[mapping.unit] ?? 'official-yoy')
    sources.push({ providerId: 'bls', kind: 'official', role })
  }
  return Object.freeze(sources)
}

/**
 * 核心指标菜单要列的**四项核心指标**（产品 2026-11-14 定）：
 * CPI 年率 / 核心 CPI 年率 / 新增就业 / 核心 PCE 年率。
 *
 * **这四个键是产品口径，不是从卡片行键派生的。** 原来写成「`MACRO_INDICATOR_CARD_KEYS` 去掉
 * 行键」，而那个常量是 12 个卡片**行**键（每张卡四行），于是产出 11 项、7 张卡在设置页上没有
 * 文案键、渲染成空卡。派生这个词正是错因：它看上去会跟着卡片走，实际只会跟着卡片的行数走。
 *
 * 与卡片的关系只在一个方向上成立：这四项都必须出现在 `MACRO_INDICATOR_CARD_KEYS` 里，
 * 否则说明两张表各写了一份——那条自检仍由 `coreIndicatorKeysMissingFromCards` 守着。
 */
export const coreIndicatorMetricKeys: readonly string[] = Object.freeze([
  'US.CPI.NSA.YOY',
  'US.CORE_CPI.NSA.YOY',
  'US.NONFARM.SA.CHANGE',
  'US.CORE_PCE.NSA.YOY'
])

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
