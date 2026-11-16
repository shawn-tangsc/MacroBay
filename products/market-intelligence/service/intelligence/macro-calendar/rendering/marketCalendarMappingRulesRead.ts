import type { DatabaseSync } from 'node:sqlite'

import { calendarNamesFor } from '../marketCalendarCodeNames'
import { zeroXRouterIndicatorIdentities, type ZeroXRouterPeriodRule } from '../marketCalendarMetricIdentity'
import { sourceInternalIdOf } from './marketCalendarEventIndexRead'

/**
 * **仅渲染层，只读**：映射规则表（用户 2026-11-16 要看的那张表）。
 *
 * 两段：
 * 1. **现有规则**：`源内指标 id → 指标码 → 期次规则`，来源就是代码里那张
 *    `zeroXRouterIndicatorIdentities`（85 条）——这里只是把它连同中英名一起读出来；
 * 2. **库里出现但没映射的 id**：按行数从多到少，带样本源名字，方便决定先补哪几条。
 *
 * 三条边界：
 * - **只读**：不改库、不改代码里的表；「在界面里补条目」要先把规则挪进库，那是另一件事；
 * - **不猜映射**：`mapped` 只按「id 在规则表里」判，名字像不算；
 * - 名字只用于显示（码名表 → 源内名表 → 无），不参与任何判定。
 */
/**
 * 字段名与严格形状由 Chief 2026-11-16 定死，**一个字都不许改**（前端按它接）。
 * `basis` 现在一律 `null`：现有 85 条在代码里没有「依据」这一栏，不许编；补条目时才要求写。
 */
export type MappingRuleRow = Readonly<{
  sourceId: string
  metricKey: string
  periodRule: ZeroXRouterPeriodRule
  basis: string | null
  /**
   * **官方查看地址**（用户 2026-11-16）：属于**指标码**而不是源内 id——同一个指标不管从哪个源
   * 进来都指向同一个发布机构页面。只填能按「发布机构 + 页面类型」确定推出来的；推不出来的
   * `null`（`null` 界面上留空，不写「无公开页」——那要逐条核过才敢写）。
   */
  officialUrl: string | null
}>

export type UnmappedSourceIdRow = Readonly<{
  sourceId: string
  rowCount: number
  sampleLabel: string | null
}>

export type MappingRulesRead = Readonly<{
  state: 'available'
  mapped: readonly MappingRuleRow[]
  unmapped: readonly UnmappedSourceIdRow[]
  /** 三个数由服务端给（前端不自己数，否则筛选后标题计数会对不上实际行数）。 */
  counts: Readonly<{ mapped: number; unmapped: number; unmappedRows: number }>
}> | Readonly<{ state: 'unavailable'; reasonCode: 'query-unavailable' }>

type Aggregate = Readonly<{ sourceId: string; rows: number; sampleLabel: string | null }>

/**
 * 指标码 → 发布机构页面。**只按「机构 + 页面类型」的模板填**，不做逐条手抄：
 * - 页面的归属由机构决定（BLS 的 CPI 永远在 bls.gov），所以这张表挂在码上；
 * - 推不出来的（ISM、S&P Global、密歇根、谘商会、MBA、Baker Hughes、各地区联储调查等）
 *   一律 `null`：它们的公开页要逐条核过才敢写（#34 的白名单），猜一个比空着坏。
 */
