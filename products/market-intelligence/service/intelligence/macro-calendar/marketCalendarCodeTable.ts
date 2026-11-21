/**
 * **标准码表：所有东西的唯一真源**（用户 2026-11-17：码表为主、映射为从；官网只从这里拿）。
 *
 * 名表、分级、子项、官网页全部从这张表派生；映射表每一行的码都必须在这张表里，否则不许入库。
 *
 * `officialSource` 要么是机构页（带 `verifiedAt` 与 basis），要么是 `pending` + 闭集理由——**没有第三种，
 * 也没有空链接**。待补理由必须分开两种事实（用户 2026-11-01：「没有」与「拿不到」不许混成一句）：
 * `official-source-todo`＝**我们还没能核到机构页**（查了，但这台机器被 403/Akamai 挡，或还没排到）；
 * `official-source-not-public`＝**机构没有可匿名、可长期引用的稳定发布页或数据页**（每期 URL 变／
 * 需会员登记／需订阅），所以不填 URL、不填 `verifiedAt`——但**不说成「机构没有发布页」**（ISM 有公开月报 PDF）。
 * 查不到的写前者，不许拿聚合站凑。
 *
 * 注意：表里存的是**机构页**，不是「这一场发布的具体页面」。要指向某一场，得用发布键去拼，那是另一件事。
 */
export type OfficialSource = Readonly<{ agency: string; url: string; pageKind: 'release' | 'data-api' | 'meeting' | 'statement'; verifiedAt: string; basis: string }>
export type CodeStatus = 'active' | 'not-built' | 'pending' | 'retired'
export type NotBuiltReason = 'duplicate-scope' | 'no-reader' | 'second-identity' | 'measure-unclear'
export type PendingReason =
  | 'official-source-todo'
  /** 机构存在，但**没有可匿名、可长期引用的稳定发布页或数据页**（每期 URL 变／需会员登记／需订阅）；
   * 因此不填 URL、不填 `verifiedAt`。与「我们还没能核到」是两种事实，不许合并。 */
  | 'official-source-not-public'
  | 'source-name-broken' | 'awaiting-data' | 'period-unresolved' | 'name-incomplete'

