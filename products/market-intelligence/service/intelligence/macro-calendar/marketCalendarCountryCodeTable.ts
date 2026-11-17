/**
 * **按国家建出的码空间（第一批）**：由 `37-族名别名表.csv` 的 `new`/`fix-split`/`alias` 三段
 * 消费源标题生成，族名一律取 CSV 的规范写法（**不现场发明**）。
 *
 * 三条口径写死在这里：
 * - **`tier` 全 `null`**：分级是「谁看、看了会改变什么判断」，不能从标题推，也不许默认给；
 * - **官网页 `pending` + 理由**：机构页要逐条核到 200 才能填，没核的一律挂着；
 * - **中文名只放中文**：源只给英文时 `zhFull/zhShort` 留空并标 `pending:name-incomplete`，
 *   不把英文塞进中文列（塞进去以后没有任何地方看得出缺了名）。
 *
 * 去重键是「国家 + 族 + 测度 + 季调」：族名相同不算重复，`INDUSTRIAL_PROFITS` 本来就有月率与年率两种码。
 */
import rawCountryCodeTable from './marketCalendarCountryCodeTable.json'
import type { CodeTableRow } from './marketCalendarCodeTable'

/** 与 `CodeTableRow` **同一形状**：并成一个视图时不该有两套字段。 */
export type CountryCodeRow = CodeTableRow

/**
 * **数据文件（JSON）在读时校验一次**，`tsc` 不执行代码，所以「形状不对」只能在这里炸——
 * 炸的时候点名是哪个码、哪个字段，而不是让一个 `undefined` 一路走到界面上变成空白格。
 */
const asCountryRow = (key: string, value: unknown): CountryCodeRow => {
  const row = value as Partial<CountryCodeRow> & { names?: Partial<CodeTableRow['names']> }
  const where = `代码表 ${key}`
  if (row.code !== key) throw new Error(`${where}：键与 code 不一致`)
  if (row.kind !== 'metric' && row.kind !== 'event') throw new Error(`${where}：kind 非法`)
  if (typeof row.countryCode !== 'string' || !/^[A-Z]{2}$|^EMU$/.test(row.countryCode)) {
    throw new Error(`${where}：countryCode 非法（${String(row.countryCode)}）`)
  }
  for (const field of ['zhFull', 'zhShort', 'enFull', 'enShort'] as const) {
    if (typeof row.names?.[field] !== 'string') throw new Error(`${where}：names.${field} 缺失`)
  }
  if (row.status !== 'active' && row.status !== 'not-built' && row.status !== 'pending' && row.status !== 'retired') {
    throw new Error(`${where}：status 非法`)
  }
  return value as CountryCodeRow
}

export const marketCalendarCountryCodeTable: Readonly<Record<string, CountryCodeRow>> = Object.freeze(
  Object.fromEntries(Object.entries(rawCountryCodeTable as unknown as Record<string, unknown>)
    .map(([key, value]) => [key, asCountryRow(key, value)])))
