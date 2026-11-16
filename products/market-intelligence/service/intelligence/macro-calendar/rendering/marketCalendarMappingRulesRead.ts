import type { DatabaseSync } from 'node:sqlite'

import { localizedPairFor } from '../marketCalendarCodeNames'
import { zeroXRouterIndicatorIdentities, type ZeroXRouterPeriodRule } from '../marketCalendarMetricIdentity'
import { tierOfMetricKey } from '../marketCalendarMetricTiers'
import { zeroXRouterEventIdentities } from '../marketCalendarEventIdentities'
import { germanSourceMetricMappings } from '../marketCalendarGermanSourceMappings'
import { subItemOrderOf, subItemParentByMetricKey, zeroXRouterSourceMetricMappings } from '../marketCalendarZeroXRouterSourceMappings'
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
  /**
   * 这个指标码认得的**源内 id**（用户 2026-11-17 合并页签后）：一个码一行，这里列出所有认得它的
   * 数字 id（`213623 · 214135`）。**空数组 = 这个码本来就是码身份进来的**，没有经过任何映射规则
   * ——界面那两格空着，不是「没读到」。
   */
  sourceIds: readonly string[]
  metricKey: string
  /** 期次规则；直接以码进来、没有任何规则时是 `null`。 */
  periodRule: ZeroXRouterPeriodRule | null
  basis: string | null
  /**
   * **官方查看地址**（用户 2026-11-16）：属于**指标码**而不是源内 id——同一个指标不管从哪个源
   * 进来都指向同一个发布机构页面。只填能按「发布机构 + 页面类型」确定推出来的；推不出来的
   * `null`（`null` 界面上留空，不写「无公开页」——那要逐条核过才敢写）。
   */
  officialUrl: string | null
  /**
   * **中英名**（用户 2026-11-17）：「指标码」那一列旁边显示一行名字，`zh · en` 三段用 `·` 分隔
   * 是界面的事。`zh` 取中文简称、`en` 取英文全名——**查不到名表条目就是 `null`**，
   * 不拿指标码拼一个假英文名（拼出来的东西读起来像我们给的名字，其实是码）。
   */
  names: Readonly<{ zh: string; en: string }> | null
  /**
   * **分级**（用户 2026-11-17）：`1 | 2 | 3 | null`（`null` = 未分级）。读现有分级表，
   * **不在这里另算**——分级是指标的属性，两处各算一份迟早会给出两个答案。
   */
  tier: 1 | 2 | 3 | null
  /**
   * **这条例则映射到的指标，在库里有多少行**（按 `metricKey` 数，**不是按源内 id**）。
   *
   * 早前一版按源内 id 数，结果 85 条全是 0——规则表记的是 `4013` 这类旧源 id，而库里现在跑的
   * 是另一批 360 个 id，两批一个都不重合。那个数没有意义：它回答的是「这条 id 现在有没有数据」，
   * 读者要问的是「这条规则管的指标库里有多少行」。
   *
   * `0` 仍然是 0：说明这个指标现在库里没有行，看得见才不会把「规则只是写在纸上」当成在起作用。
   */
  rowCount: number
  /**
   * **上级指标**（用户 2026-11-17）：子项码给出母码，母码与普通指标为 `null`。
   * 由显式表给出，**不让渲染层截字符串反推**——五段/四段的差别是命名规则的内部细节。
   */
  parentMetricKey?: string | null
  /** `parent` = 母指标（或普通指标），`child` = 子项。界面据此显示「· 子项」小字。 */
  kind?: 'parent' | 'child'
  /** 子项在词表里的序号（同族排序用）；母码/普通指标没有这个数。 */
  childOrder?: number
}>

export type UnmappedSourceIdRow = Readonly<{
  sourceId: string
  rowCount: number
  /** 样本中文名（源原文）。 */
  sampleLabel: string | null
  /**
   * 样本英文原文名（迁移 18 合并后存在 `source_label_en`）：没有就是 `null`。
   * 界面把两段放同一格 `中文 · English`，**没有英文就只显示中文**，不留半句。
   */
  sampleLabelEn: string | null
}>

