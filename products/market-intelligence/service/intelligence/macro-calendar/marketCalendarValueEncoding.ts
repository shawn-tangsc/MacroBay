/**
 * **标准表 `values_json` 里的值只能是展示字符串**，不是对象、不是对象的 JSON 文本。
 *
 * 事故（用户 2026-11-18）：日报里的 `previous` 是 `"{\"displayValue\":\"4.7%\"}"`——
 * 一次性补库脚本把观测表那三列（`provider_previous_json` / `consensus_json` /
 * `provider_actual_json`，存的都是 `{displayValue}` 的 **JSON 文本**）当字符串塞进了值对象，
 * 外层又 `JSON.stringify` 一次，于是双重编码。605 行受影响，日报读出来就是一个 JSON 串。
 *
 * 这里的规矩只有一条：**解释值编码的地方只有这一处**。
 * - 观测表的 `{displayValue}` 文本 → 展示字符串：`displayValueFromJson`；
 * - 写标准表之前：`normalizeValuesJsonForWrite` 把「字符串化的对象」解码回裸字符串；
 *   解不开就**拒写**（抛 `value-encoding-invalid`），绝不「原样入库 + 报警」。
 *
 * 读侧不再做第二套解释：数据统一在写入端收敛，日报/AI/导出读到的都是裸字符串。
 */
export const calendarValueEncodingErrorCode = 'value-encoding-invalid' as const

/** 值字段里出现这种前缀，说明它是被字符串化的 `{displayValue}` 对象。 */
const STRINGIFIED_DISPLAY_VALUE_PREFIX = '{"displayValue"'

/** 值对象的**结构部分**：展示串、源自报的数值、单位。三者都可能缺席。 */
export type CalendarSourceValueText = Readonly<{ displayValue?: string; numericValue?: number; unit?: string }>

/**
 * 观测表/修订表那一列（`{"displayValue":"4.7%","numericValue":4.7,"unit":"percent"}` 的文本）
 * → 值对象里**能用的那几项**。
 *
 * 这是「解释值编码」的唯一入口：展示串、数值、单位都从这里取，**别处不许再 JSON.parse 一遍**。
 * 解析不出、或三项全缺 → `undefined`：**该字段缺席**，不拿原文顶、不填空串
 * （两者都会被读成「来源给了个怪值」或「确实没有」）。
 */
export function valueObjectFromJson(text: string | null | undefined): CalendarSourceValueText | undefined {
  if (text === null || text === undefined || text.trim() === '') return undefined
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return undefined }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const row = parsed as { displayValue?: unknown; numericValue?: unknown; unit?: unknown }
  const displayValue = typeof row.displayValue === 'string' && row.displayValue.trim() !== '' ? row.displayValue : undefined
  const numericValue = typeof row.numericValue === 'number' && Number.isFinite(row.numericValue) ? row.numericValue : undefined
  const unit = typeof row.unit === 'string' && row.unit.trim() !== '' ? row.unit : undefined
  if (displayValue === undefined && numericValue === undefined) return undefined
  return {
    ...(displayValue === undefined ? {} : { displayValue }),
    ...(numericValue === undefined ? {} : { numericValue }),
    ...(unit === undefined ? {} : { unit })
  }
}

/** 只要展示串的那一档（值字段是展示串，读侧不拿它做算术）。 */
export function displayValueFromJson(text: string | null | undefined): string | undefined {
  return valueObjectFromJson(text)?.displayValue
}

const VALUE_FIELDS = ['actual', 'previous', 'consensus'] as const
type ValueField = typeof VALUE_FIELDS[number]

const isStringifiedDisplayValue = (value: unknown): value is string =>
  typeof value === 'string' && value.trimStart().startsWith(STRINGIFIED_DISPLAY_VALUE_PREFIX)

/**
 * 写标准表之前的**唯一一道编码闸门**。
 *
 * - 裸字符串、数字以外的什么都不收：值字段本来就是展示串；
 * - 值是「字符串化的 `{displayValue}` 对象」→ 解码成裸字符串再写（单处解释）；
 * - 解不开 → 抛 `value-encoding-invalid`，**不写**。宁可这次写入失败被看见，
 *   也不许把双重编码的串放进库里让所有消费者各猜一遍。
 *
 * 其它字段原样保留，输出与输入的差异只在值字段上（正常数据逐字节不变）。
 */
export function normalizeValuesJsonForWrite(valuesJson: string): string {
  let parsed: unknown
  try { parsed = JSON.parse(valuesJson) } catch { throw new Error(calendarValueEncodingErrorCode) }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(calendarValueEncodingErrorCode)
  }
  const values = parsed as Record<string, unknown>
  let changed = false
  const fixed: Record<string, unknown> = { ...values }
  for (const field of VALUE_FIELDS) {
    const value = values[field as ValueField]
    if (!isStringifiedDisplayValue(value)) continue
    const decoded = displayValueFromJson(value)
    if (decoded === undefined) throw new Error(`${calendarValueEncodingErrorCode}:${field}`)
    fixed[field] = decoded
    changed = true
  }
  return changed ? JSON.stringify(fixed) : valuesJson
}
