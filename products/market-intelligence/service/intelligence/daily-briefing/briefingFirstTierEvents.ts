import type { BriefingNextItem } from '../../../contracts/dailyBriefing'

/**
 * 「必须出现的事件」并进「接下来」：**这个文件现在只剩合并顺序**。
 *
 * 身份正则与标题正则已删（R44 S3）：谁进候选、谁必须出现，由日历侧判出来的档决定
 * （`importance_grade`，读侧映射到 `importance`）。这里再放一套「谁该出现」，就是两个判据打架：
 * 同一场事件可能因为「名字里带 CPI」被抬回来，而它的档根本没判过高。
 *
 * 剩下的职责只有一件：mustKeep 在前、其余按编辑的选择顺序、去重（focus 不算在 items 里）、截到上限。
 *
 * 合并规则：mustKeep 在前，其余按原顺序，去重后截到上限；已选里本来就有它的不重复，
 * focus 那条不算在 items 里（由版面置顶显示）。
 */
export function mergeFirstTierNext<T extends Pick<BriefingNextItem, 'eventKey'>>(input: Readonly<{
  focusEventKey?: string
  selected: readonly T[]
  mustKeep: readonly T[]
  limit: number
}>): readonly T[] {
  const seen = new Set<string>()
  const merged: T[] = []
  for (const item of [...input.mustKeep, ...input.selected]) {
    if (item.eventKey === input.focusEventKey || seen.has(item.eventKey)) continue
    seen.add(item.eventKey)
    merged.push(item)
  }
  return Object.freeze(merged.slice(0, input.limit))
}
