import type { AgentEntity } from '../schemas/agentSchemas'
import type {
  AgentSessionMessagesListQuery,
  AgentSessionEntity,
  AgentSessionMessageEntity,
  ListAgentSessionsQuery
} from '../schemas/sessionSchemas'
import type { AgentChannelEntity, AgentChannelListQuery } from '../schemas/channelSchemas'
import type { AgentWorkspaceEntity } from '../schemas/workspaceSchemas'
import type { AgentStoreState } from '../store/agentStore'
import type { CursorPaginationResponse } from '../store/agentStore'
import type { AgentPersistentWriteOptions } from '../store/agentPersistentStore'
import type { TaskMutationAuditEntity } from '../runtime/tasks/taskAutomationContracts'

export type TaskAutomationMutation<T> = {
  state: AgentStoreState
  result: T
  audit: TaskMutationAuditEntity
}

export type TaskRunAdmissionMutation<T> = {
  state: AgentStoreState
  result: T
  audit: TaskMutationAuditEntity
  runLog: import('../schemas/taskSchemas').TaskRunLogEntity
}

export type TaskRunLogMutation<T> = {
  state: AgentStoreState
  result: T
  runLog: import('../schemas/taskSchemas').TaskRunLogEntity | null
}

export type ChannelDeletionMutation<T> = {
  state: AgentStoreState
  result: T
  audits: TaskMutationAuditEntity[]
}

export type AgentPlatformStateStore = {
  getState: () => Promise<AgentStoreState>
  update: (
    updater: (state: AgentStoreState) => AgentStoreState,
    options?: AgentPersistentWriteOptions
  ) => Promise<AgentStoreState>
  replace: (state: AgentStoreState) => Promise<AgentStoreState>
  // SQLite stores implement this so task definitions and their audit entry commit together.
  transactTaskAutomationMutation?: <T>(input: {
    mutate: (state: AgentStoreState) => TaskAutomationMutation<T>
    rejectedAudit: (state: AgentStoreState, error: unknown) => TaskMutationAuditEntity
  }) => Promise<T>
  recordTaskMutationAudit?: (audit: TaskMutationAuditEntity) => Promise<void>
  transactTaskRunAdmission?: <T>(input: {
    mutate: (state: AgentStoreState) => TaskRunAdmissionMutation<T>
    rejectedAudit: (state: AgentStoreState, error: unknown) => TaskMutationAuditEntity
  }) => Promise<T>
  transactTaskRunLogMutation?: <T>(input: {
    mutate: (state: AgentStoreState) => TaskRunLogMutation<T>
  }) => Promise<T>
  transactChannelDeletionMutation?: <T>(input: {
    channelId: string
    mutate: (state: AgentStoreState) => ChannelDeletionMutation<T>
  }) => Promise<T>
  upsertTaskRunLog?: (log: import('../schemas/taskSchemas').TaskRunLogEntity) => Promise<import('../schemas/taskSchemas').TaskRunLogEntity>
  patchTaskRunLog?: (
    runLogId: string,
    patch: Partial<import('../schemas/taskSchemas').TaskRunLogEntity>
  ) => Promise<import('../schemas/taskSchemas').TaskRunLogEntity | null>
  recordRuntimeTaskRun?: (
    taskId: string,
    input: { startedAt: string; updatedAt: string }
  ) => Promise<import('../schemas/taskSchemas').ScheduledTaskEntity | null>
  pauseTaskForFailureCircuit?: (
    taskId: string,
    updatedAt: string
  ) => Promise<import('../schemas/taskSchemas').ScheduledTaskEntity | null>
}

