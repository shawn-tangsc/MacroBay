import type { AgentSessionWorkspaceSource } from './workspaceSchemas'

export const jobStatuses = ['pending', 'delayed', 'running', 'completed', 'failed', 'cancelled'] as const
export type JobStatus = (typeof jobStatuses)[number]

export const TERMINAL_JOB_STATUSES = ['completed', 'failed', 'cancelled'] as const satisfies readonly JobStatus[]

export type CronTrigger = {
  kind: 'cron'
  expr: string
  timezone?: string
  limit?: number
}

export type IntervalTrigger = {
  kind: 'interval'
  ms: number
  anchor?: 'createdAt' | 'lastRun'
}

export type OnceTrigger = {
  kind: 'once'
  at: number
}

export type Trigger = CronTrigger | IntervalTrigger | OnceTrigger

export type CatchUpPolicy = { kind: 'skip-missed' } | { kind: 'after-startup'; minutes: number }

export type RetryPolicy = {
  maxAttempts: number
  backoff: 'exponential' | 'fixed' | 'none'
  baseDelayMs: number
  maxDelayMs: number
}

export type ScheduledTaskEntity = {
  id: string
  agentId: string
  name: string
  prompt: string
  trigger: Trigger
  catchUpPolicy?: CatchUpPolicy
  timeoutMinutes: number
  workspace: AgentSessionWorkspaceSource
  channelIds?: string[]
  nextRun?: string | null
  lastRun?: string | null
  enabled: boolean
  status: 'active' | 'paused' | 'completed'
  revision?: number
  pauseReason?: 'user' | 'failure-circuit' | null
  failureResetAt?: string | null
  provenance?: {
    createdBy: 'user' | 'agent' | 'legacy'
    createdAgentSessionId?: string
    createdToolCallId?: string
  }
  createdAt: string
  updatedAt: string
}

export type TaskRunLogEntity = {
  id: string
  scheduleId: string
  agentId?: string | null
  taskNameSnapshot?: string | null
  sessionId?: string | null
  startedAt: string
  durationMs: number
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'skipped'
  terminalReason?: 'timeout' | 'user-cancelled' | 'runtime-shutdown' | 'runtime-restarted' | 'policy-blocked' | null
  resultPreview?: string | null
  resultHash?: string | null
  resultCharCount?: number | null
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | null
  deliverySummary?: { delivered: number; failed: number; skipped: number; unknown: number } | null
  // Legacy compatibility alias; new writes use resultPreview.
  result?: string | null
  error?: string | null
}

export type TaskDeliveryAttemptEntity = {
  id: string
  runLogId: string
  taskId: string
  agentId: string
  taskNameSnapshot: string
  channelId: string
  targetHash: string | null
  status: 'pending' | 'delivered' | 'failed' | 'skipped-no-active-target' | 'skipped-channel-inactive' | 'unknown-after-restart' | 'unknown-after-send'
  attemptNumber: number
  startedAt: string
  completedAt?: string | null
  errorCode?: string | null
}

export type CreateTaskDto = {
  name: string
  prompt: string
  trigger: Trigger
  catchUpPolicy?: CatchUpPolicy
  workspace: AgentSessionWorkspaceSource
  timeoutMinutes?: number | null
  channelIds?: string[]
}

export type UpdateTaskDto = Partial<CreateTaskDto> & {
  enabled?: boolean
}

export function isTerminalJobStatus(status: JobStatus): boolean {
  return (TERMINAL_JOB_STATUSES as readonly JobStatus[]).includes(status)
}
