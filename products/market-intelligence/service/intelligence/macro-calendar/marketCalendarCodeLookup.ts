import { marketCalendarCodeTable, type CodeTableRow } from './marketCalendarCodeTable'
import { marketCalendarCountryCodeTable } from './marketCalendarCountryCodeTable'

/**
 * **码表查表的唯一入口**（架构师 2026-11-25 复核，Chief 同日定）。
 *
 * 两个码空间：**主码表**（策划码，225 条）与**按国家码表**（按源标题生成，616 条）。两张表**不重叠**
 * （交集实测为空，由「两张码表不许有重复码」那条守卫钉住），所以并集无歧义——但**只用一次判定**：
 * 各处不许自己写 `main[x] ?? country[x]`，否则「先查哪张」这件事会散成 N 份，改一处不够。
 *
 * 返回值里的 `table` 是**查询结果**，不是优先级声明：一条码只住在一张表里，命中的那张就是它所在的表。
 */
export type CalendarCodeLookup =
  | Readonly<{ found: true; table: 'main' | 'country'; code: string; row: CodeTableRow }>
  | Readonly<{ found: false; code: string }>

export function resolveCalendarCode(code: string): CalendarCodeLookup {
  const main = marketCalendarCodeTable[code]
  if (main !== undefined) return { found: true, table: 'main', code, row: main }
  const country = marketCalendarCountryCodeTable[code]
  if (country !== undefined) return { found: true, table: 'country', code, row: country }
  return { found: false, code }
}

/** 两张码表里是否存在这个码（查表的布尔形式，语义与 `resolveCalendarCode` 同一处实现）。 */
export function calendarCodeExists(code: string): boolean {
  return resolveCalendarCode(code).found
}
