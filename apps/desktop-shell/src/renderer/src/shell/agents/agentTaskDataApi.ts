import type {
  CreateTaskDto,
  ScheduledTaskEntity,
  TaskDeliveryAttemptEntity,
  TaskRunLogEntity,
  Trigger,
  UpdateTaskDto
} from '@platform/ai/agent-platform/schemas/taskSchemas'
import type { TaskDeliveryReadiness } from '@platform/ai/agent-platform/runtime/tasks/taskAutomationContracts'
import type { TaskAutomationPolicyPreset, TaskMutationAuditEntity } from '@platform/ai/agent-platform/runtime/tasks/taskAutomationContracts'
import type { TaskAutomationPolicy } from '@platform/ai/agent-platform/runtime/tasks/taskAutomationPolicy'
import type { TaskSchedulePreview } from '@platform/ai/agent-platform/runtime/tasks/taskScheduleValidation'
import type { JobRunPage, JobRunQuery } from '@platform/jobs'

export async function listTasksViaApi(
  platform: Window['platform'],
  agentId: string,
  query: { limit?: number; offset?: number; includeHeartbeat?: boolean } = {}
): Promise<{ tasks: ScheduledTaskEntity[]; total: number }> {
  return (await platform.agents.listTasks(agentId, query)) as { tasks: ScheduledTaskEntity[]; total: number }
}

export async function getTaskLogsViaApi(
  platform: Window['platform'],
  agentId: string,
  taskId: string,
  query: { limit?: number; offset?: number } = {}
): Promise<{ logs: TaskRunLogEntity[]; total: number }> {
  return (await platform.agents.getTaskLogs(agentId, taskId, query)) as { logs: TaskRunLogEntity[]; total: number }
}

export async function listTaskPageViaApi(
  platform: Window['platform'],
  query: { status?: ScheduledTaskEntity['status']; cursor?: string; limit?: number } = {}
): Promise<{ tasks: ScheduledTaskEntity[]; total: number; nextCursor?: string }> {
  return (await platform.agents.listTaskPage(query)) as { tasks: ScheduledTaskEntity[]; total: number; nextCursor?: string }
}

export async function listTaskMutationAuditsViaApi(
  platform: Window['platform'],
  query: { taskId?: string; agentId?: string; limit?: number; offset?: number }
): Promise<{ audits: TaskMutationAuditEntity[]; total: number }> {
  return (await platform.agents.listTaskMutationAudits(query)) as { audits: TaskMutationAuditEntity[]; total: number }
}

export async function getTaskAutomationPolicyViaApi(
  platform: Window['platform']
): Promise<{ preset: TaskAutomationPolicyPreset; policy: TaskAutomationPolicy }> {
  return (await platform.agents.getTaskAutomationPolicy()) as { preset: TaskAutomationPolicyPreset; policy: TaskAutomationPolicy }
}

export async function updateTaskAutomationPolicyViaApi(
  platform: Window['platform'],
  policyPreset: TaskAutomationPolicyPreset
): Promise<{ preset: TaskAutomationPolicyPreset; policy: TaskAutomationPolicy }> {
  return (await platform.agents.updateTaskAutomationPolicy({ policyPreset })) as { preset: TaskAutomationPolicyPreset; policy: TaskAutomationPolicy }
}

export async function previewTaskScheduleViaApi(
  platform: Window['platform'],
  trigger: Trigger
): Promise<TaskSchedulePreview> {
  return (await platform.agents.previewTaskSchedule(trigger)) as TaskSchedulePreview
}

export async function getTaskDeliveryReadinessViaApi(
  platform: Window['platform'],
  agentId: string,
  taskId: string
): Promise<TaskDeliveryReadiness[]> {
  return (await platform.agents.getTaskDeliveryReadiness(agentId, taskId)) as TaskDeliveryReadiness[]
}

export async function getTaskDeliveryAttemptsViaApi(
  platform: Window['platform'],
  agentId: string,
  runLogId: string,
  query: { limit?: number; offset?: number } = {}
): Promise<{ attempts: TaskDeliveryAttemptEntity[]; total: number }> {
  return (await platform.agents.getTaskDeliveryAttempts(agentId, runLogId, query)) as {
    attempts: TaskDeliveryAttemptEntity[]
    total: number
  }
}

export async function retryTaskDeliveryViaApi(
  platform: Window['platform'],
  agentId: string,
  runLogId: string,
  attemptId: string
): Promise<{ delivered: number; failed: number; skipped: number; unknown: number }> {
  return (await platform.agents.retryTaskDelivery(agentId, runLogId, attemptId)) as {
    delivered: number
    failed: number
    skipped: number
    unknown: number
  }
}

export function isTaskRevisionConflict(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'task-revision-conflict')
}

export async function createTaskViaApi(
  platform: Window['platform'],
  agentId: string,
  input: CreateTaskDto
): Promise<ScheduledTaskEntity> {
  return (await platform.agents.createTask(agentId, input)) as ScheduledTaskEntity
}

export async function updateTaskViaApi(
  platform: Window['platform'],
  agentId: string,
  taskId: string,
  expectedRevision: number,
  patch: UpdateTaskDto
): Promise<ScheduledTaskEntity | null> {
  return (await platform.agents.updateTask(agentId, taskId, { expectedRevision, patch })) as ScheduledTaskEntity | null
}

export async function deleteTaskViaApi(
  platform: Window['platform'],
  agentId: string,
  taskId: string,
  expectedRevision: number
): Promise<boolean> {
  return (await platform.agents.deleteTask(agentId, taskId, { expectedRevision })) as boolean
}

export async function runTaskViaApi(
  platform: Window['platform'],
  agentId: string,
  taskId: string,
  expectedRevision: number
): Promise<{ taskId: string; runLogId: string }> {
  return (await platform.agents.runTask(agentId, taskId, { expectedRevision })) as { taskId: string; runLogId: string }
}

export async function cancelTaskRunViaApi(
  platform: Window['platform'],
  runLogId: string
): Promise<{ runLogId: string; jobRunId: string | null; cancelled: boolean }> {
  return (await platform.agents.cancelTaskRun(runLogId)) as {
    runLogId: string
    jobRunId: string | null
    cancelled: boolean
  }
}

export async function listTaskJobPageViaApi(platform: Window['platform'], query: JobRunQuery): Promise<JobRunPage> {
  return (await platform.jobs.listRunPage(query)) as JobRunPage
}
