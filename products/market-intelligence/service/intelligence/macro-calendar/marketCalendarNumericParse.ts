/**
 * **展示串 → 数值**（方案 `macro-calendar-numeric-values-plan.md` §2，架构师 2026-11-21）。
 *
 * 日历只存展示串，全库数值列 0 条，跨源比较与年度化「既不能证实也不能否证」。这一层只有一件事：
 * 把源给的展示串解成「数值 + 小数位 + 单位」，交给写入口原样落进 `numeric_json`。
 *
 * 三条边界：
 * 1. **只有这个文件认识展示串的写法**：别的层（写入口、读侧）一律不 parse；
 * 2. **不做单位换算**：源给 `1234 thousand` 就是 `1234` + `thousands`，不折成 1234000；
 * 3. **解不出就是解不出**：`"--"` 这类占位落 `unparsed`，**绝不写 0**（0 是真值，两者必须分开）。
 *
 * 依赖方向：这里只依赖单位闭集映射（`marketCalendarNumericUnits`），**它是单向的**——单位模块只以
 * `import type` 取本文件的 `CalendarNumericUnit`，运行时没有环。
 */
import { calendarNumericUnitFromSource } from './marketCalendarNumericUnits'

export type CalendarNumericUnit =
  | 'percent' | 'thousands' | 'millions' | 'billions' | 'count' | 'index' | 'ratio' | 'usd' | 'bps' | 'unknown'

export const calendarNumericUnits: readonly CalendarNumericUnit[] = Object.freeze([
  'percent', 'thousands', 'millions', 'billions', 'count', 'index', 'ratio', 'usd', 'bps', 'unknown'
])

export type CalendarNumericState = 'available' | 'missing' | 'unparsed'
export const CALENDAR_NUMERIC_PARSER_VERSION = 'calendar-numeric-v1'

export type CalendarNumericField = 'actual' | 'previous' | 'consensus'
export const calendarNumericFields: readonly CalendarNumericField[] = Object.freeze(['actual', 'previous', 'consensus'])

export type CalendarNumericParseReason = 'empty' | 'placeholder' | 'unrecognized'

export type CalendarNumericParseResult =
  | Readonly<{ value: number; decimals: number; unit: CalendarNumericUnit }>
  | Readonly<{ reason: CalendarNumericParseReason }>

/** `numeric_json` 的形状（§1）。`values`/`decimals` 只放解成功的字段，缺席＝该字段没有。 */
export type CalendarNumericJson = Readonly<{
  v: 1
  state: CalendarNumericState
  unit?: CalendarNumericUnit
  values?: Readonly<Partial<Record<CalendarNumericField, number>>>
  decimals?: Readonly<Partial<Record<CalendarNumericField, number>>>
  parserVersion: string
}>

const PLACEHOLDERS = new Set(['--', '—', '-', '−', 'n/a', 'na', 'n.a.', '...', '…'])

/**
 * 解一个展示串。认识的写法只有四种（方案 §2 明写）：`4.1%`、`4.1`、`165K`、`1,234`。
 * 别的写法一律 `unrecognized`——**不套通用正则硬啃**，啃错比不解更贵。
 */
export function parseCalendarDisplayNumber(
  text: string,
  hints?: Readonly<{ unit?: CalendarNumericUnit }>
): CalendarNumericParseResult {
  const raw = text.trim()
  if (raw === '') return { reason: 'empty' }
  if (PLACEHOLDERS.has(raw.toLowerCase())) return { reason: 'placeholder' }
  let body = raw
  let unit: CalendarNumericUnit | undefined
  if (body.endsWith('%')) {
    unit = 'percent'
    body = body.slice(0, -1).trim()
  } else {
    const suffix = /^(.*?)([KkMmBb])$/.exec(body)
    if (suffix !== null) {
      unit = suffix[2]!.toLowerCase() === 'k' ? 'thousands' : suffix[2]!.toLowerCase() === 'm' ? 'millions' : 'billions'
      body = suffix[1]!.trim()
    }
  }
  // 整数部分允许千分位逗号，小数部分只允许数字；符号只允许一个正负号。
  const match = /^([+-]?)(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d+))?$/.exec(body)
  if (match === null) return { reason: 'unrecognized' }
  const value = Number(`${match[1] ?? ''}${(match[2] ?? '').replace(/,/g, '')}${match[3] === undefined ? '' : `.${match[3]}`}`)
  if (!Number.isFinite(value)) return { reason: 'unrecognized' }
  return { value, decimals: match[3]?.length ?? 0, unit: unit ?? hints?.unit ?? 'unknown' }
}

