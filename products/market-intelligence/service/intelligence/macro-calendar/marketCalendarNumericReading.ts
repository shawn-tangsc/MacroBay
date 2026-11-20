import { marketCalendarCodeTable } from './marketCalendarCodeTable'
import {
  calendarNumericStateOf, type CalendarNumericField, type CalendarNumericUnit
} from './marketCalendarNumericParse'

/**
 * **读侧的数值读取、跨源比较、年度化**（方案 `macro-calendar-numeric-values-plan.md` §3，N3）。
 *
 * 一条硬规则：**只读 `numeric_json`**。展示串 `values_json` 在这里一次都不解析——旧行没有数值列
 * 就是「数值未记录」，不许拿展示串现算一个数出来（那正是「既不证实也不否证」的来源）。
 *
 * 缺失分四态（§3.2），**不许合并成一句「无数据」**，更不许把 NULL 画成 0：
 * - `unrecorded`＝加列前写的（我们的缺口，`NULL` 或形状坏）；
 * - `missing`＝源没给这个值；
 * - `unparsed`＝展示串在、解析不出（我们的问题，按轮计数）；
 * - `available`＝有值。
 */

export type CalendarNumericAvailable = Readonly<{
  state: 'available'
  unit?: CalendarNumericUnit
  values: Readonly<Partial<Record<CalendarNumericField, number>>>
  decimals: Readonly<Partial<Record<CalendarNumericField, number>>>
}>

export type CalendarNumericReading =
  | Readonly<{ state: 'unrecorded'; reason?: string }>
  | Readonly<{ state: 'missing' }>
  | Readonly<{ state: 'unparsed' }>
  | CalendarNumericAvailable

/** 一列 `numeric_json` → 四态之一。形状坏按「未记录」并带原因，不当成 0、也不当成有空值。 */
export function readCalendarNumeric(json: string | null | undefined): CalendarNumericReading {
  const state = calendarNumericStateOf(json)
  if (state.state === 'unrecorded') {
    return state.reason === undefined ? { state: 'unrecorded' } : { state: 'unrecorded', reason: state.reason }
  }
  if (state.state !== 'available') return { state: state.state }
  // 已由 `calendarNumericStateOf` 校验过形状，这里只做取值（解析器只有一处，这里不再 JSON.parse 出第二套语义）。
  const parsed = JSON.parse(String(json)) as {
    unit?: CalendarNumericUnit
    values?: Partial<Record<CalendarNumericField, number>>
    decimals?: Partial<Record<CalendarNumericField, number>>
  }
  return {
    state: 'available',
    ...(parsed.unit === undefined ? {} : { unit: parsed.unit }),
    values: parsed.values ?? {},
    decimals: parsed.decimals ?? {}
  }
}

/** 比较不可比的原因：**每种缺失各有各的说法**，不合并成一句「没有」。 */
export type CalendarNumericIncomparableReason =
  | 'unrecorded' | 'missing' | 'unparsed' | 'no-value' | 'unit-unknown' | 'unit-mismatch'

export type CalendarNumericComparison =
  | Readonly<{ comparable: false; reason: CalendarNumericIncomparableReason }>
  | Readonly<{ comparable: true; same: boolean; difference: number; tolerance: number; decimals: number }>

/**
 * 两行同一个字段的比较（§3.3）：两边都 `available`、**单位相同且不是 `unknown`** 才比较。
 *
 * 容差 = `0.5 × 10^-较粗的位数`（取两方**小数位更少**的那个）：源展示到 1 位小数时，
 * 4.1 与 4.14 就是同一个数——拿更细的一方去要求更粗的一方，等于说「1 位小数的源永远比不过 2 位的源」。
 * （方案 §3.3 的公式写的是 `max(decimals)`、括号里却写「取较粗的那一方」；按括号实现，已报架构师。）
 * **不做单位换算**：单位不同就是不比，要换算得先在码表声明口径。
 */
