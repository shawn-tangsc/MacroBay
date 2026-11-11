import type { BriefingMacroItem } from '../../../contracts/dailyBriefing'
import type { DailyBriefingCalendarEvent, DailyBriefingFactPacket } from './dailyBriefingFactPacket'
import { localDate } from './dailyBriefingWindow'

/**
 * 宏观那几行怎么选出来——与文档构造分开。它是一套自己的判断：哪些算候选（窗口内的高影响事件、
 * 不看有没有实际值、已取消的也算）、哪一条是兜底的关键一条、编辑选完之后怎么排、上限多少。
 * 抽出来之前它是构造文件里的一整段，每次改选取口径都要在 600 行的文件里找位置。
 */

/**
 * 窗口里的高影响事件——**不看有没有实际值**（`02` `A0.12`）。
 *
 * 以前这里是 `released && Boolean(actual)`：没有值的事件直接被丢掉，于是"有事件、我们没拿到值"
 * 在版面上变成了"没有事件"。这条流程里 `released` 恰恰是**拿到值之后才打上的标记**（经济日历
 * 查询把值合进来时才把 `scheduled` 改写成 `released`），所以它不能当成"这件事发生过"来用。
 *
 * 已取消的事件也是候选（`02` v2.125）：那天原定有一场、后来取消，这是真实的排期变化，藏起来
 * 读者会以为数据漏了。行照常显示并标「已取消」，值格不渲染；它另有标记，不靠"没有值"去推断。
 *
 * 窗口里到底有几条、其中多少行真的摆出来，与候选列表读同一份判断——两个数不许各自数一遍。
 */
export function highImpactEventsInWindow(packet: DailyBriefingFactPacket): readonly DailyBriefingCalendarEvent[] {
  if (packet.calendar.state !== 'available') return Object.freeze([])
  const endDay = localDate(packet.windowEnd, packet.timeZone)
  const window = { start: packet.windowStart, end: packet.windowEnd, timeZone: packet.timeZone }
  return Object.freeze(packet.calendar.events
    .filter((event) => event.importance === 'high')
    .filter((event) => briefingEventInWindow(event, window))
    // 今天、还没发生（`scheduled`）的那一场归「接下来」，否则同一场会两栏都出现。
    .filter((event) => !(event.releaseTimeNotPublished && endDay !== undefined &&
      event.releaseDate === endDay && event.lifecycleState === 'scheduled')))
}

/**
 * 一条日历事件属不属于 `[windowStart, windowEnd)` 这一栏——只判归属，不判分到哪一段。
 *
 * 有时刻就按瞬时判；**只公布日期**时按日期判（`scheduledAt` 只是排序位，不能当瞬时）：
 * 只按瞬时判，日期位落在窗口起点之前就会把昨天的事件整条丢掉——「把有事件说成没有事件」
 * 比多列一条更糟。
 */
export function briefingEventInWindow(
  event: Readonly<{ scheduledAt: string; releaseTimeNotPublished?: true; releaseDate?: string }>,
  window: Readonly<{ start: string; end: string; timeZone: string }>
): boolean {
  if (event.releaseTimeNotPublished) {
    const day = event.releaseDate
    const startDay = localDate(window.start, window.timeZone)
    const endDay = localDate(window.end, window.timeZone)
    return day !== undefined && startDay !== undefined && endDay !== undefined && day >= startDay && day <= endDay
  }
  const at = Date.parse(event.scheduledAt)
  return Number.isFinite(at) && at >= Date.parse(window.start) && at < Date.parse(window.end)
}

/**
 * 24 小时宏观栏暂时隐藏的两类事件（用户 2026-11-06：「所有央行活动和财经事件，暂时都不要显示」）。
 *
 * **按类别判，不按"有没有值"判**：以后这些事件补上数值也不许自己冒出来。类别来自日历源。
 * 临时口径——要恢复就清空这个数组，一行改回来；判断只在这一处，页面与导出都读同一份结论。
 */
export const briefingHiddenMacroCategories: readonly DailyBriefingCalendarEvent['category'][] = [
  'central-bank-activity',
  'financial-event'
]

/** 一条日历事件该不该进 24h 宏观栏（正文、导出、分析素材三处共用这一个判断）。 */
export function briefingMacroCategoryVisible(category: DailyBriefingCalendarEvent['category'] | undefined): boolean {
  return category === undefined || !briefingHiddenMacroCategories.includes(category)
}

/**
 * 名字兜底（用户 2026-11-06）：源给的类别不是每次都可信——同一天里要做的事，源会把
 * 「英国央行公布利率决议、会议纪要及货币政策报告」和「官方银行利率」分开标，但换个源、换个
 * 语言就可能把讲话标成经济指标。名字里就是讲话、发布会、纪要、决议的，一律按央行活动处理。
 *
 * 两种语言都写在这里：英文版次读的是英文事件名，只写中文等于英文版次照旧漏出来。
 * 不许按"有没有值"判——这条兜底与值无关；「官方银行利率」这种带值的指标名字不沾这些词，
 * 所以它照常显示。
 */
export const briefingHiddenMacroTitlePattern =
  /讲话|新闻发布会|记者会|会议纪要|利率决议|\b(?:speech|remarks|press conference|minutes|rate decision)\b/i