/**
 * 源侧的一个值：官方源（BLS/BEA/Fed）与观测表里存的是整个值对象，**可能自带数值与单位**。
 * 源给了数就用源的数（那是事实），没有才解析展示串——反过来会把源给的高精度值换成展示串的四舍五入值。
 */
export type CalendarNumericSourceValue = Readonly<{
  displayValue?: string
  numericValue?: number
  unit?: string
}>

/** 数值本身的小数位（源只给数值、没给展示串时用）。指数写法不猜位数，按 0 处理。 */
function decimalsOfNumber(value: number): number {
  const text = String(value)
  if (text.includes('e') || text.includes('E')) return 0
  const dot = text.indexOf('.')
  return dot === -1 ? 0 : text.length - dot - 1
}

/**
 * 一行三个值字段（**源值对象**）→ `numeric_json`。
 *
 * 每个字段的取法固定：源的 `numericValue` → 解析展示串 → `unparsed`（计数，不写 0）。
 * 单位按「源声明 → 展示串写法 → 量纲提示（`hints`）」的顺序取，不做换算。
 *
 * `unparsedFields` 是**字段级**计数：一个字段解不出来就要看得见，即使别的字段解出来了
 * （否则「previous 是 `--`」这种半截数据会静默消失）。
 */
export function calendarNumericJsonFromSourceValues(
  fields: Readonly<Partial<Record<CalendarNumericField, CalendarNumericSourceValue>>>,
  hints?: Readonly<{ unit?: CalendarNumericUnit }>
): Readonly<{ json: string; state: CalendarNumericState; unparsedFields: number }> {
  const values: Partial<Record<CalendarNumericField, number>> = {}
  const decimals: Partial<Record<CalendarNumericField, number>> = {}
  const parseHints = hints?.unit === undefined ? undefined : { unit: hints.unit }
  let unit: CalendarNumericUnit | undefined
  let present = false
  let unparsedFields = 0
  for (const field of calendarNumericFields) {
    const source = fields[field]
    if (source === undefined) continue
    const display = typeof source.displayValue === 'string' ? source.displayValue.trim() : ''
    const numericValue = typeof source.numericValue === 'number' && Number.isFinite(source.numericValue)
      ? source.numericValue : undefined
    if (display === '' && numericValue === undefined) continue
    present = true
    const declared = calendarNumericUnitFromSource(source.unit)
    const parsed = display === '' ? undefined : parseCalendarDisplayNumber(display, parseHints)
    const parsedValue = parsed !== undefined && !('reason' in parsed) ? parsed : undefined
    if (numericValue !== undefined) {
      values[field] = numericValue
      // 小数位首先取展示串（源自己格式化出来的位数），源没给展示串才取数值本身。
      decimals[field] = parsedValue?.decimals ?? decimalsOfNumber(numericValue)
      unit ??= declared ?? (parsedValue !== undefined && parsedValue.unit !== 'unknown' ? parsedValue.unit : undefined) ?? hints?.unit
      continue
    }
    if (parsedValue === undefined) { unparsedFields += 1; continue }
    values[field] = parsedValue.value
    decimals[field] = parsedValue.decimals
    unit ??= declared ?? parsedValue.unit
  }
  const state: CalendarNumericState = Object.keys(values).length > 0 ? 'available' : present ? 'unparsed' : 'missing'
  const json: CalendarNumericJson = {
    v: 1,
    state,
    ...(unit === undefined ? {} : { unit }),
    ...(state === 'available' ? { values, decimals } : {}),
    parserVersion: CALENDAR_NUMERIC_PARSER_VERSION
  }
  return { json: JSON.stringify(json), state, unparsedFields }
}

