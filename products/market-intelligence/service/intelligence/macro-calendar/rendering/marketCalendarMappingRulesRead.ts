import type { DatabaseSync } from 'node:sqlite'

import { localizedPairFor } from '../marketCalendarCodeNames'
import { marketCalendarCodeTable } from '../marketCalendarCodeTable'
import { zeroXRouterIndicatorIdentities, type ZeroXRouterPeriodRule } from '../marketCalendarMetricIdentity'
import { tierOfMetricKey } from '../marketCalendarMetricTiers'
import { zeroXRouterEventIdentities } from '../marketCalendarEventIdentities'
import { germanSourceMetricMappings } from '../marketCalendarGermanSourceMappings'
import { marketCalendarCountrySourceMappings } from '../marketCalendarCountrySourceMappings'
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

export type UnmappedReason = 'unknown-event-type' | 'no-standard-row' | 'period-unresolved'
  | 'no-code' | 'missing-country' | 'bad-identity' | 'no-values'

export type UnmappedSourceIdRow = Readonly<{
  sourceId: string
  rowCount: number
  /**
   * **首次出现时间**（该 id 在库里最早那一行的 `first_seen_at`，UTC）：读者要判断「这是不是新东西」，
   * 靠的就是这个时间；只写「有 1 行」看不出新旧。
   */
  firstSeenAt: string | null
  /** 出现过的来源（去重排序）：一个 id 可能被多个源写过，全列出来，不挑一个。 */
  providerIds: readonly string[]
  /**
   * **它为什么没进日历**（闭集里的一个值，现场判定）：界面要把这个原因翻成白话显示，
   * 读者才能判断「该建码、等源、还是它根本不是指标」。不写内部枚举给读者看。
   */
  reason: UnmappedReason

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
  /**
   * **诊断明细**：四类各自的行（只读、折叠显示，**不进主列表**）。用户 2026-11-18：
   * 主列表正常情况下是空的；但「没有对应的码」那 61 条任何时刻都该查得到是什么、什么时候出现的。
   *
   * 数据来自 `mi_calendar_unmapped`（唯一真源，一行一个 id），不再从观测表反推。
   */
  diagnosticRows: Readonly<Partial<Record<UnmappedReason, readonly UnmappedSourceIdRow[]>>>
  counts: Readonly<{
    mapped: number
    /** **只算真正在等映射的**（事件/无标准行/缺期次/无码都排除，见 `diagnostics`）。 */
    unmapped: number
    unmappedRows: number
    eventIdentities: number
    /** 只作诊断的四类计数：它们不进列表，但读者问「另外那些去哪了」时这里答得出来。 */
    diagnostics: Readonly<{
      'unknown-event-type': number; 'no-standard-row': number; 'period-unresolved': number; 'no-code': number
    }>
    /** 现场判定四类都命不中的 id 数（列表里的就是这些）。 */
    unclassified: number
  }>
}> | Readonly<{ state: 'unavailable'; reasonCode: 'query-unavailable' }>

/** 两个时刻取更早的那个；缺一个就用另一个，都缺是 `null`。 */
function earliest(left: string | null, right: string | null): string | null {
  if (left === null) return right
  if (right === null) return left
  return left < right ? left : right
}

/** `["214790",79090]` → `214790`（与事件读口同一个取法，只取第一段）。 */
function sourceIdOfSourceKey(sourceKey: string): string | undefined {
  const match = /^\["([^"]+)"/u.exec(sourceKey)
  return match?.[1]
}

type Aggregate = Readonly<{ sourceId: string; rows: number; sampleLabel: string | null
  sampleLabelEn: string | null; firstSeenAt: string | null; providerIds: string[] }>

/**
 * 指标码 → 发布机构页面。**只按「机构 + 页面类型」的模板填**，不做逐条手抄：
 * - 页面的归属由机构决定（BLS 的 CPI 永远在 bls.gov），所以这张表挂在码上；
 * - 推不出来的（ISM、S&P Global、密歇根、谘商会、MBA、Baker Hughes、各地区联储调查等）
 *   一律 `null`：它们的公开页要逐条核过才敢写（#34 的白名单），猜一个比空着坏。
 */
/**
 * **官网只从码表拿**（用户 2026-11-17）。这里原来是一条 17 个 `startsWith` 的 if 链——那是第二份真源，
 * 会和码表分叉；现在只查码表：有机构页就返回，`pending` 就返回 null（界面显示「待核」）。
 */