/** 类别 + 名字一起判：一条事件该不该出现在 24h 宏观栏。 */
export function briefingMacroEventVisible(
  event: Pick<DailyBriefingCalendarEvent, 'category' | 'title' | 'titleKey'>
): boolean {
  if (!briefingMacroCategoryVisible(event.category)) return false
  return !briefingHiddenMacroTitlePattern.test(event.title) && !briefingHiddenMacroTitlePattern.test(event.titleKey ?? '')
}

export function selectMacroCandidates(
  packet: DailyBriefingFactPacket,
  webValueKeys: ReadonlySet<string> = new Set()
): readonly BriefingMacroItem[] {
  return Object.freeze([...highImpactEventsInWindow(packet)]
    .filter((event) => briefingMacroEventVisible(event))
    .sort((left, right) => surpriseMagnitude(right) - surpriseMagnitude(left) || right.scheduledAt.localeCompare(left.scheduledAt))
    .map((event) => toMacroItem(event, webValueKeys.has(event.eventKey))))
}

/**
 * 喂给写作模型的候选：**只含有实际值、且没有取消的事件**（`02` `A0.12` ⑤ / v2.125）。
 *
 * 展示与分析是两套：无值与已取消的事件照常显示（值那一格不渲染），但不进模型读到的任何一份
 * 素材——否则模型会把"我们没有值"写成一句判断。取消的事件另有一层理由：它没有值不是没拿到，
 * 而是不会有了，模型更不该拿它讲故事。这条边界只在这一点上实现，别在提示词里再筛一遍。
 */
export function selectMacroAnalysisCandidates(items: readonly BriefingMacroItem[]): readonly BriefingMacroItem[] {
  return Object.freeze(items.filter((item) => item.actual !== undefined && item.lifecycleState !== 'cancelled'))
}

export function selectMacro(packet: DailyBriefingFactPacket, candidates: readonly BriefingMacroItem[]): readonly BriefingMacroItem[] {
  return selectBriefingMacroItems(candidates, selectMacroFloorItem(candidates))
}

/**
 * The 24h macro section shows **every** release the editor judged worth showing（用户 2026-11-06）：
 * 以前这里卡死四条，读者看到「共 3 条（另 6 条未列出）」，等于把 AI 的判断又截了一半。
 *
 * 上限没有了；`maximumBriefingMacroItems` 仍导出，值是 `Number.POSITIVE_INFINITY`——**别改回数字**，
 * 那是把截断悄悄装回来的最短路径。
 */
export const maximumBriefingMacroItems = Number.POSITIVE_INFINITY

export function selectBriefingMacroItems(
  selected: readonly BriefingMacroItem[],
  floor?: BriefingMacroItem
): readonly BriefingMacroItem[] {
  const ordered: BriefingMacroItem[] = []
  const seen = new Set<string>()
  for (const item of [floor, ...selected]) {
    if (!item || seen.has(item.eventKey)) continue
    seen.add(item.eventKey)
    ordered.push(item)
  }
  return Object.freeze(ordered)
}

/**
 * The key release for the default selection: the largest surprise, and the latest release on a tie.
 * It is the fallback when there is no editor selection yet, so a template document shows one key
 * print instead of every high-impact release.
 */
export function selectMacroFloorItem(items: readonly BriefingMacroItem[]): BriefingMacroItem | undefined {
  let floor: BriefingMacroItem | undefined
  for (const item of items) {
    if (item.importance !== 'high') continue
    if (!floor) {
      floor = item
      continue
    }
    const difference = surpriseMagnitude(item) - surpriseMagnitude(floor)
    if (difference > 0 || (difference === 0 && Date.parse(item.scheduledAt) > Date.parse(floor.scheduledAt))) floor = item
  }
  return floor
}

function toMacroItem(event: DailyBriefingCalendarEvent, webSourced = false): BriefingMacroItem {
  return Object.freeze({
    eventKey: event.eventKey,
    title: event.title,
    ...(event.titleKey ? { titleKey: event.titleKey } : {}),
    scheduledAt: event.scheduledAt,
    importance: event.importance,
    ...(event.countryCode ? { countryCode: event.countryCode } : {}),
    ...(event.countryName ? { countryName: event.countryName } : {}),
    ...(event.actual === undefined ? {} : { actual: event.actual }),
    // 只有"值确实是联网取到的"才标来源；库里本来就有的值一个字都不加（`02` v2.128）。
    ...(event.actual === undefined || !webSourced ? {} : { valueSource: 'web' as const }),
    ...(event.previous === undefined ? {} : { previous: event.previous }),
    ...(event.consensus === undefined ? {} : { consensus: event.consensus }),
    // 原样带下来（schema 14）：卡片靠它画「已取消」，快照靠它排除；不在这里判断，判断只有一处。
    lifecycleState: event.lifecycleState,
    // 只公布了日期的那一对（schema 16）：卡片靠它决定「画日期 + 一句话」而不是画 `scheduledAt`。
    ...(event.releaseTimeNotPublished && event.releaseDate
      ? { releaseTimeNotPublished: true as const, releaseDate: event.releaseDate }
      : {}),
    surprise: Object.freeze({ ...event.surprise })
  })
}

function surpriseMagnitude(event: Readonly<{ surprise: BriefingMacroItem['surprise'] }>): number {
  if (event.surprise.unit === 'pp' && typeof event.surprise.value === 'number') return Math.abs(event.surprise.value)
  if (event.surprise.unit === 'relative-percent' && typeof event.surprise.value === 'number') return Math.abs(event.surprise.value) / 10
  return event.surprise.direction === 'inline' || event.surprise.direction === 'consensus-unavailable' ? 0 : 1
}