export type MappingRulesRead = Readonly<{
  state: 'available'
  mapped: readonly MappingRuleRow[]
  unmapped: readonly UnmappedSourceIdRow[]
  /** 三个数由服务端给（前端不自己数，否则筛选后标题计数会对不上实际行数）。 */
  /**
   * 三个数由服务端给（前端不自己数）。
   *
   * `mapped` 是**按指标码去重后**的条数：同一个码如果既有源内 id、又直接以码进来，只算一行
   * （用户 2026-11-17：两个页签并成一个）。所以它**不等于**规则条数之和。
   */
  /**
   * `mapped` 是**指标码数**（不含 `evt.*`），`eventIdentities` 是**事件身份数**——两个体系分开数：
   * 一场讲话不是指标，不进 `mapped`；但它确实被认出来了，界面上要用这个数解释「为什么未映射少了、
   * 已映射没涨」。事件一条都不进本表的行。
   */
  counts: Readonly<{ mapped: number; unmapped: number; unmappedRows: number; eventIdentities: number }>
}> | Readonly<{ state: 'unavailable'; reasonCode: 'query-unavailable' }>

type Aggregate = Readonly<{ sourceId: string; rows: number; sampleLabel: string | null; sampleLabelEn: string | null }>

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

/**
 * 指标码 → 中英名（只读名表，不拼码）：`zh` 用简称、`en` 用全名。
 * 名表没有这条就 `null`——**宁可不显示，也不写一个读起来像专名的码**。
 */
export function mappingRuleNames(metricKey: string): Readonly<{ zh: string; en: string }> | null {
  const pair = localizedPairFor(metricKey)
  return pair === undefined ? null : Object.freeze({ ...pair })
}

