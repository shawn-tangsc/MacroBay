import {
  coreIndicatorOfficialLegExceptions,
  valueSourcesForMetric,
  type CoreIndicatorValueSource
} from './coreIndicatorValueSources'
import { macroCalendarReleaseValueMappings } from './macroCalendarReleaseValueMappingPolicy'
import { MACRO_INDICATOR_GROUPS, MACRO_INDICATOR_RETIRED_METRIC_KEYS } from './macroIndicatorCardGroups'
import { nameByMetricKey } from './marketCalendarCodeNames'
import { narwhalMeasureMetricKeys, zeroXRouterIndicatorIdentities } from './marketCalendarMetricIdentity'
import {
  marketCalendarReleaseGroupByMetricKey,
  marketCalendarReleaseGroupPrimary,
  marketCalendarTierByMetricKey
} from './marketCalendarReleaseGroups'
import { polymarketConsensusPolicy } from './polymarketConsensus'
import {
  POLICY_PATH_EVENT_METRIC_PRIORITY,
  POLICY_PATH_EVENT_RELEVANT_METRIC_KEYS
} from '../../../contracts/policyPath'

/**
 * 指标身份的**只读合成索引**（架构师 2026-11-14 规格 `29-指标映射单表规格.md`）。
 *
 * 为什么要有它：一个指标的身份散在八张表里，换一次口径（PCE 未季调 → 季调）要人工同步五处，
 * 漏一处就出现「有值却读不到」或「卡上写盘未开」。问题不是「没有唯一出处」，而是**没有一处能看全**——
 * 换码时人只能挨个 grep，那次对上了是运气。
 *
 * 三条硬规矩（照规格 §2）：
 * 1. **只合成、不定义**：下面每一个字段都由一张既有表算出来，本文件**不许出现任何指标码字面量**
 *    （守卫 B 会读源码断言这一点）；
 * 2. **消费者改读它，源头表继续存在**——源头表是事实，这里是视图，不许把源头表搬进来；
 * 3. **不合并语义不同的东西**：`card.labelKey`（卡面行名）与 `name.zhShort`（指标名）并排摆，不互相推导。
 *
 * 留在原处不许动的：盘口 slug 模板字符串本身（外部约定）、`measure → metricKey` 映射（源侧字典）、
 * 名称四列（人工维护的可见文案）。这里只引用。
 */
export type MetricCatalogEntry = Readonly<{
  metricKey: string
  /** 名称（`marketCalendarCodeNames`）；没登记名称的码没有这一项。
      类型直接引用那张表，**不在这里再写一遍四列**——写了就长得像第二张名表。 */
  name?: (typeof nameByMetricKey)[keyof typeof nameByMetricKey]
  /** 指标族 / 主测度 / 分级（`marketCalendarReleaseGroups`）。 */
  group?: Readonly<{ group: string; isPrimary: boolean; tier: 1 | 2 | 3 | undefined }>
  /** 卡片分组与行序（`macroIndicatorCardGroups`）。 */
  card?: Readonly<{ groupId: string; labelKey: string; kind: string }>
  /** 取值腿（`coreIndicatorValueSources` 派生：数据商 / FRED / BLS）。 */
  sources: readonly CoreIndicatorValueSource[]
  /** 官方发布映射（`macroCalendarReleaseValueMappingPolicy`）：这条发布把值写成哪个身份。 */
  officialRelease?: Readonly<{ event: string; unit: string; adjustment: string }>
  /** 官方腿的例外（没有官方序列，或有但口径不符）：带原因与怎么解。 */
  officialLegException?: Readonly<{ kind: string; reason: string; resolution: string }>
  /** 源内身份：Narwhal 的 measure、旧源的 indicator id。 */
  sourceKeys: Readonly<{ narwhalMeasures: readonly string[]; zeroXRouterIndicatorIds: readonly string[] }>
  /** 盘口 slug 模板（外部约定，只引用不复制）。 */
  marketSlugTemplate?: string
  /** 盘口档位 → 卡片口径的换算（非农档是绝对人数，卡片是千）：M4 要它，别在消费处再写一遍。 */
  marketValueDivisor?: number
  /** 政策路径两份清单里在不在（事件标注 / 同窗优先级）。 */
  policyPath: Readonly<{ annotated: boolean; sameWindowPriority: boolean }>
  /**
   * 这个码被哪几张源头表提到（表名）。**反向孤儿守卫读它**：
   * 一个码在 catalog 里存在、却一张表都没提到 → 说明有人在别处手写了一个没登记的新码。
   */
  mentionedBy: readonly string[]
  /** 这个码已退役时，当前的码是哪个（退役表转出）；当前码没有这一项。 */
  retiredTo?: string
}>