export function officialPageFor(metricKey: string): Readonly<{ url: string; basis: string }> | null {
  const row = marketCalendarCodeTable[metricKey]
  if (row === undefined) return null
  const source = row.officialSource
  return 'pending' in source ? null : { url: source.url, basis: source.basis }
}

export function mappingRuleNames(metricKey: string): Readonly<{ zh: string; en: string }> | null {
  const pair = localizedPairFor(metricKey)
  return pair === undefined ? null : Object.freeze({ ...pair })
}

export function readCalendarMappingRules(database: DatabaseSync): MappingRulesRead {
  try {
    // 源内身份＝数组第一段（`["214790",79090]` → `214790`）；规范码不是这里的对象。
    const rows = database.prepare(`select metric_key, count(*) as n, min(source_label) as label,
        min(source_label_en) as label_en, min(source_provider_id) as provider,
        min(first_seen_at) as first_seen_at
      from mi_calendar_events where metric_key glob '*[[]*' group by metric_key`)
      .all() as unknown as { metric_key: string; n: number; label: string | null; label_en: string | null
        provider: string | null; first_seen_at: string | null }[]
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
      const firstSeen = row.first_seen_at === null ? undefined : String(row.first_seen_at)
      byId.set(id, {
        sourceId: id, rows: (current?.rows ?? 0) + Number(row.n),
        sampleLabel: current?.sampleLabel ?? row.label,
        sampleLabelEn: current?.sampleLabelEn ?? row.label_en,
        firstSeenAt: earliest(firstSeen ?? null, current?.firstSeenAt ?? null),
        providerIds: [...new Set([...(current?.providerIds ?? []), String(row.provider)])].sort()
      })
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
      // 按国家建码的第二批映射（1106 条）：映射是机械的，判断在族名表里做完了。
      ...Object.entries(marketCalendarCountrySourceMappings),
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
    /**
     * **未映射页签只放「真正在等映射的」**（用户 2026-11-18：477 条压不下去）。
     *
     * 477 里绝大多数不是「该映射却没映射」：讲话/会议是事件、缺统计期的映射早就写了、无标准行的
     * 连一行都没有。它们各有去处，**只作计数**，不进列表——否则读者照着补映射，补的是已经做完的事。
     */
    const DIAGNOSTIC_ONLY = new Set(['unknown-event-type', 'no-standard-row', 'period-unresolved',
      'bad-period', 'no-code'])
    const reasonById = new Map<string, string>()
    const reasonRows = database.prepare(`select provider_id, source_key, reason, first_seen_at
      from mi_calendar_unmapped`).all() as unknown as
      { provider_id: string; source_key: string; reason: string; first_seen_at: string | null }[]
    for (const row of reasonRows) {
      const id = sourceIdOfSourceKey(row.source_key)
      if (id !== undefined && !reasonById.has(id)) reasonById.set(id, row.reason)
    }
    const diagnostics = { 'unknown-event-type': 0, 'no-standard-row': 0, 'period-unresolved': 0, 'no-code': 0 }
    /**
     * **现场判定分类，不依赖「有没有一行原因记录」**（用户 2026-11-18）。
     *
     * 上一版只排除「未映射表里写着原因」的 id，于是 80 条「从来没被诊断过」的会永远挂在列表里——
     * 那 80 条不是「在等映射」，是没人给它们分过类。现在按回填同一条规则现场判：
     * ① 观测里 `eventKind` 是事件 → 事件档；② 没有对应码 → 无码档；③ 有码没期次 → 缺期次档；
     * ④ 有码有期次、标准表没有行 → 无标准行档。**四类都命不中**的才留在列表里，并单列「未分类」计数——
     * 不静默隐藏，也不默认列出来。
     */
    const eventKindById = new Map<string, string>()
    // 观测表可能还没建（例如只读夹具只建标准表）：缺表时按「没有观测」处理，不把整张表判成读不到。
    const hasObservations = database.prepare(
      `select 1 from sqlite_master where type = 'table' and name = 'mi_macro_calendar_market_event_observations'`
    ).get() !== undefined
    const observationRows = hasObservations
      ? database.prepare(`select source_event_id, event_kind
        from mi_macro_calendar_market_event_observations`).all() as unknown as
        { source_event_id: string; event_kind: string | null }[]
      : []
    for (const row of observationRows) {
      const id = sourceIdOfSourceKey(row.source_event_id)
      if (id === undefined || row.event_kind === null || eventKindById.has(id)) continue
      eventKindById.set(id, row.event_kind)
    }
    const isEventKind = (kind: string | undefined): boolean =>
      kind === 'central-bank-activity' || kind === 'financial-event' || kind === 'event'
    const rowCountById = new Map<string, number>()
    for (const entry of byId.values()) rowCountById.set(entry.sourceId, entry.rows)
    let unclassified = 0
    const reasonFor = new Map<string, UnmappedReason>()
    const unmapped: UnmappedSourceIdRow[] = [...byId.values()]
      .filter((entry) => !recognized.has(entry.sourceId))
      .filter((entry) => {
        // 先看未映射表里已经记下的原因（回填的结论），再现场判。
        // **判定顺序按 Chief 定的来**：先看是不是事件，再看有没有码——记录下来的原因放在后面，
        // 免得「回填时判成 no-code、其实观测里写着它是事件」这种分岔留在数据里没人发现。
        const recorded = reasonById.get(entry.sourceId)
        const bucket = isEventKind(eventKindById.get(entry.sourceId)) ? 'unknown-event-type'
          : recorded === 'bad-period' ? 'period-unresolved'
            : recorded !== undefined && recorded in diagnostics ? recorded
              // 没有映射表认得它 = 没有码。有码的那批根本不会进这个列表（recognized 先过滤掉了）。
              : 'no-code'
        // **列表只留「四类都判不出来」的**（用户 2026-11-18 的验收标准：页签空着才正常）。
        // 四类各有去处，只进计数；它们的逐行入口在诊断计数里，不在这个列表。
        if (bucket in diagnostics) { diagnostics[bucket as keyof typeof diagnostics] += 1; return false }
        unclassified += 1
        reasonFor.set(entry.sourceId, bucket as UnmappedReason)
        return true
      })
      .map((entry) => Object.freeze({ sourceId: entry.sourceId, rowCount: entry.rows,
        firstSeenAt: entry.firstSeenAt, providerIds: Object.freeze(entry.providerIds),
        reason: reasonFor.get(entry.sourceId) ?? 'no-code',
        sampleLabel: entry.sampleLabel, sampleLabelEn: entry.sampleLabelEn }))
      .sort((left, right) => right.rowCount - left.rowCount || left.sourceId.localeCompare(right.sourceId))
    /**
     * 诊断明细：只读 `mi_calendar_unmapped`（唯一真源），一行一个 id。
     * 标题从事件行取（同一 id 可能有多行，取第一份有名字的）；取不到就空着，不编。
     */
    const diagnosticRows: Partial<Record<UnmappedReason, UnmappedSourceIdRow[]>> = {}
    for (const row of reasonRows) {
      const id = sourceIdOfSourceKey(row.source_key)
      if (id === undefined) continue
      const reason = row.reason as UnmappedReason
      const aggregate = byId.get(id)
      const entry = Object.freeze({
        sourceId: id, rowCount: aggregate?.rows ?? 0,
        firstSeenAt: row.first_seen_at ?? null, providerIds: Object.freeze([row.provider_id]),
        reason, sampleLabel: aggregate?.sampleLabel ?? null, sampleLabelEn: aggregate?.sampleLabelEn ?? null
      })
      diagnosticRows[reason] = [...(diagnosticRows[reason] ?? []), entry]
    }
    for (const reason of Object.keys(diagnosticRows) as UnmappedReason[]) {
      diagnosticRows[reason] = [...diagnosticRows[reason]!].sort((left, right) =>
        (left.firstSeenAt ?? '').localeCompare(right.firstSeenAt ?? '') || left.sourceId.localeCompare(right.sourceId))
    }
    return Object.freeze({
      state: 'available' as const,
      mapped: Object.freeze(mapped),
      unmapped: Object.freeze(unmapped),
      diagnosticRows: Object.freeze(diagnosticRows),
      counts: Object.freeze({ mapped: mapped.length, unmapped: unmapped.length,
        unmappedRows: unmapped.reduce((sum, entry) => sum + entry.rowCount, 0),
        eventIdentities: Object.keys(zeroXRouterEventIdentities).length,
        /** 只作诊断：这四类各有去处，不进列表（加起来才是读者原先看到的 477）。 */
        diagnostics: Object.freeze(diagnostics),
        /** 四类都命不中、也查不到原因记录的 id 数：不静默隐藏，也不默认列出来。 */
        unclassified })
    })
  } catch {
    return { state: 'unavailable', reasonCode: 'query-unavailable' }
  }
}
