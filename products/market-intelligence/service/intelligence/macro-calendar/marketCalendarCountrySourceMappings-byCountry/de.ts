import type { ZeroXRouterPeriodRule } from '../marketCalendarMetricIdentity'

/**
 * 按国家拆开的「源内 id → 码」映射（DE）。**数据型注册表，纯声明**：一行一个源内身份。
 *
 * 只收期次可定、测度一致的映射；目标码必须存在于码表（守卫在索引里断）。
 */
export const mapping_DE: Readonly<Record<string, Readonly<{ metricKey: string; periodRule: ZeroXRouterPeriodRule }>>> = Object.freeze({
  '213762': { metricKey: 'DE.DAY_TUNER_INDUSTRIAL_OUTPUT.NONE.YOY', periodRule: 'month' },
  '214333': { metricKey: 'DE.DAY_TUNER_GDP.NONE.YOY', periodRule: 'month' },
  '214351': { metricKey: 'DE.TRANSMUTATION_UNEMPLOYMENT_FIGURES.SA.COUNT', periodRule: 'month' },
  '214492': { metricKey: 'DE.DAY_TUNER_INDUSTRIAL_OUTPUT.NONE.YOY', periodRule: 'month' },
  '215003': { metricKey: 'DE.DAY_TUNER_GDP.NONE.YOY', periodRule: 'month' },
  '215064': { metricKey: 'DE.TRANSMUTATION_UNEMPLOYMENT_FIGURES.SA.COUNT', periodRule: 'month' },
})
