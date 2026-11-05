import type { ScheduledTaskEntity } from '../../schemas/taskSchemas'
import { computeNextCronRunAt } from '../../../../jobs'

/**
 * 排程的纯时间计算：把「一次任务下一次该在什么时刻跑」算出来，不碰状态、不读设置。
 *
 * 从 `taskSchedulerPlanner` 抽出来的原因只有两个：那个文件已经贴着 500 行上限，而这一组函数
 * 只依赖触发器与读者时区、可以单独读、单独测。**读者时区由调用方解析后传入**——这里绝不回落到
 * `'UTC'`，空值表示「跟随读者设置」，由引擎侧按既有规则处理（契约
 * `docs-private/10-development/task-timezone-scheduling-contract.md` §2.1）。
 */

export function computeNextRunAt(
  task: ScheduledTaskEntity,
  lastRunAt: string | null,
  readerTimeZone: string | undefined
): string | null {
  if (!task.enabled || task.status !== 'active') {
    return task.nextRun ?? computeIntrinsicNextRunAt(task, lastRunAt, readerTimeZone)
  }

  return task.nextRun ?? computeIntrinsicNextRunAt(task, lastRunAt, readerTimeZone)
}

export function computeIntrinsicNextRunAt(
  task: ScheduledTaskEntity,
  lastRunAt: string | null,
  readerTimeZone: string | undefined
): string | null {
  switch (task.trigger.kind) {
    case 'once':
      return lastRunAt ? null : toSafeIso(task.trigger.at)
    case 'interval': {
      const anchor = task.trigger.anchor ?? 'createdAt'
      const anchorIso = anchor === 'lastRun' ? lastRunAt ?? task.createdAt : lastRunAt ?? task.createdAt
      return toSafeIso(Date.parse(anchorIso) + task.trigger.ms)
    }
    case 'cron':
      return computeCronRunAtOrBefore(task.trigger.expr, cronTimeZone(task.trigger, readerTimeZone), task.createdAt, lastRunAt)
    default:
      return null
  }
}

function toSafeIso(value: number): string | null {
  if (!Number.isFinite(value) || !Number.isSafeInteger(value) || Math.abs(value) > 8_640_000_000_000_000) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

export function isLegacyTriggerValid(
  trigger: ScheduledTaskEntity['trigger'],
  nowMs: number,
  readerTimeZone: string | undefined
): boolean {
  if (trigger.kind === 'once') return Number.isSafeInteger(trigger.at) && Math.abs(trigger.at) <= 8_640_000_000_000_000
  if (trigger.kind === 'interval') return Number.isSafeInteger(trigger.ms) && trigger.ms > 0 && trigger.ms <= 31 * 24 * 60 * 60 * 1000
  try { return computeNextCronRunAt(trigger.expr, cronTimeZone(trigger, readerTimeZone), nowMs) !== null } catch { return false }
}

export function computeCronRunAtOrBefore(
  expr: string,
  timezone: string | undefined,
  createdAt: string,
  lastRunAt: string | null
): string | null {
  const searchStart = lastRunAt ? Date.parse(lastRunAt) + 60_000 : Date.parse(createdAt)
  const match = computeNextCronRunAt(expr, timezone, searchStart)
  return match ? new Date(match).toISOString() : null
}

export function advanceToFutureRun(
  task: Pick<ScheduledTaskEntity, 'trigger' | 'createdAt'>,
  overdueRunMs: number,
  nowMs: number,
  readerTimeZone: string | undefined
): string | null {
  switch (task.trigger.kind) {
    case 'interval': {
      if (!(task.trigger.ms > 0)) return toSafeIso(overdueRunMs)
      let nextRunMs = overdueRunMs
      while (nextRunMs <= nowMs) {
        nextRunMs += task.trigger.ms
      }
      return toSafeIso(nextRunMs)
    }
    case 'cron': {
      const match = computeNextCronRunAt(task.trigger.expr, cronTimeZone(task.trigger, readerTimeZone), nowMs + 1)
      return match ? new Date(match).toISOString() : null
    }
    case 'once':
      return null
    default:
      return null
  }
}

/**
 * 排程时解析 cron 时区：显式指定过就用它，否则跟随读者当前设置。
 *
 * **不要在这里兜底成 `'UTC'`**：空 = 「跟随读者」，兜成 UTC 会让「每天 08:00」在没人看的时候
 * 按格林威治时间跑，而且界面上看不出来（契约 `task-timezone-scheduling-contract.md` §2.1）。
 * 引擎侧对 undefined 的处理是既有的（`jobCronSchedule.ts` 无时区按 UTC），那是另一处待收口的立项。
 */
export function cronTimeZone(
  trigger: Extract<ScheduledTaskEntity['trigger'], { kind: 'cron' }>,
  readerTimeZone: string | undefined
): string | undefined {
  // 用 `??` 会把 `''` 当成"显式指定过"，于是引擎按 UTC 跑，而界面照旧显示「每天 08:00」。
  return normalizeCronTimeZone(trigger.timezone) ?? normalizeCronTimeZone(readerTimeZone)
}

/**
 * 「空」在这个字段上有两种写法：`undefined`（从来没填）和 `''`（表单清空、工具传空串）。
 * 它们必须是同一件事——**跟随读者设置**，不是「指定了一个叫空字符串的时区」。
 *
 * 所以归一放在一处：先掐空白，空即 `undefined`。别在各处写 `x || y` 或 `x ?? y` 反复判断，
 * 那种写法对 `''` 的答案不同（`||` 当没写、`??` 当写了），而这个区别会一路走到引擎按 UTC 跑。
 */
export function normalizeCronTimeZone(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}
