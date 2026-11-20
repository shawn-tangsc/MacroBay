import type { CalendarNumericUnit } from './marketCalendarNumericParse'
import { codeTablePercentMeasures, marketCalendarCodeTable } from './marketCalendarCodeTable'

/**
 * **单位闭集映射表**（架构师方案 `macro-calendar-numeric-values-plan.md` §1/§2 的 N2 那一半）。
 *
 * 单位是闭集、**不换算**。这一层回答两件事：
 * ① 源自己声明的单位词汇（BEA 写 `percent-yoy` / `percent-saar`）对应闭集里哪一个；
 * ② 展示串里没写单位时，能不能从**量纲本身**（measure）推出单位。
 *
 * ② 只开「率就是百分比」这一档：`MOM` / `QOQ` / `YOY` / `ANNUALIZED_QOQ` / `RATE`。水平、变动、
 * 计数、金额的单位取决于**该序列报的尺度**（千、十亿、指数点），码表里没这个字段，**一律不猜**——
 * 猜错的单位会让跨源比较拿两个不同尺度的数相减，比「没有数值」更糟。
 *
 * 这张表按 measure 派生，**不是第二张 per-code 表**：码表里已经有 `measure`，这里只写
 * measure → 单位的规则，改一个码不用改这里。
 */

/** 源自己声明的单位词汇 → 闭集。认不出的词汇**不映射**（不是猜成 `unknown`）。 */
export const calendarNumericUnitAliases: Readonly<Record<string, CalendarNumericUnit>> = Object.freeze({
  percent: 'percent',
  // 同比、年化（SAAR）是**口径**不是单位：两者都还是百分比。
  'percent-yoy': 'percent',
  'percent-saar': 'percent',
  thousands: 'thousands',
  millions: 'millions',
  billions: 'billions',
  count: 'count',
  index: 'index',
  ratio: 'ratio',
  usd: 'usd',
  bps: 'bps',
  unknown: 'unknown'
})

/**
 * 源声明的单位词汇 → 闭集；认不出就是 `undefined`，由调用方退回「看展示串写法」。
 *
 * 为什么不用 `unknown` 表示「不认识」：`unknown` 在闭集里是「这个值就是没有明确单位」，
 * 和「我们不认识这个词」是两件事——前者可以照常落库，后者必须让写法或量纲顶上。
 */
export function calendarNumericUnitFromSource(unit: string | null | undefined): CalendarNumericUnit | undefined {
  if (unit === null || unit === undefined) return undefined
  const key = unit.trim().toLowerCase()
  return key === '' ? undefined : calendarNumericUnitAliases[key]
}

/**
 * 量纲由 measure 决定的那一档（率类＝百分比）；其余档位不出现＝不可由 measure 推。
 *
 * **从码表的 `codeTablePercentMeasures` 派生**，不在这里再抄一份：同一条「哪几档是百分比」
 * 还要给年度化载入校验用（率类不许标 `annualization:'flow'`），两份必然漂移。
 */
export const calendarNumericUnitByMeasure: Readonly<Record<string, CalendarNumericUnit>> = Object.freeze(
  Object.fromEntries(codeTablePercentMeasures.map((measure) => [measure, 'percent' as CalendarNumericUnit]))
)

/** 该指标码能不能给出单位提示（展示串里没写单位时用）。码表里没有的码、没登记量纲的码 → 不猜。 */
export function calendarNumericUnitHintForMetricKey(metricKey: string | null | undefined): CalendarNumericUnit | undefined {
  if (metricKey === null || metricKey === undefined) return undefined
  const code = metricKey.trim()
  if (code === '') return undefined
  const row = marketCalendarCodeTable[code]
  return row === undefined ? undefined : calendarNumericUnitByMeasure[row.measure]
}