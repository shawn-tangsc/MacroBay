import type { ScheduledTaskEntity, Trigger } from '../schemas/taskSchemas'
import type { TaskAutomationCommandErrorCode, TaskAutomationPolicyPreset, TaskDeliveryReadiness } from '../runtime/tasks/taskAutomationContracts'
import { getTaskAutomationPolicy } from '../runtime/tasks/taskAutomationPolicy'
import { previewTaskSchedule, type TaskSchedulePreview } from '../runtime/tasks/taskScheduleValidation'
import type { AgentPlatformQueryAdapters } from './agentServiceTypes'

const MAX_PAGE_LIMIT = 100
const DEFAULT_PAGE_LIMIT = 50

export class TaskAutomationQueryError extends Error {
  constructor(readonly code: Extract<TaskAutomationCommandErrorCode, 'task-not-found' | 'task-ownership-denied' | 'task-request-invalid'>) {
    super(code)
    this.name = 'TaskAutomationQueryError'
  }
}

type Dependencies = {
  queries: AgentPlatformQueryAdapters
  getPolicyPreset: () => Promise<TaskAutomationPolicyPreset>
  setPolicyPreset: (preset: TaskAutomationPolicyPreset) => Promise<void>
  defaultTimezone?: string
  now?: () => Date
}

export class AgentTaskAutomationQueryService {
  private readonly defaultTimezone: string
  private readonly now: () => Date

  constructor(private readonly deps: Dependencies) {
    this.defaultTimezone = deps.defaultTimezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'
    this.now = deps.now ?? (() => new Date())
  }

  async previewTaskSchedule(trigger: Trigger): Promise<TaskSchedulePreview> {
    return previewTaskSchedule(trigger, { now: this.now(), defaultTimezone: this.defaultTimezone })
  }

  async listTaskPage(query: {
    agentId?: string
    status?: ScheduledTaskEntity['status']
    cursor?: string
    limit?: number
  } = {}): Promise<{ tasks: ScheduledTaskEntity[]; total: number; nextCursor?: string }> {
    const listPage = this.deps.queries.tasks?.listPage
    if (!listPage) return { tasks: [], total: 0 }
    const page = listPage({ ...query, limit: normalizeLimit(query.limit) })
    return clone(page)
  }

  async getTaskDeliveryAttempts(
    agentId: string,
    runLogId: string,
    page: { limit?: number; offset?: number } = {}
  ): Promise<{ attempts: import('../schemas/taskSchemas').TaskDeliveryAttemptEntity[]; total: number }> {
    const run = await this.findRunForAgent(agentId, runLogId)
    const listTaskAttempts = this.deps.queries.channelDeliveryAttempts?.listTaskAttempts
    if (!run || !listTaskAttempts) throw new TaskAutomationQueryError('task-not-found')
    const offset = normalizeOffset(page.offset)
    const pageResult = listTaskAttempts({ agentId, runLogId, limit: normalizeLimit(page.limit), offset })
    return clone({
      total: pageResult.total,
      attempts: pageResult.attempts.map((attempt, index) => ({
        id: attempt.id,
        runLogId,
        taskId: run.scheduleId,
        agentId,
        taskNameSnapshot: run.taskNameSnapshot ?? '',
        channelId: attempt.channelId,
        targetHash: null,
        status: mapDeliveryStatus(attempt.status),
        attemptNumber: offset + index + 1,
        startedAt: attempt.createdAt,
        completedAt: attempt.completedAt,
        errorCode: attempt.errorCode
      }))
    })
  }

  async listTaskMutationAudits(query: {
    taskId?: string
    agentId?: string
    limit?: number
    offset?: number
  }): Promise<{ audits: import('../runtime/tasks/taskAutomationContracts').TaskMutationAuditEntity[]; total: number }> {
    const hasTask = Boolean(query.taskId)
    const hasAgent = Boolean(query.agentId)
    if (hasTask === hasAgent) throw new TaskAutomationQueryError('task-request-invalid')
    const page = { limit: normalizeLimit(query.limit), offset: normalizeOffset(query.offset) }
    const result = query.taskId
      ? this.deps.queries.taskMutationAudits?.listByTask(query.taskId, page)
      : this.deps.queries.taskMutationAudits?.listByAgent(query.agentId!, page)
    return clone(result ?? { audits: [], total: 0 })
  }

  async getTaskAutomationPolicy(): Promise<{ preset: TaskAutomationPolicyPreset; policy: ReturnType<typeof getTaskAutomationPolicy> }> {
    const preset = await this.deps.getPolicyPreset()
    return { preset, policy: clone(getTaskAutomationPolicy(preset)) }
  }

  async updateTaskAutomationPolicy(input: { policyPreset: TaskAutomationPolicyPreset }): Promise<{
    preset: TaskAutomationPolicyPreset
    policy: ReturnType<typeof getTaskAutomationPolicy>
  }> {
    if (input.policyPreset !== 'balanced' && input.policyPreset !== 'conservative') {
      throw new TaskAutomationQueryError('task-request-invalid')
    }
    await this.deps.setPolicyPreset(input.policyPreset)
    return { preset: input.policyPreset, policy: clone(getTaskAutomationPolicy(input.policyPreset)) }
  }

  async getTaskDeliveryReadiness(agentId: string, taskId: string): Promise<TaskDeliveryReadiness[]> {
    const task = this.deps.queries.tasks?.get?.(taskId)
    if (!task) throw new TaskAutomationQueryError('task-not-found')
    if (task.agentId !== agentId) throw new TaskAutomationQueryError('task-ownership-denied')
    const channels = this.deps.queries.channels?.list({ agentId }) ?? []
    return (task.channelIds ?? []).map((channelId) => {
      const channel = channels.find((item) => item.id === channelId)
      if (!channel || !channel.isActive) return { channelId, status: 'inactive' }
      return {
        channelId,
        status: this.deps.queries.channelDeliveryTargets?.hasEnabledTarget(channelId, agentId) ? 'ready' : 'no-active-chat'
      }
    })
  }

  private async findRunForAgent(agentId: string, runLogId: string) {
    const run = this.deps.queries.taskRunLogs?.get(runLogId)
    if (!run) return null
    if (run.agentId) return run.agentId === agentId ? run : null
    const task = this.deps.queries.tasks?.get?.(run.scheduleId)
    return task?.agentId === agentId ? run : null
  }
}

function mapDeliveryStatus(status: import('../channels/ChannelDeliveryContracts').ChannelDeliveryStatus): import('../schemas/taskSchemas').TaskDeliveryAttemptEntity['status'] {
  if (status === 'skipped') return 'skipped-no-active-target'
  if (status === 'pending' || status === 'sending') return 'pending'
  return status
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_PAGE_LIMIT
  return Math.min(MAX_PAGE_LIMIT, Math.max(1, Math.trunc(limit)))
}

function normalizeOffset(offset: number | undefined): number {
  return offset === undefined ? 0 : Math.max(0, Math.trunc(offset))
}

function clone<T>(value: T): T {
  return structuredClone(value)
}