/** 一行三个值字段 → `numeric_json` 文本。`available` 只要求**至少一个**字段解出来。 */
export function calendarNumericJsonFor(
  fields: Readonly<Partial<Record<CalendarNumericField, string>>>,
  hints?: Readonly<{ unit?: CalendarNumericUnit }>
): Readonly<{ json: string; state: CalendarNumericState; unparsedFields: number }> {
  const values: Partial<Record<CalendarNumericField, number>> = {}
  const decimals: Partial<Record<CalendarNumericField, number>> = {}
  let unit: CalendarNumericUnit | undefined
  let present = false
  let unparsedFields = 0
  for (const field of calendarNumericFields) {
    const text = fields[field]
    if (text === undefined || text.trim() === '') continue
    present = true
    const parsed = parseCalendarDisplayNumber(text, hints)
    if ('reason' in parsed) { unparsedFields += 1; continue }
    values[field] = parsed.value
    decimals[field] = parsed.decimals
    unit ??= parsed.unit
  }
  const state: CalendarNumericState = Object.keys(values).length > 0 ? 'available' : present ? 'unparsed' : 'missing'
  const json: CalendarNumericJson = {
    v: 1,
    state,
    ...(unit === undefined ? {} : { unit }),
    ...(state === 'available' ? { values, decimals } : {}),
    parserVersion: CALENDAR_NUMERIC_PARSER_VERSION
  }
  return { json: JSON.stringify(json), state, unparsedFields }
}

/**
 * 写入口用：**不解析展示串**，只根据「有没有展示串」给出状态。
 *
 * 有展示串却没有 `numeric_json` ⇒ `unparsed`（**我们的问题**，要计数）；没有展示串 ⇒ `missing`
 * （源没给）。这一条正是「写入口不 parse」的守卫：即使展示串完全可解析，也不会在这里算出数值。
 */
export function numericJsonWithoutParse(valuesJson: string): Readonly<{ json: string; state: CalendarNumericState }> {
  let hasDisplay = false
  try {
    const values = JSON.parse(valuesJson) as Record<string, unknown>
    hasDisplay = calendarNumericFields.some((field) => {
      const value = values[field]
      return typeof value === 'string' && value.trim() !== ''
    })
  } catch { hasDisplay = false }
  const state: CalendarNumericState = hasDisplay ? 'unparsed' : 'missing'
  return {
    json: JSON.stringify({ v: 1, state, parserVersion: CALENDAR_NUMERIC_PARSER_VERSION } satisfies CalendarNumericJson),
    state
  }
}

/** 形状校验（写入口用）：字段类型与闭集都对，才算一份合法的 `numeric_json`。 */
export function isCalendarNumericJson(value: unknown): value is CalendarNumericJson {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  if (row.v !== 1) return false
  if (row.state !== 'available' && row.state !== 'missing' && row.state !== 'unparsed') return false
  if (typeof row.parserVersion !== 'string' || row.parserVersion.trim() === '') return false
  if (row.unit !== undefined && !calendarNumericUnits.includes(row.unit as CalendarNumericUnit)) return false
  if (row.values !== undefined) {
    if (typeof row.values !== 'object' || row.values === null) return false
    for (const [key, item] of Object.entries(row.values as Record<string, unknown>)) {
      if (!calendarNumericFields.includes(key as CalendarNumericField) || typeof item !== 'number' || !Number.isFinite(item)) return false
    }
  }
  if (row.decimals !== undefined) {
    if (typeof row.decimals !== 'object' || row.decimals === null) return false
    for (const [key, item] of Object.entries(row.decimals as Record<string, unknown>)) {
      if (!calendarNumericFields.includes(key as CalendarNumericField)
        || typeof item !== 'number' || !Number.isInteger(item) || item < 0 || item > 6) return false
    }
  }
  return true
}

/** 读侧四态（§3.2）：NULL＝加列前写的（数值未记录），其余取 `state`。 */
export function calendarNumericStateOf(json: string | null | undefined):
  Readonly<{ state: CalendarNumericState | 'unrecorded'; reason?: string }> {
  if (json === null || json === undefined || json.trim() === '') return { state: 'unrecorded' }
  try {
    const parsed: unknown = JSON.parse(json)
    if (!isCalendarNumericJson(parsed)) return { state: 'unrecorded', reason: 'shape-invalid' }
    return { state: parsed.state }
  } catch { return { state: 'unrecorded', reason: 'json-invalid' } }
}