import type { DatabaseSync } from 'node:sqlite'
import type { JobRuntime } from '@platform/jobs'

import {
  auditCalendarIntegrity,
  calendarIntegrityGaps,
  type CalendarIntegrityCounts
} from './marketCalendarIntegrityAudit'

/**
 * **日历数据一致性巡检**（用户 2026-11-19 定）：每天跑一次五项扫描，任一不为 0 就报出来。
 *
 * 为什么要有它：这几轮清掉的每一类存量（标着有值其实没数 496 行、同期重复 84 组、
 * 期次没解开 975 行）都是「长出来很久才被发现」。清完不挂检查，等于等它再长一遍。
 *
 * 三条规矩与其它作业相同：
 * - 一条定义一个能力（`audience: 'internal'`：一致性巡检是维护作业，不进读者那张定时任务表），开关由 `@platform/jobs` 的排程承担，不留常驻作业靠 handler 过滤；
 * - handler **只读、零网络**，不改数据、不重新排自己；
 * - 读不到（库被锁、表被删）时**不抛**：巡检失败不该把作业记录写成一次崩溃，留一条日志就够。
 */
export const CALENDAR_INTEGRITY_JOB_ID = 'market-intelligence.calendar-integrity-audit'

/** 一天一次：这些缺口是存量性质，按小时扫不会更早发现，只会刷日志。 */
export const CALENDAR_INTEGRITY_INTERVAL_MS = 24 * 60 * 60_000

export function calendarIntegrityDefinition(): Readonly<Record<string, unknown>> {
  return {
    id: CALENDAR_INTEGRITY_JOB_ID,
    owner: 'product' as const,
    productId: 'market-intelligence',
    handlerId: CALENDAR_INTEGRITY_JOB_ID,
    title: { 'zh-CN': '日历数据一致性巡检', 'en-US': 'Calendar data integrity check' },
    audience: 'internal' as const,
    trigger: { kind: 'interval' as const, intervalMs: CALENDAR_INTEGRITY_INTERVAL_MS, anchor: 'lastComplete' as const },
    payload: {}
  }
}

export type CalendarIntegrityJobReport =
  | Readonly<{ state: 'audited'; counts: CalendarIntegrityCounts; gaps: readonly string[] }>
  | Readonly<{ state: 'unreadable'; message: string }>

export type CalendarIntegrityJobDeps = Readonly<{
  database: DatabaseSync
  /** 判「发布日已过」的今天；测试可注入。 */
  today?: () => string
  log?: (line: Readonly<{ marker: string } & CalendarIntegrityJobReport>) => void
  /**
   * 注册成功的**一行启动日志**（用户 2026-11-19 要求）：不靠主进程 IPC，也能在 `app.log` 里
   * 验证「巡检作业真的排上了」。只报一次，跑完的那次巡检不走这里。
   */
  announce?: (message: string) => void
}>

export function registerCalendarIntegrityJob(
  jobRuntime: Pick<JobRuntime, 'registerHandler' | 'setSchedule' | 'removeSchedule'>,
  deps: CalendarIntegrityJobDeps
): Readonly<{ runOnce: () => CalendarIntegrityJobReport }> {
  const runOnce = (): CalendarIntegrityJobReport => {
    try {
      const today = deps.today?.() ?? new Date().toISOString().slice(0, 10)
      const counts = auditCalendarIntegrity(deps.database, { today })
      const gaps = calendarIntegrityGaps(counts)
      const report: CalendarIntegrityJobReport = { state: 'audited', counts, gaps }
      deps.log?.({ marker: 'MI_CALENDAR_INTEGRITY', ...report })
      return report
    } catch (error) {
      // 读不到就如实说读不到：不写成「0 个缺口」（那会把读失败画成健康），也不抛给作业运行时。
      const report: CalendarIntegrityJobReport = {
        state: 'unreadable',
        message: (error as Error)?.message ?? 'unknown'
      }
      deps.log?.({ marker: 'MI_CALENDAR_INTEGRITY', ...report })
      return report
    }
  }

  jobRuntime.registerHandler(CALENDAR_INTEGRITY_JOB_ID, async () => { runOnce() })
  jobRuntime.setSchedule(calendarIntegrityDefinition() as never)
  deps.announce?.(`[macro-calendar] 巡检作业已注册 id=${CALENDAR_INTEGRITY_JOB_ID}`
    + ` 频率=每日（间隔 ${CALENDAR_INTEGRITY_INTERVAL_MS / 60_000} 分钟）`)
  return { runOnce }
}
