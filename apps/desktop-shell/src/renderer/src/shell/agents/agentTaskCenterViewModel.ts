import type { AgentSessionWorkspaceSource } from '@platform/ai/agent-platform/schemas/workspaceSchemas'
import type { AgentSessionEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import type {
  CreateTaskDto,
  ScheduledTaskEntity,
  TaskRunLogEntity,
  Trigger,
  UpdateTaskDto
} from '@platform/ai/agent-platform/schemas/taskSchemas'
import type { JobRunQuery, JobRunRecord } from '@platform/jobs'

import type { AgentText } from './agentText'

export type AgentTaskDraft = {
  expectedRevision: number | null
  name: string
  prompt: string
  triggerKind: Trigger['kind']
  intervalMinutes: number
  onceAt: string
  cronExpr: string
  timezone: string
  timeoutMinutes: number
  workspace: AgentSessionWorkspaceSource
  channelIds: string[]
  enabled: boolean
}

export type AgentTaskDraftError =
  | 'name-required'
  | 'prompt-required'
  | 'interval-invalid'
  | 'once-at-invalid'
  | 'cron-required'
  | 'timeout-invalid'

export type AgentTaskRuntimeStatus = TaskRunLogEntity['status'] | 'idle'

export type AgentTaskCenterItem = {
  task: ScheduledTaskEntity
  triggerLabel: string
  latestRunLogId: string | null
  latestJobRunId: string | null
  latestOutput: string | null
  runtimeStatus: AgentTaskRuntimeStatus
  isRunning: boolean
  isOverdue: boolean
}

export type AgentTaskCenterState = {
  items: AgentTaskCenterItem[]
  selectedTaskId: string | null
  selectedTask: ScheduledTaskEntity | null
  selectedLogs: TaskRunLogEntity[]
  selectedJobs: JobRunRecord[]
}

type BuildAgentTaskCenterStateInput = {
  tasks: readonly ScheduledTaskEntity[]
  logsByTaskId: Readonly<Record<string, readonly TaskRunLogEntity[]>>
  jobsByRunLogId: Readonly<Record<string, JobRunRecord | null | undefined>>
  labels: AgentText['taskCenter']
  selectedTaskId?: string | null
  nowIso?: string
}

export function buildDefaultAgentTaskDraft(workspace: AgentSessionWorkspaceSource): AgentTaskDraft {
  return {
    expectedRevision: null,
    name: '',
    prompt: '',
    triggerKind: 'interval',
    intervalMinutes: 60,
    onceAt: '',
    cronExpr: '',
    timezone: '',
    timeoutMinutes: 30,
    workspace,
    channelIds: [],
    enabled: true
  }
}

export function resolveTaskWorkspaceSource(session: Pick<AgentSessionEntity, 'workspace' | 'workspaceId'>): AgentSessionWorkspaceSource {
  if (session.workspace.type === 'system') return { type: 'system' }
  return { type: 'user', workspaceId: session.workspaceId }
}

export function buildAgentTaskDraftFromTask(task: ScheduledTaskEntity): AgentTaskDraft {
  return {
    expectedRevision: task.revision ?? 1,
    name: task.name,
    prompt: task.prompt,
    triggerKind: task.trigger.kind,
    intervalMinutes: task.trigger.kind === 'interval' ? Math.max(1, Math.round(task.trigger.ms / 60000)) : 60,
    onceAt: task.trigger.kind === 'once' ? toDatetimeLocalValue(task.trigger.at) : '',
    cronExpr: task.trigger.kind === 'cron' ? task.trigger.expr : '',
    timezone: task.trigger.kind === 'cron' ? task.trigger.timezone ?? '' : '',
    timeoutMinutes: task.timeoutMinutes,
    workspace: cloneWorkspace(task.workspace),
    channelIds: [...(task.channelIds ?? [])],
    enabled: task.enabled
  }
}

export function buildAgentTaskCenterState(input: BuildAgentTaskCenterStateInput): AgentTaskCenterState {
  const now = Date.parse(input.nowIso ?? new Date().toISOString())
  const sortedTasks = [...input.tasks].sort(compareTaskItems(input.logsByTaskId))
  const selectedTask =
    input.selectedTaskId === null
      ? null
      : sortedTasks.find((task) => task.id === input.selectedTaskId) ?? sortedTasks[0] ?? null
  const selectedLogs = selectedTask ? sortLogs(input.logsByTaskId[selectedTask.id] ?? []) : []
  const selectedJobs = selectedLogs
    .map((log) => input.jobsByRunLogId[log.id])
    .filter((job): job is JobRunRecord => Boolean(job))

  return {
    items: sortedTasks.map((task) => {
      const latestLog = sortLogs(input.logsByTaskId[task.id] ?? [])[0] ?? null
      const latestJob = latestLog ? input.jobsByRunLogId[latestLog.id] ?? null : null
      const runtimeStatus = latestLog?.status ?? 'idle'
      return {
        task,
        triggerLabel: formatTaskTrigger(task.trigger, input.labels),
        latestRunLogId: latestLog?.id ?? null,
        latestJobRunId: latestJob?.id ?? null,
        latestOutput:
          latestJob?.progress?.message?.trim() ||
          latestLog?.resultPreview?.trim() ||
          latestLog?.result?.trim() ||
          latestLog?.error?.trim() ||
          null,
        runtimeStatus,
        isRunning:
          runtimeStatus === 'queued' ||
          runtimeStatus === 'running' ||
          latestJob?.status === 'running' ||
          latestJob?.status === 'queued',
        isOverdue: Boolean(
          task.enabled && task.nextRun && Date.parse(task.nextRun) <= now && runtimeStatus !== 'queued' && runtimeStatus !== 'running'
        )
      }
    }),
    selectedTaskId: selectedTask?.id ?? null,
    selectedTask,
    selectedLogs,
    selectedJobs
  }
}

export function buildCreateTaskDtoFromDraft(
  draft: AgentTaskDraft
): { ok: true; dto: CreateTaskDto } | { ok: false; reason: AgentTaskDraftError } {
  const base = buildTaskDtoBase(draft)
  if (!base.ok) return base
  return {
    ok: true,
    dto: base.dto
  }
}

export function buildUpdateTaskDtoFromDraft(
  draft: AgentTaskDraft
): { ok: true; dto: UpdateTaskDto } | { ok: false; reason: AgentTaskDraftError } {
  const base = buildTaskDtoBase(draft)
  if (!base.ok) return base
  return {
    ok: true,
    dto: {
      ...base.dto,
      enabled: draft.enabled
    }
  }
}

export function buildUpdateTaskRequestFromDraft(
  draft: AgentTaskDraft
):
  | { ok: true; request: { expectedRevision: number; patch: UpdateTaskDto } }
  | { ok: false; reason: AgentTaskDraftError | 'revision-required' } {
  const result = buildUpdateTaskDtoFromDraft(draft)
  if (!result.ok) return result
  if (draft.expectedRevision === null) return { ok: false, reason: 'revision-required' }
  return {
    ok: true,
    request: {
      expectedRevision: draft.expectedRevision,
      patch: result.dto
    }
  }
}

export function buildTaskJobQuery(runLogId: string): JobRunQuery {
  return {
    owner: 'platform',
    handlerId: 'platform.agent.task.run',
    payload: { runLogId },
    limit: 1
  }
}

export function buildTaskDeliveryAttemptRequest(
  logs: readonly TaskRunLogEntity[],
  selectedRunLogId: string | null,
  offset: number
): { runLogId: string; offset: number } | null {
  const selected = logs.find((log) => log.id === selectedRunLogId) ?? logs[0]
  if (!selected) return null
  return { runLogId: selected.id, offset: Math.max(0, Math.trunc(offset)) }
}

export function mergeTaskDeliveryRun(
  logs: readonly TaskRunLogEntity[],
  refreshedRun: TaskRunLogEntity
): { logs: TaskRunLogEntity[]; selectedRunLogId: string | null } {
  const hasRun = logs.some((log) => log.id === refreshedRun.id)
  return {
    logs: logs.map((log) => log.id === refreshedRun.id ? refreshedRun : log),
    selectedRunLogId: hasRun ? refreshedRun.id : null
  }
}

export function buildTaskRunRefreshQuery(
  logs: readonly TaskRunLogEntity[],
  runLogId: string
): { limit: 1; offset: number } | null {
  const offset = logs.findIndex((log) => log.id === runLogId)
  return offset < 0 ? null : { limit: 1, offset }
}

export function formatTaskTrigger(trigger: Trigger, labels: AgentText['taskCenter']): string {
  if (trigger.kind === 'once') return labels.triggerOnceSummary(formatDateTime(new Date(trigger.at).toISOString()))
  if (trigger.kind === 'cron') {
    const timezone = trigger.timezone?.trim()
    return labels.triggerCronSummary(trigger.expr, timezone || undefined)
  }

  return labels.triggerIntervalSummary(formatDuration(trigger.ms))
}

export function formatDateTime(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const timestamp = typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(timestamp)) return ''
  return new Date(timestamp).toISOString().slice(0, 16).replace('T', ' ')
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0m'
  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return `${minutes}m`
  const hours = minutes / 60
  if (Number.isInteger(hours)) return `${hours}h`
  return `${Math.round(hours * 10) / 10}h`
}

