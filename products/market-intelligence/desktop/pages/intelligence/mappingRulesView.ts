import type { MappingRuleRow } from '../../../service/intelligence/macro-calendar/rendering/marketCalendarMappingRulesRead'

/**
 * 映射规则表的**看法**（排序与分级筛选）——纯函数，与读口分开：
 *
 * - 读口只负责「库里的行数是多少」；
 * - 这里只负责「按什么顺序摆、按哪一档筛」。
 *
 * 排序规则（用户 2026-11-17）：**库里行数降序 → 分级（一、二、三、未分级）→ 指标码**。
 * 行数排在最前，是因为读者要的答案是「哪些规则真的在起作用」；`0` 行的那批沉到后面，
 * 但它们**仍然显示**（0 是事实，不是「没有这条规则」）。
 */
export type TierKey = '1' | '2' | '3' | 'other'
export type TierFilter = TierKey | 'all'

/** 分级只有一处翻译：`1 | 2 | 3 | null` → 四档键。`null` 是「未分级」，不是「没有」。 */
export function tierKeyOf(tier: 1 | 2 | 3 | null): TierKey {
  return tier === null ? 'other' : (String(tier) as '1' | '2' | '3')
}

/** 分级的高低序：一级在前，未分级最后。 */
const TIER_RANK: Readonly<Record<TierKey, number>> = { '1': 0, '2': 1, '3': 2, other: 3 }

export function sortMappedRules(rows: readonly MappingRuleRow[]): MappingRuleRow[] {
  return [...rows].sort((left, right) =>
    right.rowCount - left.rowCount
    || TIER_RANK[tierKeyOf(left.tier)] - TIER_RANK[tierKeyOf(right.tier)]
    || left.metricKey.localeCompare(right.metricKey)
    // 同一个指标码可能有多条源内 id（不同写法），最后按 id 定序，免得顺序随查询漂移。
    || left.sourceId.localeCompare(right.sourceId))
}

export function filterMappedByTier(rows: readonly MappingRuleRow[], tier: TierFilter): MappingRuleRow[] {
  return tier === 'all' ? [...rows] : rows.filter((row) => tierKeyOf(row.tier) === tier)
}