export function compareCalendarNumeric(
  leftJson: string | null | undefined,
  rightJson: string | null | undefined,
  field: CalendarNumericField = 'actual'
): CalendarNumericComparison {
  const left = readCalendarNumeric(leftJson)
  const right = readCalendarNumeric(rightJson)
  const leftValue = numericFieldOf(left, field)
  if (leftValue === undefined) return { comparable: false, reason: left.state === 'available' ? 'no-value' : left.state }
  const rightValue = numericFieldOf(right, field)
  if (rightValue === undefined) return { comparable: false, reason: right.state === 'available' ? 'no-value' : right.state }
  const leftUnit = left.state === 'available' ? left.unit : undefined
  const rightUnit = right.state === 'available' ? right.unit : undefined
  if (leftUnit === undefined || rightUnit === undefined || leftUnit === 'unknown' || rightUnit === 'unknown') {
    return { comparable: false, reason: 'unit-unknown' }
  }
  if (leftUnit !== rightUnit) return { comparable: false, reason: 'unit-mismatch' }
  // 取**较粗**的位数（两者中更小的），理由见函数注释。
  const decimals = Math.min(leftValue.decimals, rightValue.decimals)
  const tolerance = 0.5 * 10 ** -decimals
  const difference = Math.abs(leftValue.value - rightValue.value)
  return { comparable: true, same: difference <= tolerance, difference, tolerance, decimals }
}

/** 取一个字段的「值 + 小数位」；该字段没有值（或整行没有值）→ `undefined`，**不返回 0**。 */
function numericFieldOf(
  reading: CalendarNumericReading,
  field: CalendarNumericField
): Readonly<{ value: number; decimals: number }> | undefined {
  if (reading.state !== 'available') return undefined
  const value = reading.values[field]
  if (value === undefined) return undefined
  return { value, decimals: reading.decimals[field] ?? 0 }
}

export type AnnualizationFrequency = 'weekly' | 'monthly' | 'quarterly'

/** 频率 → 年化系数。**唯一出处是码表的 `officialSeries.frequency`**，这里只定义换算。 */
export function annualizationMultiplier(frequency: AnnualizationFrequency): number {
  return frequency === 'weekly' ? 52 : frequency === 'monthly' ? 12 : 4
}

export type CalendarNumericAnnualization =
  | Readonly<{ annualizable: true; annualized: number; multiplier: number; frequency: AnnualizationFrequency }>
  | Readonly<{ annualizable: false; reason: 'code-unknown' | 'not-flow' | Exclude<CalendarNumericIncomparableReason, 'unit-mismatch' | 'unit-unknown'> }>

/**
 * 年度化（§3.4）：**只对码表带 `officialSeries.frequency` 且标了 `annualization:'flow'` 的码可用**。
 *
 * 三条硬边界：
 * 1. 没有频率、或没标 `flow` → `not-flow`，**不猜系数**（今天只有 4 个流量码）；
 * 2. 比率类不许标 `flow`（载入校验 `validateCodeTableRows` 负责红）；
 * 3. 算出来的数**不入库**：这是一次读时换算，不是事实；口径变了历史结论不该跟着变。
 */
export function annualizeCalendarNumeric(
  metricKey: string,
  json: string | null | undefined,
  field: CalendarNumericField = 'actual'
): CalendarNumericAnnualization {
  const row = marketCalendarCodeTable[metricKey]
  if (row === undefined) return { annualizable: false, reason: 'code-unknown' }
  const frequency = row.officialSeries?.frequency
  if (row.annualization !== 'flow' || frequency === undefined) return { annualizable: false, reason: 'not-flow' }
  const reading = readCalendarNumeric(json)
  if (reading.state !== 'available') return { annualizable: false, reason: reading.state }
  const value = reading.values[field]
  if (value === undefined) return { annualizable: false, reason: 'no-value' }
  const multiplier = annualizationMultiplier(frequency)
  return { annualizable: true, annualized: value * multiplier, multiplier, frequency }
}
