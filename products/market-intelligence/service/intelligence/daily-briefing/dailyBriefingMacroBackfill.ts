import type { BriefingMacroValueEvent } from './dailyBriefingMacroValueLookup'
import { lookupMissingMacroValues } from './dailyBriefingMacroValueLookup'
import type { BriefingMacroWebRead } from './dailyBriefingMacroWebSource'

/**
 * 两级取值编排（`02` v2.127）。
 *
 * 1. **第一级**：确定性回查日历源（`lookupMissingMacroValues`，已在库里）。免费、不经模型；
 * 2. **第二级**：第一级仍未拿到的，才走联网（`BriefingMacroWebRead`）。**拿到的绝不再联网**。
 *
 * 判据里那几个"数"都在这一层数：回查了几条、联网发了几次。纯函数层数不出来——它不知道
 * 编排会不会去调。
 *
 * 两级都拿不到时**事件仍然在版面上**，只是值那一格不渲染；这里只报"哪几条没有值"。
 */

export type BriefingMacroBackfillResult = Readonly<{
  resolved: readonly Readonly<{
    eventKey: string
    actual: string
    via: 'calendar' | 'web'
    sourceUrl?: string
    capturedAt?: string
  }>[]
  conflicts: readonly Readonly<{ eventKey: string; values: readonly string[] }>[]
  /** 第一级回查的事件条数。 */
  calendarCalls: number
  /** 第二级实际发出的搜索次数。 */
  webCalls: number
  /** 两级都没拿到的事件键（事件照显示，值格不渲染）。 */
  unresolved: readonly string[]
}>

export async function backfillMacroValues(input: Readonly<{
  events: readonly BriefingMacroValueEvent[]
  cutoff: string
  readCalendar: () => Promise<readonly BriefingMacroValueEvent[]>
  readWeb?: BriefingMacroWebRead
  limit?: number
}>): Promise<BriefingMacroBackfillResult> {
  const calendar = await lookupMissingMacroValues({
    events: input.events,
    cutoff: input.cutoff,
    read: input.readCalendar,
    ...(input.limit === undefined ? {} : { limit: input.limit })
  })
  const resolved: { eventKey: string; actual: string; via: 'calendar' | 'web'; sourceUrl?: string; capturedAt?: string }[] =
    calendar.values.map((value) => ({ eventKey: value.eventKey, actual: value.actual, via: 'calendar' as const }))
  const filled = new Set(calendar.values.map((value) => `${value.eventKey}`))

  // 只有第一级没拿到的才进第二级；有值的、已取消的、非高影响的都不该被发出去问。
  const remaining = input.events.filter((event) =>
    event.importance === 'high' &&
    event.lifecycleState !== 'cancelled' &&
    event.actual === undefined &&
    !filled.has(event.eventKey))

  let webCalls = 0
  let conflicts: readonly Readonly<{ eventKey: string; values: readonly string[] }>[] = []
  if (remaining.length > 0 && input.readWeb !== undefined) {
    const web = await input.readWeb(remaining)
    webCalls = web.calls
    conflicts = web.conflicts
    for (const value of web.values) {
      resolved.push({
        eventKey: value.eventKey,
        actual: value.actual,
        via: 'web',
        sourceUrl: value.sourceUrl,
        capturedAt: value.capturedAt
      })
      filled.add(value.eventKey)
    }
  }

  return Object.freeze({
    resolved: Object.freeze(resolved),
    conflicts: Object.freeze(conflicts),
    calendarCalls: calendar.calls,
    webCalls,
    unresolved: Object.freeze(remaining.filter((event) => !filled.has(event.eventKey)).map((event) => event.eventKey))
  })
}