function cardRowFor(metricKey: string): MetricCatalogEntry['card'] {
  for (const group of MACRO_INDICATOR_GROUPS) {
    const row = group.rows.find((candidate) => candidate.metricKey === metricKey)
    if (row === undefined) continue
    return Object.freeze({ groupId: group.id, labelKey: row.labelKey, kind: row.kind })
  }
  return undefined
}

function groupFactsFor(metricKey: string): MetricCatalogEntry['group'] {
  const group = marketCalendarReleaseGroupByMetricKey[metricKey]
  if (group === undefined) return undefined
  return Object.freeze({
    group,
    /* 主测度是**每个组**一条：同一组里只有那一条算主测度。同一概念的两个变体（季调/未季调）
       因此不会都算主测度——这也是「同一发布只出一条」的排序依据。 */
    isPrimary: marketCalendarReleaseGroupPrimary[group] === metricKey,
    tier: marketCalendarTierByMetricKey[metricKey]
  })
}

function officialReleaseFor(metricKey: string): MetricCatalogEntry['officialRelease'] {
  const mapping = macroCalendarReleaseValueMappings.find((row) => row.metricKey === metricKey)
  if (mapping === undefined) return undefined
  return Object.freeze({ event: mapping.event, unit: mapping.unit, adjustment: mapping.adjustment })
}

function officialLegExceptionFor(metricKey: string): MetricCatalogEntry['officialLegException'] {
  const exception = coreIndicatorOfficialLegExceptions.find((row) => row.metricKey === metricKey)
  if (exception === undefined) return undefined
  return Object.freeze({ kind: exception.kind, reason: exception.reason, resolution: exception.resolution })
}

function narwhalMeasuresFor(metricKey: string): readonly string[] {
  return Object.freeze(Object.entries(narwhalMeasureMetricKeys)
    .filter(([, key]) => key === metricKey)
    .map(([measure]) => measure))
}

function zeroXRouterIdsFor(metricKey: string): readonly string[] {
  return Object.freeze(Object.entries(zeroXRouterIndicatorIdentities)
    .filter(([, entry]) => entry.metricKey === metricKey)
    .map(([id]) => id))
}

/** 所有可能在 catalog 里出现的码：八张表里提到过的并集（没有一处手工列码）。 */
/** 同一概念的标识：去掉口径段（季调/未季调是同一个概念的变体，影响程度也一样）。 */
export function metricConceptOf(metricKey: string): string {
  return metricKey.split('.').filter((segment) => segment !== 'SA' && segment !== 'NSA').join('.')
}

function allMetricKeys(): readonly string[] {
  const keys = new Set<string>()
  for (const group of MACRO_INDICATOR_GROUPS) for (const row of group.rows) keys.add(row.metricKey)
  for (const key of Object.keys(marketCalendarReleaseGroupByMetricKey)) keys.add(key)
  for (const key of Object.keys(marketCalendarTierByMetricKey)) keys.add(key)
  for (const key of Object.keys(nameByMetricKey)) keys.add(key)
  for (const key of Object.values(narwhalMeasureMetricKeys)) keys.add(key)
  for (const entry of Object.values(zeroXRouterIndicatorIdentities)) keys.add(entry.metricKey)
  for (const mapping of macroCalendarReleaseValueMappings) keys.add(mapping.metricKey)
  for (const key of Object.keys(polymarketConsensusPolicy.slugTemplateByMetricKey as Readonly<Record<string, string>>)) keys.add(key)
  for (const key of POLICY_PATH_EVENT_RELEVANT_METRIC_KEYS) keys.add(key)
  for (const key of POLICY_PATH_EVENT_METRIC_PRIORITY) keys.add(key)
  /* 退役码也必须是 catalog 里的键：它们有名称、有历史行，消费方还要按概念把它们取出来。 */
  for (const retired of MACRO_INDICATOR_RETIRED_METRIC_KEYS) keys.add(retired.retiredMetricKey)
  return Object.freeze([...keys].sort())
}

