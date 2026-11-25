import { metricConceptOf } from '../../../contracts/metricKeyConcept'
import { POLICY_METRIC_KEY } from './clockPlaqueLayout'

/**
 * 环上的**大类**（用户 2026-11：环上不再挂指标牌，改成四个大类各一支箭头）。
 *
 * 一个箭头 = 一个大类的下一期发布：利率 / CPI / 非农 / PCE。颜色按大类固定，不看指标。
 */
export type ClockRingCategory = 'rate' | 'cpi' | 'payrolls' | 'pce'

/** 四类的固定顺序（渲染与图例都用它，不靠对象键序）。 */
export const clockRingCategories = Object.freeze(['rate', 'cpi', 'payrolls', 'pce'] as const)

/**
 * 一级码 → 大类：**显式表**。十二个一级概念加政策利率，缺一个就抛。
 *
 * 为什么不按名字或前缀猜：`US.AHE.YOY`（平均时薪）属于非农那一类，`US.UNEMPLOYMENT.RATE`
 * 也属于，按 `US.` 后面的词根猜会把它当成利率；而猜错的后果是箭头指向错的日期，读者看不出来。
 */
export const clockCategoryByConcept: Readonly<Record<string, ClockRingCategory>> = Object.freeze({
  [POLICY_METRIC_KEY]: 'rate',
  'US.CPI.YOY': 'cpi',
  'US.CPI.MOM': 'cpi',
  'US.CORE_CPI.YOY': 'cpi',
  'US.CORE_CPI.MOM': 'cpi',
  'US.PCE.YOY': 'pce',
  'US.PCE.MOM': 'pce',
  'US.CORE_PCE.YOY': 'pce',
  'US.CORE_PCE.MOM': 'pce',
  'US.NONFARM.CHANGE': 'payrolls',
  'US.UNEMPLOYMENT.RATE': 'payrolls',
  'US.AHE.YOY': 'payrolls',
  'US.AHE.MOM': 'payrolls'
})

/** 码 → 大类；概念串（季调/未季调变体）同一类。表里没有就抛，不静默归到某一类。 */
export function clockCategoryOf(metricKey: string): ClockRingCategory {
  const concept = metricConceptOf(metricKey)
  const category = clockCategoryByConcept[concept] ?? clockCategoryByConcept[metricKey]
  if (category === undefined) throw new Error(`一级指标没有登记大类：${metricKey}`)
  return category
}