function buildTaskDtoBase(
  draft: AgentTaskDraft
): { ok: true; dto: CreateTaskDto } | { ok: false; reason: AgentTaskDraftError } {
  const name = draft.name.trim()
  if (!name) return { ok: false, reason: 'name-required' }
  const prompt = draft.prompt.trim()
  if (!prompt) return { ok: false, reason: 'prompt-required' }
  if (!Number.isFinite(draft.timeoutMinutes) || draft.timeoutMinutes <= 0) {
    return { ok: false, reason: 'timeout-invalid' }
  }

  const trigger = buildTaskTriggerFromDraft(draft)
  if (!trigger.ok) return trigger

  return {
    ok: true,
    dto: {
      name,
      prompt,
      trigger: trigger.trigger,
      catchUpPolicy: { kind: 'skip-missed' },
      workspace: cloneWorkspace(draft.workspace),
      timeoutMinutes: Math.max(1, Math.round(draft.timeoutMinutes)),
      channelIds: dedupeNonEmpty(draft.channelIds)
    }
  }
}

export function buildTaskTriggerFromDraft(
  draft: AgentTaskDraft
): { ok: true; trigger: Trigger } | { ok: false; reason: AgentTaskDraftError } {
  if (draft.triggerKind === 'interval') {
    if (!Number.isFinite(draft.intervalMinutes) || draft.intervalMinutes <= 0) {
      return { ok: false, reason: 'interval-invalid' }
    }
    return {
      ok: true,
      trigger: {
        kind: 'interval',
        ms: Math.max(1, Math.round(draft.intervalMinutes)) * 60000,
        anchor: 'lastRun'
      }
    }
  }

  if (draft.triggerKind === 'once') {
    const timestamp = Date.parse(draft.onceAt)
    if (!Number.isFinite(timestamp)) return { ok: false, reason: 'once-at-invalid' }
    return { ok: true, trigger: { kind: 'once', at: timestamp } }
  }

  const expr = draft.cronExpr.trim()
  if (!expr) return { ok: false, reason: 'cron-required' }
  return {
    ok: true,
    trigger: {
      kind: 'cron',
      expr,
      ...(draft.timezone.trim() ? { timezone: draft.timezone.trim() } : {})
    }
  }
}

