import type { DatabaseSync } from 'node:sqlite'

import type { JobRuntime } from '@platform/jobs'

import type { CalendarStandardWriteLayer } from '../intelligence/macro-calendar/calendarStandardWriteLayer'

import {
  createZeroXRouterCalendarScheduler,
  type ZeroXRouterCalendarAutomaticRefresh
} from '../intelligence/macro-calendar/0xrouter-calendar/zeroXRouterCalendarScheduler'
import {
  backfillStandardRowsFromObservations,
  type StandardBackfillProviderId
} from '../intelligence/macro-calendar/marketCalendarStandardBackfill'

/**
 * 0xrouter 三路日历的**调度接线**（2026-11-16）。
 *
 * 为什么需要这一笔：调度器早就写好了（每条 feed 一个作业定义、启用才注册、禁用 removeSchedule），
 * 但**全仓没有任何生产调用点**——所以「设置里打开了」不等于「有作业在跑」。真库的现场是：
 * 三路 profile 都是 enabled=true，观测表的 `last_seen_at` 却停在 2026-11-12，作业运行记录同一天断。
 *
 * 第二件事：采集只写观测表，**标准表那一段是按批转换出来的**。转换不接回采集链，作业跑起来
 * 界面也还是空的。所以 `onRefreshCompleted` 里调 `backfillStandardRowsFromObservations`
 * （幂等、按发布去重、算不出身份的落 `unmapped`）——不另写一份「怎么把观测变成行」。
 */
export type ZeroXRouterCalendarScheduleLog =
  (level: 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>) => void

export type ZeroXRouterCalendarSchedule = Readonly<{
  initialize: () => Promise<void>
  /** 读者改了开关之后对账用（启用 → 注册；禁用 → removeSchedule）。 */
  syncSchedule: () => Promise<void>
  dispose: () => void
}>

export function wireZeroXRouterCalendarSchedule(input: Readonly<{
  jobRuntime: Pick<JobRuntime, 'registerHandler' | 'setSchedule' | 'removeSchedule' | 'enqueueDefinition'>
  database: DatabaseSync
  /** 三路的批量采集入口（`marketCalendar.refreshAutomatic`）。 */
  refreshAutomatic: ZeroXRouterCalendarAutomaticRefresh['refreshAutomatic']
  /** 0xrouter 的就绪判定（开关 + 凭据），与采集链共用同一个读数口。 */
  readReadiness: () => Promise<{ enabled: boolean; hasCredential: boolean }>
  /** 当前启用的 feed（sourceId 列表）；没建过档案按开处理，与日历域既有口径一致。 */
  readEnabledFeeds: () => readonly string[] | Promise<readonly string[]>
  log?: ZeroXRouterCalendarScheduleLog
  /** 装配即对账（生产如此）；用例关掉它，自己决定何时 initialize。 */
  startImmediately?: boolean
  /** 观测表里这条腿的 provider id；生产是 0xrouter 采集写的那一个。 */
  observationProviderId?: StandardBackfillProviderId
  /** 写入层：成功/失败都记一笔（用户 2026-11-19）。 */
  writeLayer?: Pick<CalendarStandardWriteLayer, 'recordAttempt'>
}>): ZeroXRouterCalendarSchedule {
  const scheduler = createZeroXRouterCalendarScheduler({
    jobRuntime: input.jobRuntime,
    readReadiness: input.readReadiness,
    readEnabledFeeds: input.readEnabledFeeds,
    refreshAutomatic: (feeds) => input.refreshAutomatic(feeds),
    onRefreshCompleted: (items) => {
      // 全都不成功就不转：没写进观测表的一批，转了也只会把旧行原样再写一遍。
      if (!items.some((item) => item.state === 'succeeded')) return
      // 只转「这一次采集真的落了行」的那一条，其余按批函数自己的幂等重扫。
      const report = backfillStandardRowsFromObservations(input.database,
        { providerId: input.observationProviderId ?? '0xrouter',
          ...(input.writeLayer === undefined ? {} : { writeLayer: input.writeLayer }),
          log: (level, event, fields) => { input.log?.(level, event, fields) } })
      input.log?.('info', 'macro-calendar.zero-xrouter-standard-rows', {
        releases: report.releases, written: report.written,
        skippedExisting: report.skippedExisting, unmappedMissingCountry: report.unmappedMissingCountry
      })
    }
  })
  const schedule: ZeroXRouterCalendarSchedule = Object.freeze({
    async initialize(): Promise<void> {
      try {
        await scheduler.initialize()
      } catch (error) {
        // 装配失败不阻断启动：这条链占的是「日历自动刷新」，把它拖垮会连累整个产品起来。
        input.log?.('warn', 'macro-calendar.zero-xrouter-schedule-failed', {
          message: error instanceof Error ? error.message : String(error)
        })
      }
    },
    async syncSchedule(): Promise<void> {
      try {
        await scheduler.syncSchedule()
      } catch (error) {
        input.log?.('warn', 'macro-calendar.zero-xrouter-sync-failed', {
          message: error instanceof Error ? error.message : String(error)
        })
      }
    },
    dispose: () => scheduler.dispose()
  })
  if (input.startImmediately !== false) void schedule.initialize()
  return schedule
}