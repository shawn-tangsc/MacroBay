import type { BriefingMacroItem } from '../../../contracts/dailyBriefing'
import type { DailyBriefingCalendarEvent, DailyBriefingFactPacket } from './dailyBriefingFactPacket'

/**
 * 宏观那几行怎么选出来——与文档构造分开。它是一套自己的判断：哪些算候选（窗口内的高影响事件、
 * 不看有没有实际值、已取消的不算）、哪一条是兜底的关键一条、编辑选完之后怎么排、上限多少。
 * 抽出来之前它是构造文件里的一整段，每次改选取口径都要在 600 行的文件里找位置。
 */

/**
 * 窗口里的高影响事件——**不看有没有实际值**（`02` `A0.12`）。
 *
 * 以前这里是 `released && Boolean(actual)`：没有值的事件直接被丢掉，于是"有事件、我们没拿到值"
 * 在版面上变成了"没有事件"。这条流程里 `released` 恰恰是**拿到值之后才打上的标记**（经济日历
 * 查询把值合进来时才把 `scheduled` 改写成 `released`），所以它不能当成"这件事发生过"来用。
 *
 * 唯一要排除的是 `cancelled`：取消的事件永远不会有实际值，把它当成"还没拿到"是把"取消了"
 * 说成"数据没到"。它该不该显示成别的样子，口径待产品按 `02` 定。
 *
 * 窗口里到底有几条、"其中几条没拿到值"，与候选列表读同一份判断——两个数不许各自数一遍。
 */
export function highImpactEventsInWindow(packet: DailyBriefingFactPacket): readonly DailyBriefingCalendarEvent[] {
  if (packet.calendar.state !== 'available') return Object.freeze([])
  const start = Date.parse(packet.windowStart)
  const end = Date.parse(packet.windowEnd)
  return Object.freeze(packet.calendar.events
    .filter((event) => event.importance === 'high' && event.lifecycleState !== 'cancelled')
    .filter((event) => {
      const at = Date.parse(event.scheduledAt)
      return Number.isFinite(at) && at >= start && at < end
    }))
}

export function selectMacroCandidates(packet: DailyBriefingFactPacket): readonly BriefingMacroItem[] {
  return Object.freeze([...highImpactEventsInWindow(packet)]
    .sort((left, right) => surpriseMagnitude(right) - surpriseMagnitude(left) || right.scheduledAt.localeCompare(left.scheduledAt))
    .map((event) => toMacroItem(event)))
}

/**
 * 喂给写作模型的候选：**只含有实际值的事件**（`02` `A0.12` ⑤）。
 *
 * 展示与分析是两套：无值事件照常显示（值写「未拿到」），但不进模型读到的任何一份素材——
 * 否则模型会把"我们没拿到"写成一个判断。这条边界只在这一点上实现，别在提示词里再筛一遍。
 */
export function selectMacroAnalysisCandidates(items: readonly BriefingMacroItem[]): readonly BriefingMacroItem[] {
  return Object.freeze(items.filter((item) => item.actual !== undefined))
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

function toMacroItem(event: DailyBriefingCalendarEvent): BriefingMacroItem {
  return Object.freeze({
    eventKey: event.eventKey,
    title: event.title,
    ...(event.titleKey ? { titleKey: event.titleKey } : {}),
    scheduledAt: event.scheduledAt,
    importance: event.importance,
    ...(event.countryCode ? { countryCode: event.countryCode } : {}),
    ...(event.countryName ? { countryName: event.countryName } : {}),
    ...(event.actual === undefined ? {} : { actual: event.actual }),
    ...(event.previous === undefined ? {} : { previous: event.previous }),
    ...(event.consensus === undefined ? {} : { consensus: event.consensus }),
    surprise: Object.freeze({ ...event.surprise })
  })
}

function surpriseMagnitude(event: Readonly<{ surprise: BriefingMacroItem['surprise'] }>): number {
  if (event.surprise.unit === 'pp' && typeof event.surprise.value === 'number') return Math.abs(event.surprise.value)
  if (event.surprise.unit === 'relative-percent' && typeof event.surprise.value === 'number') return Math.abs(event.surprise.value) / 10
  return event.surprise.direction === 'inline' || event.surprise.direction === 'consensus-unavailable' ? 0 : 1
}
