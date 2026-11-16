import type {
  DirectMetricRow, MappingRuleRow
} from '../../../service/intelligence/macro-calendar/rendering/marketCalendarMappingRulesRead'

/**
 * 映射规则表的**看法**（排序与分级筛选）——纯函数，与读口分开：
 *
 * - 读口负责「库里有多少行、谁是谁的子项、子项在词表里第几个」；
 * - 这里只负责「按什么顺序摆、按哪一档筛」。
 *
 * 排序（Chief 2026-11-17）：**按族分组**。母项在前、它的子项紧随其后；族与族之间按母项行数降序；
 * 子项内部按读口给的 `childOrder` 升序（词表顺序只在那一边定义，界面不另写一份中文词表——写了就是
 * 第二份规则，改词表时两边不一致还不报错）。
 *
 * 层级字段**可缺**（旧载荷没有这一段）：缺了就是「没有族信息」，各自成族，也不显示归属小字。
 */
export type TierKey = '1' | '2' | '3' | 'other'
export type TierFilter = TierKey | 'all'

/** 分级只有一处翻译：`1 | 2 | 3 | null` → 四档键。`null` 是「未分级」，不是「没有」。 */
export function tierKeyOf(tier: 1 | 2 | 3 | null): TierKey {
  return tier === null ? 'other' : (String(tier) as '1' | '2' | '3')
}

/** 分级的高低序：一级在前，未分级最后。 */
const TIER_RANK: Readonly<Record<TierKey, number>> = { '1': 0, '2': 1, '3': 2, other: 3 }

/** 带族信息的行（已映射与无需映射两段都满足这个形状）；层级字段可缺。 */
export type FamilyMember = Readonly<{
  metricKey: string
  parentMetricKey?: string | null
  kind?: 'parent' | 'child'
  childOrder?: number
  rowCount: number
  tier?: 1 | 2 | 3 | null
}>

const isChild = (row: FamilyMember): boolean => row.kind === 'child' && row.parentMetricKey != null

/**
 * 按族分组，返回「族 → 行」的列表，族已按母项行数降序排好。
 * 母项本身不在表里时（只有子项），族按「子项里最大的行数」排，族键用母码——仍是显式字段，不截字符串。
 */
function families<T extends FamilyMember>(rows: readonly T[]): T[][] {
  const buckets = new Map<string, T[]>()
  for (const row of rows) {
    const key = isChild(row) ? row.parentMetricKey! : row.metricKey
    const bucket = buckets.get(key)
    if (bucket === undefined) buckets.set(key, [row])
    else bucket.push(row)
  }
  return [...buckets.entries()]
    .map(([key, bucket]) => ({
      key,
      bucket,
      // 族的体量＝母项行数；母项不在表里时取子项里最大的那个。
      rank: bucket.find((row) => !isChild(row) && row.metricKey === key)?.rowCount
        ?? Math.max(...bucket.map((row) => row.rowCount)),
      // 同体量的族按分级排（一、二、三、未分级），与「行数降序 → 分级」的老规矩一致。
      tier: Math.min(...bucket.map((row) => (row.tier === undefined || row.tier === null
        ? TIER_RANK.other : TIER_RANK[tierKeyOf(row.tier)])))
    }))
    .sort((left, right) => right.rank - left.rank || left.tier - right.tier
      || left.key.localeCompare(right.key))
    .map(({ bucket }) => [
      // 母项排在这个族的第一位：读者先看到「这件事」，再看到它的分项。
      ...bucket.filter((row) => !isChild(row)),
      ...bucket.filter(isChild).sort((left, right) =>
        (left.childOrder ?? Number.MAX_SAFE_INTEGER) - (right.childOrder ?? Number.MAX_SAFE_INTEGER))
    ])
}

export function sortMappedRules(rows: readonly MappingRuleRow[]): MappingRuleRow[] {
  return families(rows).flat()
}

export function sortDirectMetrics(rows: readonly DirectMetricRow[]): DirectMetricRow[] {
  return families(rows).flat()
}

export function filterMappedByTier(rows: readonly MappingRuleRow[], tier: TierFilter): MappingRuleRow[] {
  return tier === 'all' ? [...rows] : rows.filter((row) => tierKeyOf(row.tier) === tier)
}

export function filterDirectByTier(rows: readonly DirectMetricRow[], tier: TierFilter): DirectMetricRow[] {
  return tier === 'all' ? [...rows] : rows.filter((row) => tierKeyOf(row.tier) === tier)
}

/**
 * **父带子**（Chief 2026-11-17）：命中一个母指标时，它的子项一起留下；命中子项只留子项
 * （反过来把母项也拉进来，读者会以为自己搜到了母项）。
 *
 * 判据来自显式字段 `kind` / `parentMetricKey`，不看名字、不截码。
 */
export function expandToFamily<T extends FamilyMember>(rows: readonly T[], matched: readonly T[]): T[] {
  const hitParents = new Set(matched.filter((row) => !isChild(row)).map((row) => row.metricKey))
  if (hitParents.size === 0) return [...matched]
  const keep = new Set(matched)
  for (const row of rows) {
    if (isChild(row) && hitParents.has(row.parentMetricKey!)) keep.add(row)
  }
  // 保持原顺序：调用方传进来的已是族排好的序列。
  return rows.filter((row) => keep.has(row))
}