export function readCalendarMappingRules(database: DatabaseSync): MappingRulesRead {
  try {
    // 源内身份＝数组第一段（`["214790",79090]` → `214790`）；规范码不是这里的对象。
    const rows = database.prepare(`select metric_key, count(*) as n, min(source_label) as label,
        min(source_label_en) as label_en
      from mi_calendar_events where metric_key glob '*[[]*' group by metric_key`)
      .all() as unknown as { metric_key: string; n: number; label: string | null; label_en: string | null }[]
    // 按**指标码**数行（不是按源内 id）：这是读者问的那个问题，见 `rowCount` 的说明。
    const rowsByMetricKey = new Map<string, number>()
    for (const row of database.prepare(`select metric_key, count(*) as n from mi_calendar_events
        where row_kind = 'release' group by metric_key`).all() as unknown as { metric_key: string; n: number }[]) {
      rowsByMetricKey.set(row.metric_key, Number(row.n))
    }
    const byId = new Map<string, Aggregate>()
    for (const row of rows) {
      const id = sourceInternalIdOf(row.metric_key).replace(/^id:/, '')
      const current = byId.get(id)
      byId.set(id, { sourceId: id, rows: (current?.rows ?? 0) + Number(row.n),
        sampleLabel: current?.sampleLabel ?? row.label,
        sampleLabelEn: current?.sampleLabelEn ?? row.label_en })
    }
    /**
     * 「现在认得哪些 id」= 三张表合起来：旧表 85 条 + 0xrouter 自己的 32 条（子项码那批）
     * + 德国自己那张 71 条（用户 2026-11-17 建码后）。**按来源各一张表**，这里只做并集。
     *
     * 少了德国这张，表会把 71 个已经认得的 id 报成「未映射」——那是最坏的一种错：
     * 读者照着它去补映射，补的其实是已经做完的事。
     */
    const allIdentityEntries: [string, { metricKey: string; periodRule: ZeroXRouterPeriodRule }][] = [
      ...Object.entries(zeroXRouterIndicatorIdentities),
      ...Object.entries(zeroXRouterSourceMetricMappings),
      ...Object.entries(germanSourceMetricMappings),
      // 事件型（`evt.*`）：它们不是指标，但同样「已经认出身份」，所以不再算未映射
      ...Object.entries(zeroXRouterEventIdentities)
    ]
    /**
     * **一行 = 一个指标码**（用户 2026-11-17：两个页签并成一个）。
     *
     * 合并前是「一行 = 一条规则」，于是同一个码会出多行（德国 PMI 有 3 个 id），而直接以码进来的
     * 指标又是另一段——读者得在两个页签之间自己对齐。现在按码收口：
     * - 认得它的源内 id 全列进 `sourceIds`（多个用 `·` 连）；**空数组 = 它本来就是码身份**；
     * - `periodRule` 取这张码上所有规则里第一个（同一码的几条规则期次一致；不一致时以第一条为准，
     *   不在这里编一个「混合」值）。
     */
    const idsByCode = new Map<string, string[]>()
    const ruleByCode = new Map<string, ZeroXRouterPeriodRule>()
    for (const [sourceId, entry] of allIdentityEntries) {
      idsByCode.set(entry.metricKey, [...(idsByCode.get(entry.metricKey) ?? []), sourceId])
      if (!ruleByCode.has(entry.metricKey)) ruleByCode.set(entry.metricKey, entry.periodRule)
    }
    /**
     * **这不是指标的行不进这张表**（Chief 2026-11-17：讲话、会议是事件，不是指标）：
     * - `evt.*` 事件码（央行讲话那类）：它们用事件身份，不该出现在「id → 指标码」这张表里；
     * - `[` 开头的数组身份是**未映射**的原始键，不是码。
     *
     * 判据在**合并之前**就滤掉，而不是合并后再删——否则一个 evt 身份一旦被登记进映射表，
     * 它会先从「未映射」消失（对），再悄悄出现在「已映射」里（错），而那张表的每一行读者都会
     * 当成一个「指标」。
     */
    const isMetricCode = (metricKey: string): boolean =>
      !metricKey.startsWith('[') && !metricKey.startsWith('evt.')
    const directCodes = [...rowsByMetricKey.keys()].filter(isMetricCode)
    const allCodes = new Set<string>([
      ...[...idsByCode.keys()].filter(isMetricCode),
      ...directCodes
    ])
    const mapped: MappingRuleRow[] = [...allCodes].map((metricKey) => {
      const official = officialPageFor(metricKey)
      return Object.freeze({
        metricKey,
        sourceIds: Object.freeze((idsByCode.get(metricKey) ?? []).slice().sort()),
        periodRule: ruleByCode.get(metricKey) ?? null,
        basis: official === null ? null : official.basis, officialUrl: official?.url ?? null,
        names: mappingRuleNames(metricKey),
        tier: tierOfMetricKey(metricKey) ?? null,
        rowCount: rowsByMetricKey.get(metricKey) ?? 0,
        parentMetricKey: subItemParentByMetricKey[metricKey] ?? null,
        kind: subItemParentByMetricKey[metricKey] === undefined ? 'parent' as const : 'child' as const,
        ...(subItemOrderOf(metricKey) === undefined ? {} : { childOrder: subItemOrderOf(metricKey) })
      })
    }).sort((left, right) => left.metricKey.localeCompare(right.metricKey))
    const recognized = new Set(allIdentityEntries.map(([sourceId]) => sourceId))
    const unmapped: UnmappedSourceIdRow[] = [...byId.values()]
      .filter((entry) => !recognized.has(entry.sourceId))
      .map((entry) => Object.freeze({ sourceId: entry.sourceId, rowCount: entry.rows,
        sampleLabel: entry.sampleLabel, sampleLabelEn: entry.sampleLabelEn }))
      .sort((left, right) => right.rowCount - left.rowCount || left.sourceId.localeCompare(right.sourceId))
    return Object.freeze({
      state: 'available' as const,
      mapped: Object.freeze(mapped),
      unmapped: Object.freeze(unmapped),
      counts: Object.freeze({ mapped: mapped.length, unmapped: unmapped.length,
        unmappedRows: unmapped.reduce((sum, entry) => sum + entry.rowCount, 0),
        eventIdentities: Object.keys(zeroXRouterEventIdentities).length })
    })
  } catch {
    return { state: 'unavailable', reasonCode: 'query-unavailable' }
  }
}
