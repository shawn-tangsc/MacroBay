import { etfWindowSourceIdFor } from './etfCurrentStateWindow'
import type { EtfFlowHistoryRow } from './etfFlowHistoryParser'

/**
 * 逐日合并两支流水：**同一天两个源都有值时，值相同保留旧行、值不同用主源的**；只有一边有就用那一边。
 *
 * 用户 2026-11-17：「旧源给我加回来，互相补充，新的覆盖旧的（只有数据变化的时候）」。
 *
 * 「相同」只比 `changeUsd`：同一交易日的净流是这条线唯一的事实，`sourceRevision`、抓取时间、来源标签
 * 都不参与相等性——否则一次抓取时间的差异就会让「没变的日子」也翻来源、产生一次假变更。
 * 合并结果与上一次一致 → 窗口 revision 相同 → store 的 `replace` 返回 `unchanged`。
 */
export function mergeEtfAssetDays(
  primary: readonly EtfFlowHistoryRow[] | undefined,
  standby: readonly EtfFlowHistoryRow[] | undefined
): readonly EtfFlowHistoryRow[] | undefined {
  if (!primary && !standby) return undefined
  const byDate = new Map<number, EtfFlowHistoryRow>()
  for (const row of standby ?? []) byDate.set(row.date, row)
  for (const row of primary ?? []) {
    const old = byDate.get(row.date)
    // 值一样就保留旧行（不写新行、不翻来源）；值变了才用主源这条覆盖。
    if (old !== undefined && old.changeUsd === row.changeUsd) continue
    byDate.set(row.date, row)
  }
  const merged = [...byDate.values()].sort((left, right) => left.date - right.date)
  return merged.length === 0 ? undefined : merged
}

/**
 * 给一支流水盖上「它属于哪个来源」，用的是**窗口 id**，不是采集侧的注册表 id。
 *
 * 这一步不许省：两套词表（注册表 / 窗口契约）只在 `etfWindowSourceIdFor` 里翻译一次，
 * 调用方直接把注册表 id 写进行里，整窗会被 `allowedSourceIds` 拒掉——而拒绝发生在窗口构建里，
 * 刷新层只看到 `undefined`，读者看到的是「数据不更新」（2026-11-17）。
 */
export function tagEtfSourceRows(
  rows: readonly EtfFlowHistoryRow[] | undefined,
  sourceId: string
): readonly EtfFlowHistoryRow[] | undefined {
  const source = etfWindowSourceIdFor(sourceId)
  if (rows === undefined || source === undefined) return undefined
  return Object.freeze(rows.map((row) => Object.freeze({ ...row, source })))
}
