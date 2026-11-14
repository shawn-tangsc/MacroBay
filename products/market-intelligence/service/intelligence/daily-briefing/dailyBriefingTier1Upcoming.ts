import type { DailyBriefingCalendarEvent } from './dailyBriefingFactPacket'
import {
  marketCalendarReleaseGroupByMetricKey,
  marketCalendarReleaseGroupPrimary,
  marketCalendarTier1MetricKeys
} from '../macro-calendar/marketCalendarReleaseGroups'

/**
 * 一级指标的下次发布——「未来 7 天」那一栏在**无法判定高影响事件**时摆出来的真实内容
 * （用户 2026-11-14，产品定稿）。
 *
 * 四条边界，每条都对应一次已经发生的误写：
 *
 * 1. **清单从分级常量派生，不许在简报里再抄一份十二个码**（`marketCalendarTier1MetricKeys`）。
 * 2. **一个发布组一行**：十二个一级码落在三个组（CPI / 就业 / PCE），逐码列会变成
 *    「CPI 年率 12-10、CPI 月率 12-10、核心 CPI 年率 12-10…」四行同一天，读者只会觉得重复。
 *    组内取**主测度**（`marketCalendarReleaseGroupPrimary`），它就是新闻口径那一条。
 * 3. **它不是「高影响事件」**：那条是来源给的重要性，这条是我们自己的分级。两者不混用。
 * 4. **下一次**＝该码在 `asOf` 之后最近的一场；同一码有多期时只取最早的一场。
 */
export type BriefingTier1UpcomingRelease = Readonly<{
  metricKey: string
  title: string
  scheduledAt: string
  releaseTimeNotPublished?: true
  releaseDate: string
}>

/** 一级码 → 发布组 → 组内主测度；主测度不在事件里时退回该组任一一级码。 */
function tier1PrimaryByGroup(tier1MetricKeys: readonly string[]): ReadonlyMap<string, readonly string[]> {
  const byGroup = new Map<string, string[]>()
  for (const metricKey of tier1MetricKeys) {
    const group = marketCalendarReleaseGroupByMetricKey[metricKey]
    if (group === undefined) continue
    const list = byGroup.get(group) ?? []
    const primary = marketCalendarReleaseGroupPrimary[group]
    if (primary === metricKey) list.unshift(metricKey)
    else list.push(metricKey)
    byGroup.set(group, list)
  }
  return byGroup
}

export function selectTier1UpcomingReleases(
  events: readonly DailyBriefingCalendarEvent[],
  asOf: string,
  tier1MetricKeys: readonly string[] = marketCalendarTier1MetricKeys
): readonly BriefingTier1UpcomingRelease[] {
  const cutoff = Date.parse(asOf)
  if (!Number.isFinite(cutoff)) return Object.freeze([] as const)
  const byMetricKey = new Map<string, BriefingTier1UpcomingRelease>()
  for (const event of events) {
    const metricKey = event.metricKey
    if (metricKey === undefined) continue
    if (event.lifecycleState === 'cancelled') continue
    if (event.releaseTimeNotPublished) {
      // 只有日期的事件：日期位是 UTC 零点，不能当瞬时比；`asOf` 当天或之后都算「还没到」。
      const day = event.releaseDate
      if (day === undefined || day < asOf.slice(0, 10)) continue
    } else if (!(Date.parse(event.scheduledAt) > cutoff)) {
      // 已经发布过的那一场不是「下次」。等于截止时刻的也不列：这一版已经看得到它。
      continue
    }
    const candidate: BriefingTier1UpcomingRelease = Object.freeze({
      metricKey,
      title: event.title,
      scheduledAt: event.scheduledAt,
      ...(event.releaseTimeNotPublished === true ? { releaseTimeNotPublished: true as const } : {}),
      releaseDate: event.releaseDate ?? event.scheduledAt.slice(0, 10)
    })
    const existing = byMetricKey.get(metricKey)
    if (existing === undefined || candidate.scheduledAt < existing.scheduledAt) byMetricKey.set(metricKey, candidate)
  }
  const picked: BriefingTier1UpcomingRelease[] = []
  for (const candidates of tier1PrimaryByGroup(tier1MetricKeys).values()) {
    for (const metricKey of candidates) {
      const release = byMetricKey.get(metricKey)
      if (release !== undefined) { picked.push(release); break }
    }
  }
  return Object.freeze(picked.sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt)))
}
