/**
 * **国家码别名的唯一定义处**（Chief 2026-11-18：写入端与清理脚本都读这张表，禁止各写一份）。
 *
 * 源给的写法里有一批**不是 ISO alpha-3**，而是常见缩写或 IOC 码（`PHI` 是菲律宾的 IOC 码，
 * ISO 是 `PHL`），靠 alpha-3 反查永远命中不了它们。真库实测到的就是下面这些。
 *
 * 口径：**`EMU` 是唯一允许的非 ISO alpha-2**（欧元区不是一个国家，但它是我们库里的一种识别）；
 * 其余一切都得归到两位。
 */
import { toAlpha2Country } from './marketCalendarMetricIdentity'

export const marketCalendarCountryAliases: Readonly<Record<string, string>> = Object.freeze({
  UK: 'GB', SIN: 'SG', INA: 'ID', PHI: 'PH', FRA: 'FR', ITA: 'IT', AUS: 'AU', GER: 'DE', USA: 'US',
  // `BEL`（比利时）是合法 alpha-3，但反查表里没有 `BE`——真库里它一直是三位写法。
  BEL: 'BE'
})

/** 允许留在库里的非 ISO alpha-2 例外（目前只有欧元区）。 */
export const marketCalendarCountryCodeExceptions: readonly string[] = Object.freeze(['EMU'])

/**
 * 是不是「**归不成两位**的码」——判定标准是**能不能归成两位**，不是长度是不是 2（Chief 2026-11-18）。
 *
 * 按长度判会把合法 ISO alpha-3（`JPN`/`CAN`/`CHN`）误判成未知码：它们能反查成 JP/CA/CN，
 * 真库里正是要归一的那 47 行——误判的后果不是「没归一」，而是**被当未知码跳过、行直接丢了**。
 *
 * 归一逻辑**只跑 `toAlpha2Country` 那一份**，这里不再写第二套判定（一处定义）。
 */
export function isUnknownCountryCode(code: string): boolean {
  if (marketCalendarCountryCodeExceptions.includes(code)) return false
  const alpha2 = toAlpha2Country(code)
  // 能变成两位 = 认得出；原样返回且本身就不是两位 = 归不了。
  return alpha2 === code && !/^[A-Z]{2}$/.test(code)
}
