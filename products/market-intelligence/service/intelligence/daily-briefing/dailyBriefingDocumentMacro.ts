import type { BriefingMacroItem } from '../../../contracts/dailyBriefing'
import type { DailyBriefingCalendarEvent, DailyBriefingFactPacket } from './dailyBriefingFactPacket'

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
  const start = Date.parse(packet.windowStart)
  const end = Date.parse(packet.windowEnd)
  return Object.freeze(packet.calendar.events
    .filter((event) => event.importance === 'high')
    .filter((event) => {
      const at = Date.parse(event.scheduledAt)
      return Number.isFinite(at) && at >= start && at < end
    }))
}

export function selectMacroCandidates(
  packet: DailyBriefingFactPacket,
  webValueKeys: ReadonlySet<string> = new Set()
): readonly BriefingMacroItem[] {
  return Object.freeze([...highImpactEventsInWindow(packet)]
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
 * The 24h macro section is a judgement, not a table: at most four releases reach the reader. The
 * deterministic floor stays first, the editor's selection follows in candidate order (largest
 * actual-vs-previous surprise first), and everything past the cap stays in `macroCandidates` for the
 * audit instead of being rendered as another row without an explanation.
 */
export const maximumBriefingMacroItems = 4

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
    if (ordered.length === maximumBriefingMacroItems) break
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
    surprise: Object.freeze({ ...event.surprise })
  })
}

function surpriseMagnitude(event: Readonly<{ surprise: BriefingMacroItem['surprise'] }>): number {
  if (event.surprise.unit === 'pp' && typeof event.surprise.value === 'number') return Math.abs(event.surprise.value)
  if (event.surprise.unit === 'relative-percent' && typeof event.surprise.value === 'number') return Math.abs(event.surprise.value) / 10
  return event.surprise.direction === 'inline' || event.surprise.direction === 'consensus-unavailable' ? 0 : 1
}
