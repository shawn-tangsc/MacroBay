/**
 * **标准码表：所有东西的唯一真源**（用户 2026-11-17：码表为主、映射为从；官网只从这里拿）。
 *
 * 名表、分级、子项、官网页全部从这张表派生；映射表每一行的码都必须在这张表里，否则不许入库。
 *
 * `officialSource` 要么是机构页（带 `verifiedAt` 与 basis），要么是 `pending` + 闭集理由——**没有第三种，
 * 也没有空链接**。查不到的写 `official-source-todo`，不许拿聚合站凑。
 *
 * 注意：表里存的是**机构页**，不是「这一场发布的具体页面」。要指向某一场，得用发布键去拼，那是另一件事。
 */
export type OfficialSource = Readonly<{ agency: string; url: string; pageKind: 'release' | 'data-api' | 'meeting' | 'statement'; verifiedAt: string; basis: string }>
export type CodeStatus = 'active' | 'not-built' | 'pending' | 'retired'
export type NotBuiltReason = 'duplicate-scope' | 'no-reader' | 'second-identity' | 'measure-unclear'
export type PendingReason =
  | 'official-source-todo' | 'source-name-broken' | 'awaiting-data' | 'period-unresolved' | 'name-incomplete'

export const codeTableReasonSets = Object.freeze({
  'not-built': Object.freeze(['duplicate-scope', 'no-reader', 'second-identity', 'measure-unclear'] as const),
  pending: Object.freeze(['official-source-todo', 'source-name-broken', 'awaiting-data', 'period-unresolved', 'name-incomplete'] as const)
})

export type CodeTableRow = Readonly<{
  code: string
  kind: 'metric' | 'event'
  /** 指标取码前缀（`US.`/`DE.`）；没有国家的写 null，不猜。`EMU` 是唯一非 ISO 例外。 */
  countryCode: string | null
  names: Readonly<{ zhFull: string; zhShort: string; enFull: string; enShort: string }>
  tier: 1 | 2 | 3 | null
  parentCode: string | null
  childOrder: number | null
  measure: string
  seasonality: string
  officialSource: OfficialSource | Readonly<{ pending: true; reason: PendingReason }>
  status: CodeStatus
  reason?: NotBuiltReason | PendingReason
  supersededBy?: string
  /**
   * **官方序列**（Chief 2026-11-19 评审第一条）：序列号、换算方式、频率**只存在码表里**，
   * 不许再开第二张 per-code 表（同一个指标的口径已经散过三次）。空 = **待核**，不许填猜的。
   * `units` 只放源侧换算（`pc1` 同比 / `pch` 环比 / `value` 直取）——**自算同比环比一律不许**。
   */
  officialSeries?: Readonly<{ seriesId?: string; units?: 'pc1' | 'pch' | 'value'; frequency: 'weekly' | 'monthly' | 'quarterly' }>
  /**
   * **期次从哪来**（架构师第 4 条）：`source` 源直接给、`title` 从标题解析、
   * `release-structure` 按发布结构推（**仅周度 + 白名单码**，当前只有 3 个初请码）。
   * 推导出来的期次必须在行上留痕，否则事后分不清「源给的」和「我们推的」。
   */
  periodDerivation?: 'source' | 'title' | 'release-structure'
}>

const OFFICIAL_SOURCE_PENDING = 'official-source-todo' as const

import rawCodeTable from './marketCalendarCodeTable.json'

/**
 * **数据文件（JSON）在读时校验一次**：`tsc` 不执行代码，形状对不对只能在这里炸，并且点名是哪个码、
 * 哪个字段——不校验的话，一个 `undefined` 会一路走到界面上变成一个空白格。
 */
function asCodeTable(raw: Record<string, unknown>): Record<string, CodeTableRow> {
  const out: Record<string, CodeTableRow> = {}
  for (const [key, value] of Object.entries(raw)) {
    const row = value as Partial<CodeTableRow> & { names?: Partial<CodeTableRow['names']> }
    const where = `代码表 ${key}`
    if (row.code !== key) throw new Error(`${where}：键与 code 不一致`)
    if (row.kind !== 'metric' && row.kind !== 'event') throw new Error(`${where}：kind 非法`)
    for (const field of ['zhFull', 'zhShort', 'enFull', 'enShort'] as const) {
      if (typeof row.names?.[field] !== 'string') throw new Error(`${where}：names.${field} 缺失`)
    }
    if (row.status !== 'active' && row.status !== 'not-built' && row.status !== 'pending' && row.status !== 'retired') {
      throw new Error(`${where}：status 非法`)
    }
    out[key] = value as CodeTableRow
  }
  return out
}


export const marketCalendarCodeTable: Readonly<Record<string, CodeTableRow>> = Object.freeze({
  ...asCodeTable(rawCodeTable as unknown as Record<string, unknown>)
})
