import type { DailyBriefingCalendarEvent } from './dailyBriefingFactPacket'

/**
 * 缺值事件取值：**确定性回查日历源**（`02` `A0.12`，v2.125 改道）。
 *
 * 改道前这条路是「让模型联网取」，它与「无值事件不进分析快照」不能同时成立：模型要先看到事件
 * 才可能去查，而那条规则不许它看到。所以取值这一半让路——回查日历源，不经模型、不发 WebSearch，
 * 取到什么算什么，取不到只是「这一条没有值」。
 *
 * 这个模块只回答三个问题，别的都不做：
 * - **回查哪几条**：窗口内、高影响、没有实际值、**未取消**的事件；顺序 = 距截止更近 → 相关性高，
 *   同权按事件键稳定；一版最多 5 条；同一事件只回查一次。
 * - **回查了几条**：`calls` 数的是**事件条数**，不是网络请求数——判据（≤5/版、有值的行 0 次）
 *   按事件数来判，才判得动。
 * - **拿不拿得到**：回查只认日历源里同键事件新带上的 `actual`；读失败、源没变，一律等于
 *   「没有值」，**永不抛错**——一版不能因为一次回查失败就没了。
 *
 * 读者那边看到的是：值那一格不渲染。正文里不写任何"没拿到"之类的话（`02` v2.123）。
 */

/** 一版最多回查几条（`02` 定的 5）。 */
export const BRIEFING_MACRO_VALUE_LIMIT = 5

/** 回查的输入：一条窗口内的事件。只放判断需要的那几样，不把整条事件搬进来。 */
export type BriefingMacroValueEvent = Readonly<{
  eventKey: string
  importance: 'high' | 'medium' | 'low'
  scheduledAt: string
  /** 加密相关性（0–100），缺省按 0 排——绝不因为"不确定"就当成很相关。 */
  relevance?: number
  actual?: string
  lifecycleState?: 'scheduled' | 'released' | 'cancelled'
}>

/** 回查结果：事件键 + 日历源现在给出的实际值。 */
export type BriefingMacroValue = Readonly<{ eventKey: string; actual: string }>

export type BriefingMacroValueLookupResult = Readonly<{
  values: readonly BriefingMacroValue[]
  /** 回查了几**条事件**（不是发了几次请求）。有值的行不计入。 */
  calls: number
  /** 因为上限没轮到的事件：只留内部记录，版面不呈现。 */
  skipped: readonly string[]
}>

/** 回查的接口由调用方注入：真正去读日历源的是它，本模块不发网络请求。 */
export type BriefingMacroCalendarReRead = () => Promise<readonly BriefingMacroValueEvent[]>

/**
 * 该回查哪几条。**有值的、已取消的、非高影响的**都不进队列——有值不用取，取消的永远不会有值。
 */
export function selectMacroValueCandidates(input: Readonly<{
  events: readonly BriefingMacroValueEvent[]
  cutoff: string
  limit?: number
}>): Readonly<{ queue: readonly BriefingMacroValueEvent[]; skipped: readonly string[] }> {
  const cutoff = Date.parse(input.cutoff)
  const limit = input.limit ?? BRIEFING_MACRO_VALUE_LIMIT
  const seen = new Set<string>()
  const eligible = input.events
    .filter((event) => event.importance === 'high')
    .filter((event) => event.actual === undefined && event.lifecycleState !== 'cancelled')
    .filter((event) => {
      // 同一事件只回查一次：重复行不许发两次。
      if (seen.has(event.eventKey)) return false
      seen.add(event.eventKey)
      return true
    })
    .map((event) => ({
      event,
      distance: Math.abs(Date.parse(event.scheduledAt) - cutoff),
      relevance: event.relevance ?? 0
    }))
    .sort((left, right) =>
      left.distance - right.distance ||
      right.relevance - left.relevance ||
      left.event.eventKey.localeCompare(right.event.eventKey))
  const queue = eligible.slice(0, Math.max(0, limit)).map((entry) => entry.event)
  const skipped = eligible.slice(Math.max(0, limit)).map((entry) => entry.event.eventKey)
  return Object.freeze({ queue: Object.freeze(queue), skipped: Object.freeze(skipped) })
}

/**
 * 回查一轮。**永不抛错**：读失败、源没变、回的东西不带值，都只是"这一条没有值"。
 *
 * 队列为空时**一次都不读**——这是可数的判据（有值的事件回查 0 次）。
 */
export async function lookupMissingMacroValues(input: Readonly<{
  events: readonly BriefingMacroValueEvent[]
  cutoff: string
  read: BriefingMacroCalendarReRead
  limit?: number
}>): Promise<BriefingMacroValueLookupResult> {
  const selection = selectMacroValueCandidates({
    events: input.events,
    cutoff: input.cutoff,
    ...(input.limit === undefined ? {} : { limit: input.limit })
  })
  if (selection.queue.length === 0) {
    return Object.freeze({ values: Object.freeze([]), calls: 0, skipped: selection.skipped })
  }

  let fresh: readonly BriefingMacroValueEvent[] = []
  try {
    fresh = await input.read()
  } catch {
    // 源读不到等于"没有值"，不是整版失败：下面的归一就是空的。
    fresh = []
  }
  const byKey = new Map(fresh.map((event) => [event.eventKey, event]))
  const values: BriefingMacroValue[] = []
  for (const candidate of selection.queue) {
    const actual = byKey.get(candidate.eventKey)?.actual
    if (actual === undefined || actual.trim() === '') continue
    values.push(Object.freeze({ eventKey: candidate.eventKey, actual }))
  }
  return Object.freeze({
    values: Object.freeze(values),
    calls: selection.queue.length,
    skipped: selection.skipped
  })
}

/**
 * 把回查到的值并回日历事件列表。只补 `actual`，不动其它字段：回查到值意味着源里已经发布了，
 * 但 `lifecycleState` 的判断归源（`released` 是它打上的标记），这里不替它改。
 */
export function mergeMacroValues(
  events: readonly DailyBriefingCalendarEvent[],
  values: readonly BriefingMacroValue[]
): readonly DailyBriefingCalendarEvent[] {
  if (values.length === 0) return events
  const byKey = new Map(values.map((value) => [value.eventKey, value.actual]))
  return Object.freeze(events.map((event) => {
    const actual = byKey.get(event.eventKey)
    return actual === undefined || event.actual !== undefined ? event : Object.freeze({ ...event, actual })
  }))
}
