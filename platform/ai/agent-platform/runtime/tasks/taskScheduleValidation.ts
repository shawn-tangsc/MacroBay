import type { ScheduledTaskEntity, Trigger } from '../../schemas/taskSchemas'
import { computeNextCronRunAt } from '../../../../jobs'

export const MIN_TASK_INTERVAL_MS = 5 * 60 * 1000
export const MAX_TASK_INTERVAL_MS = 31 * 24 * 60 * 60 * 1000
const MAX_DATE_TIME_VALUE = 8_640_000_000_000_000

export type TaskScheduleValidationResult = { ok: true } | { ok: false; code: 'task-schedule-invalid' | 'task-timezone-invalid' }

export type TaskSchedulePreview =
  | { ok: true; nextRunAt: string }
  | { ok: false; code: 'task-schedule-invalid' | 'task-timezone-invalid' }

export type TaskScheduleValidationOptions = {
  now: Date
  defaultTimezone: string
}

export function validateTaskTimezone(timezone: string | undefined): { ok: true } | { ok: false; code: 'task-timezone-invalid' } {
  if (!timezone) return { ok: true }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return { ok: true }
  } catch {
    return { ok: false, code: 'task-timezone-invalid' }
  }
}

export function validateTaskSchedule(trigger: Trigger, options: TaskScheduleValidationOptions): TaskScheduleValidationResult {
  const nowMs = options.now.getTime()
  switch (trigger.kind) {
    case 'once':
      return Number.isSafeInteger(trigger.at) && Math.abs(trigger.at) <= MAX_DATE_TIME_VALUE && Number.isFinite(new Date(trigger.at).getTime()) && trigger.at > nowMs
        ? { ok: true }
        : { ok: false, code: 'task-schedule-invalid' }
    case 'interval':
      return Number.isFinite(trigger.ms) && trigger.ms >= MIN_TASK_INTERVAL_MS && trigger.ms <= MAX_TASK_INTERVAL_MS
        ? { ok: true }
        : { ok: false, code: 'task-schedule-invalid' }
    case 'cron': {
      const timezone = resolveEffectiveCronTimezone(trigger, options.defaultTimezone)
      if (!timezone.ok) return timezone
      return computeNextCronRunAt(trigger.expr, timezone.timezone, nowMs) === null
        ? { ok: false, code: 'task-schedule-invalid' }
        : { ok: true }
    }
  }
}

export function previewTaskSchedule(trigger: Trigger, options: TaskScheduleValidationOptions): TaskSchedulePreview {
  const validation = validateTaskSchedule(trigger, options)
  if (!validation.ok) return validation

  switch (trigger.kind) {
    case 'once':
      return { ok: true, nextRunAt: new Date(trigger.at).toISOString() }
    case 'interval':
      return { ok: true, nextRunAt: new Date(options.now.getTime() + trigger.ms).toISOString() }
    case 'cron': {
      const timezone = resolveEffectiveCronTimezone(trigger, options.defaultTimezone)
      if (!timezone.ok) return timezone
      const nextRunAt = computeNextCronRunAt(trigger.expr, timezone.timezone, options.now.getTime())
      return nextRunAt === null
        ? { ok: false, code: 'task-schedule-invalid' }
        : { ok: true, nextRunAt: new Date(nextRunAt).toISOString() }
    }
  }
}

export function previewNextTaskRun(
  task: Pick<ScheduledTaskEntity, 'trigger'>,
  options: TaskScheduleValidationOptions
): TaskSchedulePreview {
  return previewTaskSchedule(task.trigger, options)
}

export function materializeTaskTriggerTimezone(
  trigger: Trigger,
  options: TaskScheduleValidationOptions
): { ok: true; trigger: Trigger } | { ok: false; code: 'task-schedule-invalid' | 'task-timezone-invalid' } {
  const validation = validateTaskSchedule(trigger, options)
  if (!validation.ok) return validation
  if (trigger.kind !== 'cron') return { ok: true, trigger }

  const timezone = resolveEffectiveCronTimezone(trigger, options.defaultTimezone)
  if (!timezone.ok) return timezone
  return { ok: true, trigger: { ...trigger, timezone: timezone.timezone } }
}

function resolveEffectiveCronTimezone(
  trigger: Extract<Trigger, { kind: 'cron' }>,
  defaultTimezone: string
): { ok: true; timezone: string } | { ok: false; code: 'task-timezone-invalid' } {
  const timezone = trigger.timezone || defaultTimezone
  const validation = validateTaskTimezone(timezone)
  return validation.ok ? { ok: true, timezone } : validation
}
