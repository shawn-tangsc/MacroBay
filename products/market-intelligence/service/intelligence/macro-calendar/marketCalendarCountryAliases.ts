/**
 * **国家码别名的唯一定义处**（Chief 2026-11-18：写入端与清理脚本都读这张表，禁止各写一份）。
 *
 * 源给的写法里有一批**不是 ISO alpha-3**，而是常见缩写或 IOC 码（`PHI` 是菲律宾的 IOC 码，
 * ISO 是 `PHL`），靠 alpha-3 反查永远命中不了它们。真库实测到的就是下面这些。
 *
 * 口径：**`EMU` 是唯一允许的非 ISO alpha-2**（欧元区不是一个国家，但它是我们库里的一种识别）；
 * 其余一切都得归到两位。
 */
export const marketCalendarCountryAliases: Readonly<Record<string, string>> = Object.freeze({
  UK: 'GB', SIN: 'SG', INA: 'ID', PHI: 'PH', FRA: 'FR', ITA: 'IT', AUS: 'AU', GER: 'DE', USA: 'US',
  // `BEL`（比利时）是合法 alpha-3，但反查表里没有 `BE`——真库里它一直是三位写法。
  BEL: 'BE'
})

/** 允许留在库里的非 ISO alpha-2 例外（目前只有欧元区）。 */
export const marketCalendarCountryCodeExceptions: readonly string[] = Object.freeze(['EMU'])
