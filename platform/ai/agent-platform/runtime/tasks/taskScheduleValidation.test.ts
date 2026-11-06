import { describe, expect, it } from 'vitest'

import type { Trigger } from '../../schemas/taskSchemas'
import {
  MAX_TASK_INTERVAL_MS,
  MIN_TASK_INTERVAL_MS,
  validateTaskTrigger,
  previewNextTaskRun,
  validateTaskSchedule,
  validateTaskTimezone
} from './taskScheduleValidation'

const nowMs = Date.UTC(2026, 0, 1, 10, 30, 20)

function cron(expr: string, timezone?: string): Trigger {
  return { kind: 'cron', expr, timezone }
}

describe('taskScheduleValidation', () => {
  it('accepts five-field Cron expressions including ranges, lists, and steps', () => {
    expect(validateTaskSchedule(cron('*/15 9-17 * 1,6 1-5'), { now: new Date(nowMs), defaultTimezone: 'UTC' })).toEqual({ ok: true })
  })

  it('rejects invalid Cron expressions using the jobs runtime grammar', () => {
    expect(validateTaskSchedule(cron('0 9 * *'), { now: new Date(nowMs), defaultTimezone: 'UTC' })).toEqual({ ok: false, code: 'task-schedule-invalid' })
    expect(validateTaskSchedule(cron('61 * * * *'), { now: new Date(nowMs), defaultTimezone: 'UTC' })).toEqual({ ok: false, code: 'task-schedule-invalid' })
    expect(validateTaskSchedule(cron('*/0 * * * *'), { now: new Date(nowMs), defaultTimezone: 'UTC' })).toEqual({ ok: false, code: 'task-schedule-invalid' })
  })

  it('validates IANA timezones separately from Cron grammar', () => {
    expect(validateTaskTimezone('Asia/Shanghai')).toEqual({ ok: true })
    expect(validateTaskTimezone('Mars/Olympus')).toEqual({ ok: false, code: 'task-timezone-invalid' })
    expect(validateTaskSchedule(cron('0 9 * * *', 'Mars/Olympus'), { now: new Date(nowMs), defaultTimezone: 'UTC' })).toEqual({
      ok: false,
      code: 'task-timezone-invalid'
    })
  })

  it('requires a future one-time schedule and a bounded recurring interval', () => {
    expect(validateTaskSchedule({ kind: 'once', at: nowMs }, { now: new Date(nowMs), defaultTimezone: 'UTC' })).toEqual({
      ok: false,
      code: 'task-schedule-invalid'
    })
    expect(validateTaskSchedule({ kind: 'once', at: nowMs + 1 }, { now: new Date(nowMs), defaultTimezone: 'UTC' })).toEqual({ ok: true })
    expect(validateTaskSchedule({ kind: 'interval', ms: MIN_TASK_INTERVAL_MS - 1 }, { now: new Date(nowMs), defaultTimezone: 'UTC' })).toEqual({
      ok: false,
      code: 'task-schedule-invalid'
    })
    expect(validateTaskSchedule({ kind: 'interval', ms: MIN_TASK_INTERVAL_MS }, { now: new Date(nowMs), defaultTimezone: 'UTC' })).toEqual({ ok: true })
    expect(validateTaskSchedule({ kind: 'interval', ms: MAX_TASK_INTERVAL_MS + 1 }, { now: new Date(nowMs), defaultTimezone: 'UTC' })).toEqual({
      ok: false,
      code: 'task-schedule-invalid'
    })
  })

  it('rejects one-time epochs outside the JavaScript TimeClip range', () => {
    const options = { now: new Date(nowMs), defaultTimezone: 'UTC' }
    expect(validateTaskSchedule({ kind: 'once', at: 8_640_000_000_000_000 }, options)).toEqual({ ok: true })
    for (const at of [8_640_000_000_000_001, Number.MAX_SAFE_INTEGER, Number.NaN, Infinity, nowMs + 0.5]) {
      expect(validateTaskSchedule({ kind: 'once', at }, options)).toEqual({ ok: false, code: 'task-schedule-invalid' })
    }
  })

  it('previews next runs using the runtime Cron calculation', () => {
    expect(previewNextTaskRun({ trigger: cron('0 11 * * *') }, { now: new Date(nowMs), defaultTimezone: 'UTC' })).toEqual({
      ok: true,
      nextRunAt: '2026-01-01T11:00:00.000Z'
    })
    expect(previewNextTaskRun({ trigger: { kind: 'interval', ms: MIN_TASK_INTERVAL_MS } }, { now: new Date(nowMs), defaultTimezone: 'UTC' })).toEqual({
      ok: true,
      nextRunAt: '2026-01-01T10:35:20.000Z'
    })
    expect(previewNextTaskRun({ trigger: { kind: 'once', at: nowMs + 1 } }, { now: new Date(nowMs), defaultTimezone: 'UTC' })).toEqual({
      ok: true,
      nextRunAt: '2026-01-01T10:30:20.001Z'
    })
  })

  it('applies the supplied default timezone through the shared task preview entry point', () => {
    expect(
      previewNextTaskRun(
        { trigger: cron('0 9 * * *') },
        { now: new Date(nowMs), defaultTimezone: 'Asia/Shanghai' }
      )
    ).toEqual({ ok: true, nextRunAt: '2026-01-02T01:00:00.000Z' })
  })

  it('validates and previews with the default timezone but leaves the trigger unstored-timezone untouched', () => {
    const trigger = cron('0 9 * * *')
    const options = { now: new Date(nowMs), defaultTimezone: 'Asia/Shanghai' }

    expect(validateTaskSchedule(trigger, options)).toEqual({ ok: true })
    expect(previewNextTaskRun({ trigger }, options)).toEqual({ ok: true, nextRunAt: '2026-01-02T01:00:00.000Z' })
    // 空时区 = 跟随读者设置（排程时解析）。**不再写回 trigger**：写回等于把「建任务那一刻的设置」
    // 变成任务的一部分（2026-11-05 反转，契约 task-timezone-scheduling-contract.md）。
    expect(validateTaskTrigger(trigger, options)).toEqual({
      ok: true,
      trigger: { kind: 'cron', expr: '0 9 * * *' }
    })
  })

  it('rejects an invalid default timezone and lets explicit Cron timezone override it', () => {
    expect(validateTaskSchedule(cron('0 9 * * *'), { now: new Date(nowMs), defaultTimezone: 'Mars/Olympus' })).toEqual({
      ok: false,
      code: 'task-timezone-invalid'
    })
    expect(
      previewNextTaskRun(
        { trigger: cron('0 9 * * *', 'UTC') },
        { now: new Date(nowMs), defaultTimezone: 'Mars/Olympus' }
      )
    ).toEqual({ ok: true, nextRunAt: '2026-01-02T09:00:00.000Z' })
  })
  it('normalizes a blank timezone to undefined instead of storing an empty string', () => {
    const options = { now: new Date(nowMs), defaultTimezone: 'Asia/Shanghai' }
    const blank = validateTaskTrigger({ kind: 'cron', expr: '0 9 * * *', timezone: '' }, options)
    expect(blank).toEqual({ ok: true, trigger: { kind: 'cron', expr: '0 9 * * *' } })

    const missing = validateTaskTrigger({ kind: 'cron', expr: '0 9 * * *' }, options)
    // 两种写法归一之后必须逐字相同：`''` 不是「指定了一个空时区」，是「没填」。
    expect(blank).toEqual(missing)
  })

})