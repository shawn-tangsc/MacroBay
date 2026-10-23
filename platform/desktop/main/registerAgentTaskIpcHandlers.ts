import { IpcChannels } from '../ipc/channels'
import { serializeTaskIpc } from '../ipc/taskIpcEnvelope'
import type { createAgentIpcHandlers } from './agentIpcHandlers'
import {
  parseOffsetPage,
  parseTaskAuditQuery,
  parseTaskAutomationPolicyUpdate,
  parseTaskCreateDto,
  parseTaskId,
  parseTaskListQuery,
  parseTaskPageQuery,
  parseTaskRevisionRequest,
  parseTaskSchedulePreview,
  parseTaskUpdateRequest
} from './agentTaskIpcValidation'

export type AgentTaskIpcListener = (event: unknown, ...args: unknown[]) => Promise<unknown>

export type AgentTaskIpcMain = {
  handle(channel: string, listener: AgentTaskIpcListener): void
}

export type AgentTaskIpcHandlers = Pick<
  ReturnType<typeof createAgentIpcHandlers>,
  | 'listTasks'
  | 'getTaskLogs'
  | 'previewTaskSchedule'
  | 'listTaskPage'
  | 'getTaskDeliveryAttempts'
  | 'retryTaskDelivery'
  | 'listTaskMutationAudits'
  | 'getTaskAutomationPolicy'
  | 'updateTaskAutomationPolicy'
  | 'getTaskDeliveryReadiness'
  | 'createTask'
  | 'updateTask'
  | 'deleteTask'
  | 'runTask'
  | 'cancelTaskRun'
>

export type RegisterAgentTaskIpcHandlersOptions = {
  getScheduleValidationOptions: () => { now: Date; defaultTimezone: string }
  afterCommit: () => Promise<void> | void
}

export function registerAgentTaskIpcHandlers(
  ipcMain: AgentTaskIpcMain,
  handlers: AgentTaskIpcHandlers,
  options: RegisterAgentTaskIpcHandlersOptions
): void {
  const mutation = <T>(operation: () => Promise<T> | T) =>
    serializeTaskIpc(async () => {
      const result = await operation()
      try {
        await options.afterCommit()
      } catch {
        // Observation failures must not overturn an already committed operation.
      }
      return result
    })

  ipcMain.handle(IpcChannels.agentsListTasks, (_event, agentId, query) =>
    serializeTaskIpc(() => handlers.listTasks(parseTaskId(agentId), parseTaskListQuery(query)))
  )
  ipcMain.handle(IpcChannels.agentsGetTaskLogs, (_event, agentId, taskId, query) =>
    serializeTaskIpc(() =>
      handlers.getTaskLogs(parseTaskId(agentId), parseTaskId(taskId), parseOffsetPage(query))
    )
  )
  ipcMain.handle(IpcChannels.agentsPreviewTaskSchedule, (_event, input) =>
    serializeTaskIpc(() =>
      handlers.previewTaskSchedule(
        parseTaskSchedulePreview(input, options.getScheduleValidationOptions())
      )
    )
  )
  ipcMain.handle(IpcChannels.agentsListTaskPage, (_event, query) =>
    serializeTaskIpc(() => handlers.listTaskPage(parseTaskPageQuery(query)))
  )
  ipcMain.handle(IpcChannels.agentsGetTaskDeliveryAttempts, (_event, agentId, runLogId, query) =>
    serializeTaskIpc(() =>
      handlers.getTaskDeliveryAttempts(
        parseTaskId(agentId),
        parseTaskId(runLogId),
        parseOffsetPage(query)
      )
    )
  )
  ipcMain.handle(IpcChannels.agentsRetryTaskDelivery, (_event, agentId, runLogId, attemptId) =>
    mutation(() => handlers.retryTaskDelivery(parseTaskId(agentId), parseTaskId(runLogId), parseTaskId(attemptId)))
  )
  ipcMain.handle(IpcChannels.agentsListTaskMutationAudits, (_event, query) =>
    serializeTaskIpc(() => handlers.listTaskMutationAudits(parseTaskAuditQuery(query)))
  )
  ipcMain.handle(IpcChannels.agentsGetTaskAutomationPolicy, () =>
    serializeTaskIpc(() => handlers.getTaskAutomationPolicy())
  )
  ipcMain.handle(IpcChannels.agentsUpdateTaskAutomationPolicy, (_event, input) =>
    serializeTaskIpc(() =>
      handlers.updateTaskAutomationPolicy(parseTaskAutomationPolicyUpdate(input))
    )
  )
  ipcMain.handle(IpcChannels.agentsGetTaskDeliveryReadiness, (_event, agentId, taskId) =>
    serializeTaskIpc(() =>
      handlers.getTaskDeliveryReadiness(parseTaskId(agentId), parseTaskId(taskId))
    )
  )
  ipcMain.handle(IpcChannels.agentsCreateTask, (_event, agentId, input) =>
    mutation(() =>
      handlers.createTask(
        parseTaskId(agentId),
        parseTaskCreateDto(input, options.getScheduleValidationOptions())
      )
    )
  )
  ipcMain.handle(IpcChannels.agentsUpdateTask, (_event, agentId, taskId, input) =>
    mutation(() =>
      handlers.updateTask(
        parseTaskId(agentId),
        parseTaskId(taskId),
        parseTaskUpdateRequest(input, options.getScheduleValidationOptions())
      )
    )
  )
  ipcMain.handle(IpcChannels.agentsDeleteTask, (_event, agentId, taskId, input) =>
    mutation(() =>
      handlers.deleteTask(parseTaskId(agentId), parseTaskId(taskId), parseTaskRevisionRequest(input))
    )
  )
  ipcMain.handle(IpcChannels.agentsRunTask, (_event, agentId, taskId, input) =>
    mutation(() =>
      handlers.runTask(parseTaskId(agentId), parseTaskId(taskId), parseTaskRevisionRequest(input))
    )
  )
  ipcMain.handle(IpcChannels.agentsCancelTaskRun, (_event, runLogId) =>
    mutation(() => handlers.cancelTaskRun(parseTaskId(runLogId)))
  )
}
