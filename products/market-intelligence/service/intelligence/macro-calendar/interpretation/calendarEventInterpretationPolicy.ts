import { createHash } from 'node:crypto'

/**
 * 日历事件的「AI 解读」判据（R36 #34 第二半，产品口径见 `01-prd.md` v2 §0、技术方案 `02-tech-design.md` §4）。
 *
 * 这一层是**纯函数**，不碰库、不调模型：档门控、`data_key`、事实校验都在这儿，好被用例逐条钉住。
 *
 * 三条产品定死的规矩：
 * - **高档自动生成一次、中档点开生成一次并落库、低档与未分级不生成**——「不生成」不是少做一步，
 *   是把这一档排除在模型预算之外；把低档也生成，是拿读者的钱买一段没人要的解读。
 * - **同一份数据只生成一次**：`data_key` 由 (实际值, 预期, 前值) 三项的展示串算出；同一 `data_key`
 *   再点开不重新调模型，变了才允许新的一行。
 * - **只查事实，不查句式**：文里引用的每个数字都必须能在冻结信封里找到出处，否则按
 *   `fact-mismatch` 落失败标记——不写句式白名单，那会把好的说法一起判红。
 */

/** 档 → 生成时机。`never` 是「这一档不生成」，不是「暂时没生成」。 */
export type CalendarInterpretationTier = 'auto' | 'on-open' | 'never'

export function calendarInterpretationTier(importance: 'high' | 'medium' | 'low' | undefined): CalendarInterpretationTier {
  if (importance === 'high') return 'auto'
  if (importance === 'medium') return 'on-open'
  // 低档与未分级同一结果：不生成。未分级是「我们还没判」，不是「低」——但两者都不花这笔钱。
  return 'never'
}

/** 解读只看这三项：实际值、预期、前值。任意一项变了，解读该重写。 */
export type CalendarInterpretationValues = Readonly<{
  actual?: string
  consensus?: string
  previous?: string
}>

/**
 * 数据指纹：把三项展示串按固定顺序拼起来取 sha256。
 *
 * **用展示串、不用数值**：源给的格式（`3.2%` / `165K` / `-0.3`）本身就是事实的一部分，
 * 归一成数值再算指纹，会让 `3.20%` 与 `3.2%` 这种源侧改写悄悄复用旧解读。
 */
export function calendarInterpretationDataKey(values: CalendarInterpretationValues): string {
  const canonical = [values.actual ?? '', values.consensus ?? '', values.previous ?? ''].map((value) => value.trim())
  return createHash('sha256').update(canonical.join('\u0001')).digest('hex')
}

/** 失败标记的闭集。表外一律落 `provider-error`，不新造词。 */
export const calendarInterpretationFailureCodes = [
  'model-unavailable', 'provider-error', 'timeout', 'invalid-output', 'fact-mismatch'
] as const
export type CalendarInterpretationFailureCode = (typeof calendarInterpretationFailureCodes)[number]

/** 信封里允许被引用的数字（规范化后）：展示串里的数字 + 统计期/发布日里的数字。 */
export function interpretationAllowedNumbers(envelope: unknown): ReadonlySet<string> {
  const numbers = new Set<string>()
  const visit = (value: unknown, key?: string): void => {
    if (typeof value === 'number' && Number.isFinite(value)) { numbers.add(normalizeNumber(String(value))); return }
    if (typeof value === 'string') {
      // 只有「值」字段里的数字算出处：`3.2%`、`165K`、`-0.3`。键名与自由文本里的数字不算。
      if (key === undefined || !valueFieldNames.has(key)) return
      for (const match of value.matchAll(NUMBER_TOKEN)) numbers.add(normalizeNumber(match[0]!))
      return
    }
    if (Array.isArray(value)) { value.forEach((item) => visit(item, key)); return }
    if (value !== null && typeof value === 'object') {
      for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) visit(child, childKey)
    }
  }
  visit(envelope)
  return numbers
}

/** 冻结信封里哪些字段是「值」——只有它们里的数字可以作为引用出处。 */
const valueFieldNames = new Set([
  'actual', 'previous', 'consensus', 'displayValue', 'value',
  // 期次与标题里的数字也是这条事件的事实（「10 月」「第三季度」）：解读引用它们不算编造。
  'periodKey', 'period', 'scheduledDate', 'releaseDate', 'title'
])
const NUMBER_TOKEN = /-?\d+(?:\.\d+)?/gu

function normalizeNumber(token: string): string {
  const value = Number(token.replaceAll(',', ''))
  return Number.isFinite(value) ? String(value) : token
}

/**
 * 文里引用的每个数字都要有出处。
 *
 * 这是**事实校验**，不是句式校验：它不管句子怎么说，只管「你引用的 3.2 在不在快照里」。
 * 找不到就是模型自己造了一个数——那一段不能给读者看，落 `fact-mismatch`。
 */
export function interpretationCitesOnlyEnvelopeNumbers(text: string, envelope: unknown): boolean {
  const allowed = interpretationAllowedNumbers(envelope)
  for (const match of text.matchAll(NUMBER_TOKEN)) {
    if (!allowed.has(normalizeNumber(match[0]!))) return false
  }
  return true
}

/** 输出形状与长度的硬边界：太短等于没写，太长是模型把整份快照复述了一遍。 */
export const calendarInterpretationTextPolicy = Object.freeze({ minimumChars: 20, maximumChars: 600 })

export function interpretationTextFits(text: string): boolean {
  const trimmed = text.trim()
  return trimmed.length >= calendarInterpretationTextPolicy.minimumChars &&
    trimmed.length <= calendarInterpretationTextPolicy.maximumChars
}