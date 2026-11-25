import type { JobRuntime } from '@platform/jobs'

import type { MacroCalendarRepository } from '../macroCalendarRepository'
import type { MacroCalendarInterpretationService } from '../macroCalendarEventInterpretationService'

/**
 * **高档事件的后台补生成**（R36 #34 第二半，「实际值落库后自动生成一次」的自动那半）。
 *
 * 为什么要有作业、而不是在写入口挂钩：标准表的写入口是唯一的、被回填与多路采集共用，
 * 在那里塞一次模型调用会把「写库」变成「写库 + 花钱」，任何一次批量回填都会顺带烧掉一批调用。
 * 作业按轮扫描：读已发布、高档、有实际值、还没有当前 `data_key` 解读的行，生成最多 N 条就收。
 *
 * 三条硬规矩：
 * - **只补高档**：档是判出来的（`importanceGrade`），低档与未分级不在这里出现；
 * - **失败不重试**：`auto` 路径碰上失败标记就停（重试属于读者的动作），否则每个周期都重烧一次；
 * - **有上限**：一轮最多 `batchSize` 条，排 10 分钟一次——月度高档事件十几条，几轮就追平。
 */
export const CALENDAR_EVENT_INTERPRETATION_JOB_ID = 'market-intelligence.calendar-event-interpretation'

export const CALENDAR_EVENT_INTERPRETATION_INTERVAL_MS = 10 * 60_000

export function calendarEventInterpretationDefinition(): Readonly<Record<string, unknown>> {
  return {
    id: CALENDAR_EVENT_INTERPRETATION_JOB_ID,
    owner: 'product' as const,
    productId: 'market-intelligence',
    handlerId: CALENDAR_EVENT_INTERPRETATION_JOB_ID,
    // 作业名必须双语：运行日志与定时任务页直接显示它。
    title: { 'zh-CN': '日历高档事件解读补生成', 'en-US': 'Calendar high-tier interpretation backfill' },
    audience: 'internal' as const,
    trigger: { kind: 'interval' as const, intervalMs: CALENDAR_EVENT_INTERPRETATION_INTERVAL_MS, anchor: 'lastComplete' as const },
    payload: {}
  }
}

export type CalendarInterpretationBackfillDeps = Readonly<{
  repository: Pick<MacroCalendarRepository, 'listEffectiveMonthAsOf'>
  interpretation: Pick<MacroCalendarInterpretationService, 'read' | 'backfill'>
  now?: () => string
  readLocale: () => Promise<'zh-CN' | 'en-US'>
  /** 一轮最多生成几条：给模型调用留余量，也让作业时长可控。 */
  batchSize?: number
  log?: (line: Readonly<{ marker: string; generated: number; skipped: number; candidates: number }>) => void
}>

export type CalendarInterpretationBackfillReport = Readonly<{
  candidates: number
  generated: number
  skipped: number
}>

const defaultBatchSize = 3
const monthLimit = 40

export function registerCalendarEventInterpretationBackfill(
  jobRuntime: Pick<JobRuntime, 'registerHandler' | 'setSchedule'>,
  deps: CalendarInterpretationBackfillDeps
): Readonly<{ runOnce: () => Promise<CalendarInterpretationBackfillReport> }> {
  const runOnce = async (): Promise<CalendarInterpretationBackfillReport> => {
    const now = deps.now?.() ?? new Date().toISOString()
    const locale = await deps.readLocale()
    const candidates = highTierCandidates(deps, now)
    let generated = 0
    let skipped = 0
    for (const eventKey of candidates.slice(0, deps.batchSize ?? defaultBatchSize)) {
      try {
        // 先读：已经有这一份数据的解读就不再花调用（作业每轮都会重看同一批）。
        if (deps.interpretation.read({ eventKey, locale }).state === 'ready') { skipped += 1; continue }
        const result = await deps.interpretation.backfill({ eventKey, locale })
        if (result.state === 'ready') generated += 1
        else skipped += 1
      } catch {
        // 单条失败不拖垮整轮；它会在下一轮再看一次（失败标记由生成器落，`auto` 不重试模型调用）。
        skipped += 1
      }
    }
    deps.log?.({ marker: 'MI_CALENDAR_INTERPRETATION_BACKFILL', generated, skipped, candidates: candidates.length })
    return { candidates: candidates.length, generated, skipped }
  }

  jobRuntime.registerHandler(CALENDAR_EVENT_INTERPRETATION_JOB_ID, async () => { await runOnce() })
  jobRuntime.setSchedule(calendarEventInterpretationDefinition() as never)
  return { runOnce }
}

/** 当前月与上一个月里「已发布、有实际值、判成高档」的事件身份（去重后按发布日升序）。 */
function highTierCandidates(deps: CalendarInterpretationBackfillDeps, now: string): readonly string[] {
  const anchor = new Date(now)
  const months: Array<Readonly<{ monthStart: string; monthEndExclusive: string }>> = []
  for (let offset = 1; offset >= 0; offset -= 1) {
    const start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - offset, 1))
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1))
    months.push({ monthStart: start.toISOString().slice(0, 10), monthEndExclusive: end.toISOString().slice(0, 10) })
  }
  const byKey = new Map<string, string>()
  for (const month of months) {
    for (const revision of deps.repository.listEffectiveMonthAsOf({ ...month, asOf: now, limit: monthLimit })) {
      if (revision.importanceGrade !== 'high') continue
      if (revision.lifecycleState !== 'released' || revision.actual === undefined) continue
      byKey.set(revision.eventKey, revision.scheduledDate)
    }
  }
  return [...byKey.entries()].sort((left, right) => left[1].localeCompare(right[1])).map(([eventKey]) => eventKey)
}