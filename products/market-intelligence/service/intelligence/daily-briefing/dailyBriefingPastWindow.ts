import type { DailyBriefingCalendarEvent } from './dailyBriefingFactPacket'
import { briefingEventInWindow } from './dailyBriefingCalendarWindow'

/**
 * 「过去 24 小时」那一段摆什么（用户 2026-11-14，产品定稿 A）。
 *
 * 背景：那一刻窗口里其实有 7 条发布（1 条核心 PPI、5 场央行讲话、1 条油井数），但旧逻辑只收
 * `importance === 'high'`，一条都不剩，产物写成「没有高影响事件」——**把「筛没了」说成了「没有」**。
 *
 * 判据四条，按产品原话：
 * 1. **总数与构成来自窗口里的全部行**，不是筛后的行；混用会让「共 7 条」和「明细 1 条」自相矛盾。
 * 2. **明细最多 3 条**，按类型分配：经济指标 ≤2、央行与讲话 ≤1、财经事件 ≤1——5 条讲话不会占满整屏。
 * 3. **排序有值优先，再按时刻**：带实际值的经济指标必然进；没有值的按时间。
 * 4. **剩下的收进「另有 N 条」**，N = 总数 − 明细条数，永远是未显示数，不是筛掉的数。
 */
export type BriefingPastWindowCounts = Readonly<{
  total: number
  indicators: number
  centralBank: number
  financial: number
}>

export type BriefingPastWindowSelection = Readonly<{
  counts: BriefingPastWindowCounts
  shown: readonly DailyBriefingCalendarEvent[]
  /** 未显示条数（`total - shown.length`），供「另有 N 条」用。 */
  hidden: number
}>

export const briefingPastWindowCaps = Object.freeze({ indicators: 2, centralBank: 1, financial: 1, total: 3 })

export function selectPastWindowReleases(
  events: readonly DailyBriefingCalendarEvent[],
  window: Readonly<{ start: string; end: string; timeZone: string }>
): BriefingPastWindowSelection {
  const inWindow = events.filter((event) => briefingEventInWindow(event, window))
  // 类别缺失的行按经济指标计入：三类相加必须等于总数，否则「共 7 条（1·5·1）」自己就不成立。
  const categoryOf = (event: DailyBriefingCalendarEvent): NonNullable<DailyBriefingCalendarEvent['category']> =>
    event.category ?? 'economic-indicator'
  const counts: BriefingPastWindowCounts = Object.freeze({
    total: inWindow.length,
    indicators: inWindow.filter((event) => categoryOf(event) === 'economic-indicator').length,
    centralBank: inWindow.filter((event) => categoryOf(event) === 'central-bank-activity').length,
    financial: inWindow.filter((event) => categoryOf(event) === 'financial-event').length
  })
  const ordered = [...inWindow].sort((left, right) => {
    const leftValue = left.actual === undefined ? 1 : 0
    const rightValue = right.actual === undefined ? 1 : 0
    return leftValue - rightValue || left.scheduledAt.localeCompare(right.scheduledAt)
  })
  const shown: DailyBriefingCalendarEvent[] = []
  const used = { 'economic-indicator': 0, 'central-bank-activity': 0, 'financial-event': 0 }
  const capOf = (category: NonNullable<DailyBriefingCalendarEvent['category']>): number =>
    category === 'economic-indicator' ? briefingPastWindowCaps.indicators
      : category === 'central-bank-activity' ? briefingPastWindowCaps.centralBank
        : briefingPastWindowCaps.financial
  for (const event of ordered) {
    if (shown.length >= briefingPastWindowCaps.total) break
    const category = categoryOf(event)
    if (used[category] >= capOf(category)) continue
    used[category] += 1
    shown.push(event)
  }
  return Object.freeze({ counts, shown: Object.freeze(shown), hidden: counts.total - shown.length })
}
