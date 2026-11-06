import type {
  JobDefinition,
  JobOwner,
  JobRunQuery,
  JobRunRecord,
  JobStatus,
  JobTrigger,
  ScheduledJobDefinition
} from '../contracts/jobTypes'
import { computeNextCronRunAt } from './jobCronSchedule'

/**
 * 只读投影：把 `jobRuntime.listSchedules()` 的注册定义变成设置页可渲染的安全视图。
 *
 * 刻意排除 `payload`（可能含凭据引用/路径）、`redact`、`handlerId`、`concurrencyKey`、
 * 超时/重试等实现细节；失败只给枚举，不外传 `lastError`、日志或任何自由文本。
 * `registered` 唯一来源是 `listSchedules()`：定义出现在注册表里就是已注册，
 * 绝不由任何 enable 开关推断（AGENTS.md Job Runtime 规则）。
 */
export type JobScheduleTriggerView =
  | { kind: 'manual' }
  | { kind: 'startup' }
  | { kind: 'interval'; intervalMs: number; anchor: 'lastStart' | 'lastComplete' }
  | { kind: 'cron'; expression: string; timezone: string | null }
  | { kind: 'event'; topic: string }

/** 最近一次运行的粗粒度结果；`never` 表示还没有终态结果（从未运行或仍在运行）。 */
import type { JobTitle, JobTitleParams } from './jobTitle'

export type JobScheduleLastOutcome = 'success' | 'failed' | 'skipped' | 'never'

export type JobScheduleView = {
  id: string
  title: JobTitle
  titleParams?: JobTitleParams
  owner: JobOwner
  productId: string | null
  trigger: JobScheduleTriggerView
  registered: boolean
  nextRunAt: string | null
  lastRunAt: string | null
  lastOutcome: JobScheduleLastOutcome
  lastRunStatus: JobStatus | null
  lastDurationMs: number | null
  /**
   * 预留：脱敏后的失败摘要。当前恒为 null —— 平台还没有 definition 级脱敏器，
   * 原始 `lastError`/日志一律不跨 IPC。
   */
  lastErrorSummary: string | null
}

export type JobScheduleSource = {
  listSchedules: () => readonly ScheduledJobDefinition[]
  /** 需要按 `definitionId` 过滤，并按最近优先返回（`jobRuntime.listRuns` 的契约）。 */
  listRuns: (query?: JobRunQuery) => JobRunRecord[]
}

export function projectJobSchedules(
  source: JobScheduleSource,
  options: { now?: Date } = {}
): JobScheduleView[] {
  const nowMs = (options.now ?? new Date()).getTime()
  // 保持注册顺序：投影不重排、不合并，页面看到的就是注册表顺序。
  //
  // 只投影 `resource`：`internal` 是平台自己维护的活（保留期清理、投递重试、状态巡检），用户
  // 既配置不了也停不了。它们仍在运行，运行记录也照旧可查，只是不进这张"用户能理解的任务"表。
  //
  // 投影保持两档，不加第三档诊断、也不在界面上说「还有 N 条内部任务」：`visibility` 在注册口必填，
  // `assertAudience` 再兜一层，到达这里的定义非 `resource` 即 `internal`，第三种状态不可达。
  // 给不可达状态写分支只会写死代码并留下一条假防线。
  return source
    .listSchedules()
    .filter((definition) => definition.audience === 'user')
    .map((definition) => projectJobSchedule(definition, latestRun(source, definition.id), nowMs))
}

function projectJobSchedule(
  definition: JobDefinition,
  lastRun: JobRunRecord | null,
  nowMs: number
): JobScheduleView {
  const startedAt = lastRun?.startedAt ?? null
  const completedAt = lastRun?.completedAt ?? null
  const startedMs = startedAt ? Date.parse(startedAt) : Number.NaN
  const completedMs = completedAt ? Date.parse(completedAt) : Number.NaN

  return {
    id: definition.id,
    title: definition.title,
    ...(definition.titleParams === undefined ? {} : { titleParams: definition.titleParams }),
    owner: definition.owner,
    productId: definition.productId ?? null,
    trigger: projectTrigger(definition.trigger),
    registered: true,
    nextRunAt: projectNextRunAt(definition.trigger, startedAt, completedAt, nowMs),
    lastRunAt: completedAt ?? startedAt ?? lastRun?.createdAt ?? null,
    lastOutcome: projectLastOutcome(lastRun?.status),
    lastRunStatus: lastRun?.status ?? null,
    lastDurationMs: Number.isFinite(startedMs) && Number.isFinite(completedMs)
      ? Math.max(0, completedMs - startedMs)
      : null,
    lastErrorSummary: null
  }
}

function projectTrigger(trigger: JobTrigger): JobScheduleTriggerView {
  if (trigger.kind === 'interval') {
    return { kind: 'interval', intervalMs: trigger.intervalMs, anchor: trigger.anchor }
  }
  if (trigger.kind === 'cron') {
    return { kind: 'cron', expression: trigger.expression, timezone: trigger.timezone ?? null }
  }
  if (trigger.kind === 'event') {
    return { kind: 'event', topic: trigger.topic }
  }
  return { kind: trigger.kind }
}

function projectNextRunAt(
  trigger: JobTrigger,
  startedAt: string | null,
  completedAt: string | null,
  nowMs: number
): string | null {
  if (trigger.kind === 'cron') {
    const nextMs = computeNextCronRunAt(trigger.expression, trigger.timezone, nowMs)
    return nextMs === null ? null : new Date(nextMs).toISOString()
  }
  if (trigger.kind === 'interval') {
    // 与 jobScheduler 的重挂语义一致：lastComplete 从上次完成时刻重挂；
    // lastStart 的定时器从注册时刻按固定节拍触发，这里用上次开始时刻作锚点。
    const anchorIso = trigger.anchor === 'lastComplete' ? completedAt : startedAt
    const anchorMs = anchorIso ? Date.parse(anchorIso) : Number.NaN
    if (!Number.isFinite(anchorMs)) return null
    return new Date(anchorMs + trigger.intervalMs).toISOString()
  }
  // manual / startup / event 没有可推导的下次运行时刻。
  return null
}

function projectLastOutcome(status: JobStatus | undefined): JobScheduleLastOutcome {
  if (status === 'completed') return 'success'
  if (status === 'failed') return 'failed'
  if (status === 'cancelled') return 'skipped'
  // queued / running 还没有终态结果；`never` 语义是「尚无结果」，不是「从未进入调度」。
  return 'never'
}

function latestRun(source: JobScheduleSource, definitionId: string): JobRunRecord | null {
  // `newestFirst` is mandatory here, not cosmetic: run ids are `run-sqlite-<sequence>` and the
  // default order compares that text, so once the shared sequence passes 9999 the newest row sorts
  // below `…-9999` and this projection silently reports a week-old run as "last run". The settings
  // page shows this field, so the time order has to come from `created_at`.
  return source.listRuns({ definitionId, limit: 1, newestFirst: true })[0] ?? null
}