function officialPageFor(metricKey: string): Readonly<{ url: string; basis: string }> | null {
  const key = metricKey
  if (key.startsWith('US.CPI.') || key.startsWith('US.CORE_CPI.') || key.startsWith('US.PPI.')
    || key.startsWith('US.CORE_PPI.') || key.startsWith('US.EXPORT_PRICES')) {
    return { url: 'https://www.bls.gov/news.release/', basis: 'BLS · 发布页（news.release 目录）' }
  }
  if (key.startsWith('US.NONFARM.') || key.startsWith('US.UNEMPLOYMENT') || key.startsWith('US.AHE.')
    || key.startsWith('US.REAL_AHE.') || key.startsWith('US.PARTICIPATION_RATE') || key.startsWith('US.AVERAGE_WEEKLY_HOURS')
    || key.startsWith('US.PRIVATE_PAYROLLS') || key.startsWith('US.JOLTS')) {
    return { url: 'https://www.bls.gov/news.release/', basis: 'BLS · 发布页（news.release 目录）' }
  }
  if (key.startsWith('US.JOBLESS_CLAIMS')) return { url: 'https://www.dol.gov/ui/data.pdf', basis: 'DOL · 周度申领报告' }
  if (key.startsWith('US.GDP') || key.startsWith('US.PCE.') || key.startsWith('US.CORE_PCE.')
    || key.startsWith('US.PERSONAL_') || key.startsWith('US.CORPORATE_PROFITS') || key.startsWith('US.TRADE_BALANCE')
    || key.startsWith('US.EXPORTS') || key.startsWith('US.IMPORTS')) {
    return { url: 'https://www.bea.gov/news', basis: 'BEA · 发布页（news 目录）' }
  }
  if (key.startsWith('US.FOMC')) return { url: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm', basis: 'Fed · FOMC 日历页' }
  if (key.startsWith('US.EIA_')) return { url: 'https://www.eia.gov/petroleum/supply/weekly/', basis: 'EIA · 周度石油状况报告' }
  if (key.startsWith('US.FEDERAL_BUDGET')) return { url: 'https://fiscaldata.treasury.gov/datasets/monthly-treasury-statement/', basis: '财政部 · 月度报表' }
  if (key.startsWith('US.RETAIL_SALES') || key.startsWith('US.DURABLE_GOODS') || key.startsWith('US.FACTORY_ORDERS')
    || key.startsWith('US.BUILDING_PERMITS') || key.startsWith('US.HOUSING_STARTS') || key.startsWith('US.NEW_HOME_SALES')
    || key.startsWith('US.BUSINESS_INVENTORIES') || key.startsWith('US.WHOLESALE_') || key.startsWith('US.CONSTRUCTION_SPENDING')
    || key.startsWith('US.CORE_CAPEX_ORDERS')) {
    return { url: 'https://www.census.gov/economic-indicators/', basis: '普查局 · 经济指标页' }
  }
  // 商业/会员机构与地区联储调查：公开页要逐条核（#34 白名单），现在一律 null。
  return null
}

export function readCalendarMappingRules(database: DatabaseSync): MappingRulesRead {
  try {
    // 源内身份＝数组第一段（`["214790",79090]` → `214790`）；规范码不是这里的对象。
    const rows = database.prepare(`select metric_key, count(*) as n, min(source_label) as label
      from mi_calendar_events where metric_key glob '*[[]*' group by metric_key`)
      .all() as unknown as { metric_key: string; n: number; label: string | null }[]
    const byId = new Map<string, Aggregate>()
    for (const row of rows) {
      const id = sourceInternalIdOf(row.metric_key).replace(/^id:/, '')
      const current = byId.get(id)
      byId.set(id, { sourceId: id, rows: (current?.rows ?? 0) + Number(row.n),
        sampleLabel: current?.sampleLabel ?? row.label })
    }
    const mapped: MappingRuleRow[] = Object.entries(zeroXRouterIndicatorIdentities).map(([sourceId, entry]) => {
      const official = officialPageFor(entry.metricKey)
      return Object.freeze({ sourceId, metricKey: entry.metricKey, periodRule: entry.periodRule,
        basis: official === null ? null : official.basis, officialUrl: official?.url ?? null })
    })
      .sort((left, right) => left.sourceId.localeCompare(right.sourceId))
    const unmapped: UnmappedSourceIdRow[] = [...byId.values()]
      .filter((entry) => zeroXRouterIndicatorIdentities[entry.sourceId] === undefined)
      .map((entry) => Object.freeze({ sourceId: entry.sourceId, rowCount: entry.rows, sampleLabel: entry.sampleLabel }))
      .sort((left, right) => right.rowCount - left.rowCount || left.sourceId.localeCompare(right.sourceId))
    return Object.freeze({
      state: 'available' as const,
      mapped: Object.freeze(mapped),
      unmapped: Object.freeze(unmapped),
      counts: Object.freeze({ mapped: mapped.length, unmapped: unmapped.length,
        unmappedRows: unmapped.reduce((sum, entry) => sum + entry.rowCount, 0) })
    })
  } catch {
    return { state: 'unavailable', reasonCode: 'query-unavailable' }
  }
}