export const codeTableReasonSets = Object.freeze({
  'not-built': Object.freeze(['duplicate-scope', 'no-reader', 'second-identity', 'measure-unclear'] as const),
  pending: Object.freeze([
    'official-source-todo', 'official-source-not-public',
    'source-name-broken', 'awaiting-data', 'period-unresolved', 'name-incomplete'
  ] as const)
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
   * `units` 只放源侧换算（`pc1` 同比 / `pch` 环比 / `value` 直取 / `chg` 变动）——**自算一律不许**。
   * `chg` 的来由：`PAYEMS` 是**就业人数水平**，我们要的是**变动**；用源侧 `units=chg`，
   * 而不是自己拿相邻两期相减（那是自算，红线）。
   */
  officialSeries?: Readonly<{ seriesId?: string; units?: 'pc1' | 'pch' | 'value' | 'chg'; frequency: 'weekly' | 'monthly' | 'quarterly' }>
  /**
   * **期次从哪来**（架构师第 4 条）：`source` 源直接给、`title` 从标题解析、
   * `release-structure` 按发布结构推（**仅周度 + 白名单码**，当前只有 3 个初请码）。
   * 推导出来的期次必须在行上留痕，否则事后分不清「源给的」和「我们推的」。
   */
  periodDerivation?: 'source' | 'title' | 'release-structure'
  /**
   * **可年度化**（方案 `macro-calendar-numeric-values-plan.md` §3.4）：只给流量型码标 `'flow'`。
   * 不给＝不可年度化（读侧返 `not-flow`，**不猜**）。
   *
   * 载入校验（`validateCodeTableRows`）三条，任一不合就炸：
   * ① `'flow'` 必须有 `officialSeries.frequency`（没有频率的系数是编出来的）；
   * ② 率类（百分比量纲，见 `codeTablePercentMeasures`）不许标——**利率年度化是错口径**；
   * ③ 取值只有 `'flow'` 一个，别的写法载入即红。
   */
  annualization?: 'flow'
}>

const OFFICIAL_SOURCE_PENDING = 'official-source-todo' as const

/**
 * **百分比量纲的 measure 闭集**：月率/季率/年率/年化季率/各种「率」。
 *
 * 这一份同时服务两处，**不许再抄第二份**：
 * ① 单位闭集映射（`marketCalendarNumericUnits` 把这几档映射成 `percent`）；
 * ② 年度化载入校验（这几档是**率**，不许标 `annualization:'flow'`——利率年度化是错口径）。
 */
export const codeTablePercentMeasures: readonly string[] = Object.freeze([
  'MOM', 'QOQ', 'YOY', 'ANNUALIZED_QOQ', 'RATE'
])

import rawCodeTable from './marketCalendarCodeTable.json'

/**
 * **数据文件（JSON）在读时校验一次**：`tsc` 不执行代码，形状对不对只能在这里炸，并且点名是哪个码、
 * 哪个字段——不校验的话，一个 `undefined` 会一路走到界面上变成一个空白格。
 */
export function validateCodeTableRows(raw: Record<string, unknown>): Record<string, CodeTableRow> {
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
    if (row.officialSeries !== undefined) {
      const frequency = (row.officialSeries as { frequency?: unknown }).frequency
      if (frequency !== 'weekly' && frequency !== 'monthly' && frequency !== 'quarterly') {
        throw new Error(`${where}：officialSeries.frequency 非法（${String(frequency)}）`)
      }
    }
    /**
     * 年度化标记的载入校验（方案 §3.4）：**只许流量码标 flow**，且必须有频率、量纲不是百分比。
     * 这里不是「建议」——标错的后果是利率被乘 12 当成流量，读侧算出来的数字看着还挺像。
     */
    if (row.annualization !== undefined) {
      if (row.annualization !== 'flow') throw new Error(`${where}：annualization 非法（${String(row.annualization)}），闭集只有 'flow'`)
      if (row.officialSeries === undefined) {
        throw new Error(`${where}：标了 annualization:'flow' 但没有 officialSeries.frequency——没有频率就没有年化系数`)
      }
      if (codeTablePercentMeasures.includes(String(row.measure))) {
        throw new Error(`${where}：率类（measure=${String(row.measure)}）是百分比量纲，不许标 annualization:'flow'——利率年度化是错口径`)
      }
    }
    /**
     * 闭集在运行时也要**真的执行**（架构师 2026-11-21 保留③：只补这两条，别扩范围）。
     *
     * ① 官网页待补理由：界面悬停句直接取自这一格，写错一个词，读者看到的
     *    「机构没有可长期引用的公开页」就会变成「我们还没能核到」——两种事实换了位，事后查不出来。
     *    今天 48 行走这条（那 48 条都是 `status:'active'` + `officialSource.pending:true`）。
     * ② 行级理由：状态为 `pending` / `not-built` 时，`reason` 必须取自对应闭集（今天 0 行，但闭集要有执行点）。
     *
     * **不许**在这里顺手加「active 不许带 row.reason」这类今天测不到的规则：它在 import 时抛，
     * 等于整个服务模块加载失败。fail-closed 只对**已经出现的事实**生效。
     */
    const source = row.officialSource as { pending?: unknown; reason?: unknown } | undefined
    if (source !== undefined && source.pending === true) {
      if (!(codeTableReasonSets.pending as readonly unknown[]).includes(source.reason)) {
        throw new Error(`${where}：官网页待补理由不在闭集里（${String(source.reason)}）`)
      }
    }
    if (row.status === 'pending'
      && !(codeTableReasonSets.pending as readonly unknown[]).includes(row.reason)) {
      throw new Error(`${where}：pending 的理由不在闭集里（${String(row.reason)}）`)
    }
    if (row.status === 'not-built'
      && !(codeTableReasonSets['not-built'] as readonly unknown[]).includes(row.reason)) {
      throw new Error(`${where}：not-built 的理由不在闭集里（${String(row.reason)}）`)
    }
    out[key] = value as CodeTableRow
  }
  return out
}


export const marketCalendarCodeTable: Readonly<Record<string, CodeTableRow>> = Object.freeze({
  ...validateCodeTableRows(rawCodeTable as unknown as Record<string, unknown>)
})
