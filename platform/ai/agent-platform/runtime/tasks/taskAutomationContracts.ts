import type { CreateTaskDto, ScheduledTaskEntity, UpdateTaskDto } from '../../schemas/taskSchemas'

export const taskAutomationPolicyPresets = ['balanced', 'conservative'] as const
export type TaskAutomationPolicyPreset = (typeof taskAutomationPolicyPresets)[number]

export type TaskAutomationSettings = {
  policyPreset: TaskAutomationPolicyPreset
}

export type TaskActor =
  | { kind: 'user'; source: 'renderer-settings' | 'renderer-agent-drawer' }
  | { kind: 'agent'; agentId: string; sessionId: string; toolCallId: string }
  | { kind: 'runtime'; source: 'failure-circuit' | 'policy' | 'shutdown' }

export type TaskAutomationCommandErrorCode =
  | 'task-autonomy-required'
  | 'task-ownership-denied'
  | 'task-not-found'
  | 'task-revision-conflict'
  | 'task-completed'
  | 'task-schedule-invalid'
  | 'task-timezone-invalid'
  | 'task-policy-limit'
  | 'task-channel-ineligible'
  | 'task-request-invalid'
  | 'task-not-runnable'
  | 'task-internal-error'

type TaskCommandRequest = {
  actor: TaskActor
  agentId: string
  expectedRevision?: number
}

export type CreateTaskCommand = TaskCommandRequest & {
  type: 'create'
  task: CreateTaskDto
}

export type UpdateTaskCommand = TaskCommandRequest & {
  type: 'update' | 'pause' | 'resume' | 'delete' | 'run-now'
  taskId: string
  patch?: UpdateTaskDto
}

export type TaskAutomationCommand = CreateTaskCommand | UpdateTaskCommand

export type TaskDeliveryReadiness = {
  channelId: string
  status: 'ready' | 'inactive' | 'no-active-chat'
}

export type TaskMutationAuditEntity = {
  id: string
  taskId: string | null
  agentId: string
  taskNameSnapshot: string | null
  action:
    | 'create'
    | 'update'
    | 'pause'
    | 'resume'
    | 'delete'
    | 'run-now'
    | 'cancel-run'
    | 'runtime-transition'
    | 'channel-delete-cleanup'
  actor: TaskActor
  requestHash: string
  resultRevision: number | null
  createdAt: string
  outcome: 'accepted' | 'rejected'
  errorCode: string | null
}

export type TaskCommandResult = {
  task: ScheduledTaskEntity | null
  nextRun: string | null
  deliveryReadiness: TaskDeliveryReadiness[]
  // Task 4 supplies a durable SQLite audit ID in the same mutation transaction.
  auditId: string | null
}