function compareTaskItems(logsByTaskId: Readonly<Record<string, readonly TaskRunLogEntity[]>>) {
  return (left: ScheduledTaskEntity, right: ScheduledTaskEntity): number => {
    const leftRunning = sortLogs(logsByTaskId[left.id] ?? [])[0]?.status === 'running'
    const rightRunning = sortLogs(logsByTaskId[right.id] ?? [])[0]?.status === 'running'
    if (leftRunning !== rightRunning) return leftRunning ? -1 : 1
    const leftNext = left.nextRun ? Date.parse(left.nextRun) : Number.POSITIVE_INFINITY
    const rightNext = right.nextRun ? Date.parse(right.nextRun) : Number.POSITIVE_INFINITY
    if (leftNext !== rightNext) return leftNext - rightNext
    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || left.id.localeCompare(right.id)
  }
}

function sortLogs(logs: readonly TaskRunLogEntity[]): TaskRunLogEntity[] {
  return [...logs].sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt) || left.id.localeCompare(right.id))
}

function cloneWorkspace(workspace: AgentSessionWorkspaceSource): AgentSessionWorkspaceSource {
  return workspace.type === 'user' ? { type: 'user', workspaceId: workspace.workspaceId } : { type: 'system' }
}

function dedupeNonEmpty(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function toDatetimeLocalValue(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return ''
  return new Date(timestamp).toISOString().slice(0, 16)
}