function mentionedBy(metricKey: string): readonly string[] {
  const tables: string[] = []
  if (cardRowFor(metricKey) !== undefined) tables.push('macroIndicatorCardGroups')
  if (groupFactsFor(metricKey) !== undefined) tables.push('marketCalendarReleaseGroups')
  if (nameByMetricKey[metricKey] !== undefined) tables.push('marketCalendarCodeNames')
  if (officialReleaseFor(metricKey) !== undefined) tables.push('macroCalendarReleaseValueMappingPolicy')
  if (narwhalMeasuresFor(metricKey).length > 0 || zeroXRouterIdsFor(metricKey).length > 0) {
    tables.push('marketCalendarMetricIdentity')
  }
  if ((polymarketConsensusPolicy.slugTemplateByMetricKey as Readonly<Record<string, string>>)[metricKey] !== undefined) {
    tables.push('polymarketConsensus')
  }
  if ((POLICY_PATH_EVENT_RELEVANT_METRIC_KEYS as readonly string[]).includes(metricKey)
    || (POLICY_PATH_EVENT_METRIC_PRIORITY as readonly string[]).includes(metricKey)) {
    tables.push('policyPath')
  }
  return Object.freeze(tables)
}

/** 索引本体：键是指标码，值全部由既有表算出来（本文件不含任何指标码字面量）。 */
export function metricCatalog(): ReadonlyMap<string, MetricCatalogEntry> {
  const entries = allMetricKeys().map((metricKey): [string, MetricCatalogEntry] => {
    const name = nameByMetricKey[metricKey]
    const group = groupFactsFor(metricKey)
    const card = cardRowFor(metricKey)
    const officialRelease = officialReleaseFor(metricKey)
    const officialLegException = officialLegExceptionFor(metricKey)
    const sources = valueSourcesForMetric(metricKey)
    const sourceKeys = Object.freeze({
      narwhalMeasures: narwhalMeasuresFor(metricKey),
      zeroXRouterIndicatorIds: zeroXRouterIdsFor(metricKey)
    })
    const slugTemplate = (polymarketConsensusPolicy.slugTemplateByMetricKey as Readonly<Record<string, string>>)[metricKey]
    const divisor = (polymarketConsensusPolicy.valueDivisorByMetricKey as Readonly<Record<string, number>>)[metricKey]
    return [metricKey, Object.freeze({
      metricKey,
      ...(name === undefined ? {} : { name }),
      ...(group === undefined ? {} : { group }),
      ...(card === undefined ? {} : { card }),
      sources,
      ...(officialRelease === undefined ? {} : { officialRelease }),
      ...(officialLegException === undefined ? {} : { officialLegException }),
      sourceKeys,
      ...(slugTemplate === undefined ? {} : { marketSlugTemplate: slugTemplate }),
      ...(divisor === undefined ? {} : { marketValueDivisor: divisor }),
      policyPath: Object.freeze({
        annotated: (POLICY_PATH_EVENT_RELEVANT_METRIC_KEYS as readonly string[]).includes(metricKey),
        sameWindowPriority: (POLICY_PATH_EVENT_METRIC_PRIORITY as readonly string[]).includes(metricKey)
      }),
      mentionedBy: mentionedBy(metricKey),
      retiredTo: MACRO_INDICATOR_RETIRED_METRIC_KEYS.find((row) => row.retiredMetricKey === metricKey)?.currentMetricKey
    })]
  })
  return new Map(entries)
}

/** 卡片侧要读的那 12 行，按分组顺序给出（不在卡片表里的码不会出现在这里）。 */
export function metricCatalogForCards(): readonly MetricCatalogEntry[] {
  const catalog = metricCatalog()
  return MACRO_INDICATOR_GROUPS.flatMap((group) =>
    group.rows.flatMap((row) => {
      const entry = catalog.get(row.metricKey)
      return entry === undefined ? [] : [entry]
    }))
}

/**
 * 同一概念的**全部身份**（当前码 + 已退役码），按「当前码在前」排。
 *
 * 为什么必须开这个入口（Chief 2026-11-14）：政策路径白名单、优先序、抽屉的事件短名里都有
 * 「未季调兼容位」——库里旧行还在，删掉就会漏标旧事件。catalog 若只给当前 12 码，
 * 那三处只能把旧码删掉，等于拿新故障换旧故障。变体入口不参与完整性矩阵（它不是卡片行）。
 */
export function metricKeysForConceptOf(metricKey: string): readonly string[] {
  const concept = metricConceptOf(metricKey)
  const sameConcept = [...metricCatalog().keys()].filter((key) => metricConceptOf(key) === concept)
  /* 当前码在前：退役表里「谁是谁的现在」是数据，不靠排序猜。 */
  return Object.freeze(sameConcept.sort((left, right) => {
    const leftRetired = MACRO_INDICATOR_RETIRED_METRIC_KEYS.some((row) => row.retiredMetricKey === left)
    const rightRetired = MACRO_INDICATOR_RETIRED_METRIC_KEYS.some((row) => row.retiredMetricKey === right)
    return Number(leftRetired) - Number(rightRetired)
  }))
}
