import { DatabaseSync } from 'node:sqlite'
import type { JobRuntime } from '@platform/jobs'
import { describe, expect, it } from 'vitest'

import {
  CALENDAR_INTEGRITY_JOB_ID,
  calendarIntegrityDefinition,
  registerCalendarIntegrityJob
} from './marketCalendarIntegrityJob'
import { ensureCalendarStandardTables } from './marketCalendarStandardTable'

/** 巡检作业：注册即排上、只读、读不到不抛（用户 2026-11-19 定）。 */
const now = '2026-11-19T03:00:00.000Z'

function setup(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  ensureCalendarStandardTables(database)
  return database
}

function seedPresentWithoutActual(database: DatabaseSync): void {
  database.prepare(`insert into mi_calendar_events
    (country_code, metric_key, period_key, scheduled_date, first_scheduled_date, time_precision,
     status, identity_kind, value_state, values_json, source_provider_id, source_event_id,
     parser_version, observed_at, first_seen_at, release_count)
    values ('US', 'US.TEST.NONE.LEVEL', '2026-10', '2026-11-01', '2026-11-01', 'date',
      'published', 'code', 'present', '{"previous":"1.0"}', 'test', 'x', 'v1', ?, ?, 1)`)
    .run(now, now)
}

type JobRuntimeSeam = Pick<JobRuntime, 'registerHandler' | 'setSchedule' | 'removeSchedule'>

function fakeRuntime(): {
  runtime: JobRuntimeSeam
  handlers: Map<string, () => Promise<void>>
  schedules: Map<string, unknown>
} {
  const handlers = new Map<string, () => Promise<void>>()
  const schedules = new Map<string, unknown>()
  return {
    handlers,
    schedules,
    runtime: {
      registerHandler: ((id: string, handler: () => Promise<void>) => { handlers.set(id, handler) }) as never,
      setSchedule: ((definition: { id: string }) => { schedules.set(definition.id, definition) }) as never,
      removeSchedule: ((id: string) => { schedules.delete(id) }) as never
    }
  }
}

describe('日历数据一致性巡检作业', () => {
  it('注册即排上：definition 与 handler 同一个 id，一天一次', () => {
    const { runtime, handlers, schedules } = fakeRuntime()
    const announced: string[] = []
    registerCalendarIntegrityJob(runtime, {
      database: setup(), today: () => '2026-11-19', announce: (message) => { announced.push(message) }
    })
    // 启动日志是唯一的「不靠 IPC」验证口：必须带 id 和频率。
    expect(announced).toHaveLength(1)
    expect(announced[0]).toContain(`id=${CALENDAR_INTEGRITY_JOB_ID}`)
    expect(announced[0]).toContain('每日')
    expect(schedules.get(CALENDAR_INTEGRITY_JOB_ID)).toEqual(calendarIntegrityDefinition())
    expect(handlers.has(CALENDAR_INTEGRITY_JOB_ID)).toBe(true)
    expect((calendarIntegrityDefinition() as { trigger: { intervalMs: number } }).trigger.intervalMs)
      .toBe(24 * 60 * 60_000)
  })

  it('干净库：state audited、gaps 为空', () => {
    const { runtime } = fakeRuntime()
    const job = registerCalendarIntegrityJob(runtime, { database: setup(), today: () => '2026-11-19' })
    const report = job.runOnce()
    expect(report.state).toBe('audited')
    expect(report.state === 'audited' ? report.gaps : null).toEqual([])
  })

  it('有缺口就把⑤项里的那一项报出来（不是只报「有异常」）', () => {
    const database = setup()
    seedPresentWithoutActual(database)
    const { runtime } = fakeRuntime()
    const job = registerCalendarIntegrityJob(runtime, { database, today: () => '2026-11-19' })
    const report = job.runOnce()
    expect(report.state === 'audited' ? report.counts.presentWithoutActual : -1).toBe(1)
    expect(report.state === 'audited' ? report.gaps : []).toEqual(['present-without-actual=1'])
  })

  it('读不到库：返回 unreadable、不抛给作业运行时（也不把读失败写成 0 个缺口）', async () => {
    const database = setup()
    database.exec('drop table mi_calendar_events')
    const { runtime, handlers } = fakeRuntime()
    const job = registerCalendarIntegrityJob(runtime, { database, today: () => '2026-11-19' })
    expect(job.runOnce().state).toBe('unreadable')
    // handler 是作业运行时真正调用的那一层：它也不许抛。
    await expect(handlers.get(CALENDAR_INTEGRITY_JOB_ID)!()).resolves.toBeUndefined()
  })
})