export type AgentPlatformQueryAdapters = {
  agents?: {
    get: (id: string) => AgentEntity | null
    list: (options?: AgentListOptions) => { agents: AgentEntity[]; total: number }
  }
  workspaces?: {
    list: (options?: { includeSystem?: boolean }) => AgentWorkspaceEntity[]
    getById: (id: string, options?: { includeSystem?: boolean }) => AgentWorkspaceEntity | null
    findByPath: (path: string) => AgentWorkspaceEntity | null
  }
  sessions?: {
    listByCursor: (query?: ListAgentSessionsQuery) => CursorPaginationResponse<Pick<AgentSessionEntity, 'id'>>
  }
  messages?: {
    listByCursor: (
      sessionId: string,
      query?: AgentSessionMessagesListQuery
    ) => CursorPaginationResponse<Pick<AgentSessionMessageEntity, 'id'>>
    search: (query: {
      q: string
      cursor?: string
      limit?: number
      createdAtFrom?: string
      sessionId?: string
    }) => {
      items: Array<{
        messageId: string
        sessionId: string
        role: AgentSessionMessageEntity['role']
        snippet: string
        createdAt: string
      }>
      nextCursor?: string
    }
  }
  tasks?: {
    list: (
      agentId: string,
      options?: { limit?: number; offset?: number; includeHeartbeat?: boolean }
    ) => { tasks: import('../schemas/taskSchemas').ScheduledTaskEntity[]; total: number }
    listLogs: (
      taskId: string,
      options?: { limit?: number; offset?: number }
    ) => { logs: import('../schemas/taskSchemas').TaskRunLogEntity[]; total: number }
    get?: (taskId: string) => import('../schemas/taskSchemas').ScheduledTaskEntity | null
    listPage?: (query: {
      agentId?: string
      status?: import('../schemas/taskSchemas').ScheduledTaskEntity['status']
      cursor?: string
      limit?: number
    }) => {
      tasks: import('../schemas/taskSchemas').ScheduledTaskEntity[]
      total: number
      nextCursor?: string
    }
    upsertLog?: (log: import('../schemas/taskSchemas').TaskRunLogEntity) => void
  }
  taskDeliveryAttempts?: {
    listByRun: (
      runLogId: string,
      options?: { limit?: number; offset?: number }
    ) => { attempts: import('../schemas/taskSchemas').TaskDeliveryAttemptEntity[]; total: number }
  }
  channelDeliveryAttempts?: {
    listTaskAttempts: (input: { agentId: string; runLogId: string; limit: number; offset: number }) => {
      attempts: Array<{ id: string; channelId: string; status: import('../channels/ChannelDeliveryContracts').ChannelDeliveryStatus; errorCode: string | null; createdAt: string; completedAt: string | null }>
      total: number
    }
  }
  channelDeliveryTargets?: {
    hasEnabledTarget: (channelId: string, agentId: string) => boolean
  }
  taskRunLogs?: {
    get: (runLogId: string) => import('../schemas/taskSchemas').TaskRunLogEntity | null
    getOwnerForTask?: (taskId: string) => string | null
  }
  taskMutationAudits?: {
    listByTask: (
      taskId: string,
      options?: { limit?: number; offset?: number }
    ) => { audits: TaskMutationAuditEntity[]; total: number }
    listByAgent: (
      agentId: string,
      options?: { limit?: number; offset?: number }
    ) => { audits: TaskMutationAuditEntity[]; total: number }
  }
  channels?: {
    list: (query?: AgentChannelListQuery) => AgentChannelEntity[]
    findBySessionId: (sessionId: string) => AgentChannelEntity | null
    listByTaskId: (taskId: string) => AgentChannelEntity[]
    listTaskIdsByChannelId: (channelId: string) => string[]
    upsert?: (channel: AgentChannelEntity) => void
    delete?: (channelId: string) => void
    /** @deprecated Task subscription writes are command-service only. */
    replaceSubscriptionsForTask?: (taskId: string, channelIds: readonly string[]) => void
  }
}

export type AgentListOptions = {
  search?: string
  limit?: number
  offset?: number
  sortBy?: 'orderKey' | 'createdAt' | 'updatedAt' | 'name'
  sortOrder?: 'asc' | 'desc'
}

export type AgentEntitySearchItem = {
  type: 'agent'
  id: string
  title: string
  subtitle?: string
  emoji?: string
  updatedAt: string
  target: { agentId: string }
}

export type SessionEntitySearchItem = {
  type: 'session'
  id: string
  title: string
  subtitle?: string
  updatedAt: string
  target: { sessionId: string; agentId: string | null }
}

export type SessionMessageContentSearchItem = {
  messageId: string
  sessionId: string
  sessionName: string
  agentId?: string
  agentName?: string
  role: string
  snippet: string
  createdAt: string
}
