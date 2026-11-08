/**
 * 「日历事件 → 发生后 → 哪些国家的数据」的契约：名单、范围、默认值、上限与匹配语义。
 *
 * 事实依据（2026-11-08 实测，本机 `macro-calendar.sqlite`）：`country_code` 只有三种取值——
 * `'US'`（1102 条）、`'DE'`（231 条）、`NULL`（1962 条）；即源值本身就是 ISO-3166 alpha-2 大写。
 * 所以这里**直接沿用源的码值**，不另造一套码表；`NULL` 与空串都是「国家未知」。
 *
 * 三条已确认的口径：
 * - **`GB` 不认 `UK`**：源里出现 `UK` 一律按未知处理，不做同义猜测。
 * - **缺键 = 可读 + 默认 `us`**：老文件没有这个键不是读失败（读失败另有判定）。
 * - **未知档位 / 未知国家码 = 可读 + 回默认**，不是读失败。
 */

/** 封闭 8 国，顺序即界面上「美国与主要经济体」说明里的顺序：美、加、英、德、法、意、日、中。 */
export const CALENDAR_LANDED_COUNTRY_CODES = ['US', 'CA', 'GB', 'DE', 'FR', 'IT', 'JP', 'CN'] as const

export type CalendarLandedCountryCode = (typeof CALENDAR_LANDED_COUNTRY_CODES)[number]

/**
 * 上限与名单**同源**、写死在契约：名单扩一寸，上限跟着变，不需要第二个常量。
 * 扩名单必须产品签字并在同一笔里复核上限——运行时可配会制造「上限 12、名单 8」这种不可达状态。
 */
export const MAX_CALENDAR_LANDED_COUNTRIES = CALENDAR_LANDED_COUNTRY_CODES.length

/**
 * 三档范围。**没有 `major`**，而且不许以后有人加回来：
 *
 * `major` 曾是「8 个具名国家」，`all` 是「major + 国家未知」。实测库里具名数据只有 US / DE，
 * 而 1962 条国家为空；读者关心的「中国·外汇储备」正落在"未知"那批里。于是 `major` 下的中国数据
 * 永远不响——是个假承诺；改成包含未知，又与 `all` 完全重合。两头都不成立，所以这一档被删掉，
 * 而不是"保留但不用"。
 */
export const CALENDAR_LANDED_COUNTRY_SCOPES = ['us', 'all', 'custom'] as const

export type CalendarLandedCountryScope = (typeof CALENDAR_LANDED_COUNTRY_SCOPES)[number]

export type CalendarLandedCountrySelection = Readonly<{
  scope: CalendarLandedCountryScope
  /** 仅 `custom` 使用；其余范围恒为空数组。 */
  codes: readonly CalendarLandedCountryCode[]
}>

/** 默认「只美国」：改版不放大推送量，读者不动它就和今天一模一样。 */
export const DEFAULT_CALENDAR_LANDED_COUNTRIES: CalendarLandedCountrySelection = Object.freeze({
  scope: 'us',
  codes: Object.freeze([])
})

export function isCalendarLandedCountryCode(value: unknown): value is CalendarLandedCountryCode {
  return typeof value === 'string' && (CALENDAR_LANDED_COUNTRY_CODES as readonly string[]).includes(value)
}

export function isCalendarLandedCountryScope(value: unknown): value is CalendarLandedCountryScope {
  return typeof value === 'string' && (CALENDAR_LANDED_COUNTRY_SCOPES as readonly string[]).includes(value)
}

/**
 * 把存下来的值收敛成合法选择：**任何不合法都回默认**（可读、不迁移、不回写）。
 * `custom` 里重复的码只保留第一次出现；超过上限、出现未知码，整条回默认——不悄悄删掉一两个
 * 再宣称存过，那会让读者以为自己的选择还在。
 */
export function normalizeCalendarLandedCountries(value: unknown): CalendarLandedCountrySelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_CALENDAR_LANDED_COUNTRIES
  const record = value as { scope?: unknown; codes?: unknown }
  if (!isCalendarLandedCountryScope(record.scope)) return DEFAULT_CALENDAR_LANDED_COUNTRIES
  if (record.scope !== 'custom') return Object.freeze({ scope: record.scope, codes: Object.freeze([]) })

  if (!Array.isArray(record.codes)) return DEFAULT_CALENDAR_LANDED_COUNTRIES
  const codes: CalendarLandedCountryCode[] = []
  for (const entry of record.codes) {
    if (!isCalendarLandedCountryCode(entry)) return DEFAULT_CALENDAR_LANDED_COUNTRIES
    if (!codes.includes(entry)) codes.push(entry)
  }
  if (codes.length === 0 || codes.length > MAX_CALENDAR_LANDED_COUNTRIES) return DEFAULT_CALENDAR_LANDED_COUNTRIES
  return Object.freeze({ scope: 'custom', codes: Object.freeze(codes) })
}

/**
 * 「这条事件算不算选中的国家」——唯一判定，消费侧只读它。
 *
 * - `us`：只美国，**不含未知**；
 * - `all`：任何国家，**包含未知**（源没给国家的条目——库里 1962 条 NULL）；
 * - `custom`：只勾中的码，**未知不可勾**（界面必须写明这个代价：没给国家的条目不会提醒）。
 *
 * 因此三档在「未知」上的行为两两不同：`all` 收、`us` 与 `custom` 都不收。
 */
export function calendarLandedCountryMatches(
  selection: CalendarLandedCountrySelection,
  countryCode: string | null | undefined
): boolean {
  const code = typeof countryCode === 'string' ? countryCode.trim().toUpperCase() : ''
  const known = isCalendarLandedCountryCode(code) ? code : null
  switch (selection.scope) {
    case 'us':
      return known === 'US'
    case 'all':
      return true
    case 'custom':
      return known !== null && selection.codes.includes(known)
    default:
      return false
  }
}
