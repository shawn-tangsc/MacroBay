import type { JobLogEntry, JobOwner, RetryPolicy } from './jobTypes'

export type WorkerStatus =
  | 'stopped'
  | 'starting'
  | 'live'
  | 'degraded'
  | 'reconnecting'
  | 'stopping'
  | 'failed'

export type WorkerHeartbeatPolicy = {
  expectedIntervalMs: number
  missedHeartbeatLimit: number
}

export type ManagedWorkerDefinition<TPayload = unknown> = {
  id: string
  owner: JobOwner
  productId?: string
  handlerId: string
  title: string
  payload: TPayload
  restartPolicy: RetryPolicy
  heartbeatPolicy?: WorkerHeartbeatPolicy
  concurrencyKey?: string
  redact?: (value: unknown) => unknown
}

export type ManagedWorkerContext = {
  workerRunId: string
  signal: AbortSignal
  log: (entry: Omit<JobLogEntry, 'at'> & { at?: string }) => Promise<void>
  heartbeat: (metadata?: Record<string, unknown>) => Promise<void>
  markLive: () => Promise<void>
  markDegraded: (reason: string) => Promise<void>
}

export type ManagedWorkerHandler<TPayload = unknown> = (
  payload: TPayload,
  context: ManagedWorkerContext
) => Promise<void>

export type WorkerRunRecord = {
  id: string
  definitionId: string
  handlerId: string
  owner: JobOwner
  productId?: string
  title: string
  status: WorkerStatus
  payload: unknown
  concurrencyKey?: string
  createdAt: string
  startedAt?: string
  liveAt?: string
  lastHeartbeatAt?: string
  stoppedAt?: string
  degradedReason?: string
  lastError?: string
  missedHeartbeats: number
  restartAttempt: number
  logs: JobLogEntry[]
}
