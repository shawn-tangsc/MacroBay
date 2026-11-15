import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'

import { scheduleHistoricalValueFill } from '../../wiring/calendarStandardRows'
import { createMacroCalendarScheduleJobRuntime, macroCalendarScheduleJobPolicy } from './macroCalendarScheduleJobRuntime'
import { ensureCalendarStandardTables, upsertCalendarStandardRow } from './marketCalendarStandardTable'

/**
 * 两处接线的**顺序与吞错**判据（2026-11-16）。
 *
 * 这两条最容易被写「绿」但实际不生效：补值跑早了会被启动链的 `catch` 吃掉（看起来像没接线），
 * 扫描失败抛出去会把整轮采集记成失败（今晚刚为「一处失败拖垮整条链」查了几个小时）。
 */

const now = '2026-11-16T03:00:00.000Z'

const row = (metricKey: string, periodKey: string, scheduledDate: string, status: 'missing' | 'scheduled') => ({
  countryCode: 'USA', metricKey, periodKey, scheduledDate, timePrecision: 'date' as const,
  status, valuesJson: '{}', sourceProviderId: 'macro-calendar-official-replay',
  sourceEventId: `${metricKey}|${periodKey}`, parserVersion: 'v1', observedAt: now, firstSeenAt: now
})

function setupDatabase(status: 'missing' | 'scheduled' = 'missing'): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  ensureCalendarStandardTables(database)
  // 迁移标记表在生产由日历迁移建（回放/状态迁移那两个版本号写在里面）；这里按同形补上，
  // 否则 `ensureHistoricalValuesFilled` 读标记会失败，表现成「补值没生效」。
  database.exec('create table if not exists mi_macro_calendar_migrations (version integer primary key)')
  upsertCalendarStandardRow(database, row('US.CPI.NSA.YOY', '2026-10', '2026-11-10', status))
  return database
}

const readFilled = (database: DatabaseSync) =>
  database.prepare("select status, values_json from mi_calendar_events where metric_key = 'US.CPI.NSA.YOY'")
    .get() as { status: string; values_json: string }

describe('历史补值挂在启动完成信号上', () => {
  it('信号没兑现之前一次都不读；兑现之后才补，第二遍不再补', async () => {
    const database = setupDatabase()
    const asked: string[] = []
    let releaseStartup: () => void = () => undefined
    const after = new Promise<void>((resolve) => { releaseStartup = () => resolve() })
    scheduleHistoricalValueFill({
      database, after,
      readLatest: async (metricKey) => { asked.push(metricKey); return { period: '2026-10', value: '3.7' } }
    })
    // 顺序判据：信号还没兑现，读口一次都不许被碰（碰了就说明它在启动完成前跑）。
    await Promise.resolve()
    expect(asked).toEqual([])
    expect(readFilled(database).status).toBe('missing')

    releaseStartup()
    await vi.waitFor(() => expect(asked).toEqual(['US.CPI.NSA.YOY']))
    await vi.waitFor(() => expect(readFilled(database).status).toBe('published'))
    expect(JSON.parse(readFilled(database).values_json)).toEqual({ actual: '3.7' })

    // 幂等：迁移标记写过之后，再挂一次也不读、不写。
    scheduleHistoricalValueFill({ database, after: Promise.resolve(), readLatest: async () => { asked.push('again'); return undefined } })
    await Promise.resolve()
    await Promise.resolve()
    expect(asked).toEqual(['US.CPI.NSA.YOY'])
  })

  it('信号被拒或读数抛错都不外抛：启动链不因补值失败而失败', async () => {
    const database = setupDatabase()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      scheduleHistoricalValueFill({ database, after: Promise.reject(new Error('startup failed')), readLatest: async () => undefined })
      scheduleHistoricalValueFill({ database, after: Promise.resolve(), readLatest: async () => { throw new Error('fred down') } })
      await vi.waitFor(() => expect(warn.mock.calls.some(([line]) => String(line).includes('历史补值'))).toBe(true))
      // 读失败不改状态、不写值（「读不到」不是「没有」）。
      expect(readFilled(database).status).toBe('missing')
    } finally {
      warn.mockRestore()
    }
  })
})

describe('补值扫描挂在采集作业末尾', () => {
  const captureHandler = () => {
    const handlers = new Map<string, (payload: unknown, context: unknown) => Promise<void>>()
    const jobRuntime = {
      registerHandler: (id: string, handler: (payload: unknown, context: unknown) => Promise<void>) => { handlers.set(id, handler) },
      setSchedule: () => undefined,
      removeSchedule: () => undefined,
      enqueueStartup: async () => ({ id: 'run-1' }),
      enqueueDefinition: async () => ({ id: 'run-1' }),
      getRun: () => undefined
    }
    return { handlers, jobRuntime }
  }

  const context = () => ({ jobRunId: 'run-1', signal: new AbortController().signal })

  it('采集成功后才扫一次；扫描抛错只留一行 warn，作业仍然成功', async () => {
    const database = setupDatabase('scheduled')
    const { handlers, jobRuntime } = captureHandler()
    const log = vi.fn()
    const readActual = vi.fn(async (_metricKey: string, _periodKey: string) => { throw new Error('source exploded') })
    createMacroCalendarScheduleJobRuntime({
      jobRuntime: jobRuntime as never,
      profiles: { list: async () => [{ providerId: 'macro-calendar-fed', enabled: true }] } as never,
      health: {
        collectAndUpdateHealth: async () => ({
          providerId: 'macro-calendar-fed', descriptorId: 'macro-calendar-fed-schedule',
          state: 'updated' as const, healthStatus: 'healthy' as const, consecutiveFailures: 0
        })
      } as never,
      releaseValues: { database, readActual: (metricKey, periodKey) => readActual(metricKey, periodKey) as Promise<string | undefined> },
      log
    })
    const handler = handlers.get(macroCalendarScheduleJobPolicy.handlerId)
    expect(handler).toBeDefined()
    // 扫描抛错不许把作业判成失败：这里 resolve 就是判据。
    await expect(handler!({}, context())).resolves.toBeUndefined()
    expect(readActual).toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith('warn', 'macro-calendar.release-value-backfill-failed',
      expect.objectContaining({ message: 'source exploded' }))
  })

  it('采集失败的那一轮不扫：断网不能被扫描写成「这一期没有值」', async () => {
    const database = setupDatabase('scheduled')
    const { handlers, jobRuntime } = captureHandler()
    const readActual = vi.fn(async (_metricKey: string, _periodKey: string) => '3.7')
    createMacroCalendarScheduleJobRuntime({
      jobRuntime: jobRuntime as never,
      profiles: { list: async () => [{ providerId: 'macro-calendar-fed', enabled: true }] } as never,
      health: { collectAndUpdateHealth: async () => ({ state: 'failed' as const, failureCode: 'network-request-failed' }) } as never,
      releaseValues: { database, readActual }
    })
    await expect(handlers.get(macroCalendarScheduleJobPolicy.handlerId)!({}, context())).rejects.toThrow(/failed/)
    expect(readActual).not.toHaveBeenCalled()
    expect(readFilled(database).status).toBe('scheduled')
  })
})
