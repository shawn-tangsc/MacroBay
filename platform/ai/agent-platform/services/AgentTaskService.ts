import type { CreateTaskDto, ScheduledTaskEntity, TaskRunLogEntity, UpdateTaskDto } from '../schemas/taskSchemas'
import { addTaskRunLog } from '../store/agentRelationsStore'
import type { AgentPlatformQueryAdapters, AgentPlatformStateStore } from './agentServiceTypes'
import { TaskAutomationCommandError, TaskAutomationCommandService } from '../runtime/tasks/TaskAutomationCommandService'

export class AgentTaskService {
  constructor(
    private readonly store: AgentPlatformStateStore,
    private readonly commands: TaskAutomationCommandService,
    private readonly queries: AgentPlatformQueryAdapters = {}
  ) {}

  async create(agentId: string, dto: CreateTaskDto): Promise<ScheduledTaskEntity> {
    const result = await this.commands.execute({
      type: 'create',
      actor: { kind: 'user', source: 'renderer-agent-drawer' },
      agentId,
      task: dto
    })
    if (!result.task) throw new Error('create task failed')
    return result.task
  }

  async get(agentId: string, taskId: string): Promise<ScheduledTaskEntity | null> {
    const task = this.queries.tasks?.get
      ? this.queries.tasks.get(taskId)
      : (await this.store.getState()).tasks.find((item) => item.id === taskId)
    if (task && task.agentId !== agentId) return null
    return task ?? null
  }

  async list(
    agentId: string,
    options: { limit?: number; offset?: number; includeHeartbeat?: boolean } = {}
  ): Promise<{ tasks: ScheduledTaskEntity[]; total: number }> {
    const page = this.queries.tasks?.list(agentId, options)
    if (page) return page
    const tasks = (await this.store.getState()).tasks
      .filter((task) => {
        if (task.agentId !== agentId) return false
        if (!options.includeHeartbeat && task.name === 'heartbeat') return false
        return true
      })
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id))
    const total = tasks.length
    const offset = Math.max(0, options.offset ?? 0)
    const sliced = options.limit === undefined ? tasks.slice(offset) : tasks.slice(offset, offset + Math.max(0, options.limit))
    return { tasks: sliced, total }
  }

  async update(
    agentId: string,
    taskId: string,
    request: { expectedRevision: number; patch: UpdateTaskDto }
  ): Promise<ScheduledTaskEntity | null> {
    const result = await this.commands.execute({
      type: 'update',
      actor: { kind: 'user', source: 'renderer-agent-drawer' },
      agentId,
      taskId,
      expectedRevision: request.expectedRevision,
      patch: request.patch
    })
    return result.task
  }

  async delete(agentId: string, taskId: string, request: { expectedRevision: number }): Promise<boolean> {
    await this.commands.execute({
      type: 'delete',
      actor: { kind: 'user', source: 'renderer-agent-drawer' },
      agentId,
      taskId,
      expectedRevision: request.expectedRevision
    })
    return true
  }

  async admitRunNow(
    agentId: string,
    taskId: string,
    request: { expectedRevision: number; actor?: Parameters<TaskAutomationCommandService['admitRunNow']>[0]['actor'] },
    now: string
  ) {
    return this.commands.admitRunNow({ agentId, taskId, expectedRevision: request.expectedRevision, now, actor: request.actor })
  }

  async rejectRunNow(agentId: string, taskId: string, request: { expectedRevision: number }): Promise<void> {
    await this.commands.rejectRunNow({ agentId, taskId, expectedRevision: request.expectedRevision })
  }

  async getLogs(
    agentId: string,
    taskId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<{ logs: TaskRunLogEntity[]; total: number }> {
    const page = this.queries.tasks?.listLogs(taskId, options)
    const task = await this.get(agentId, taskId)
    if (task) {
      if (page) return page
      const logs = (await this.store.getState()).taskRunLogs
        .filter((log) => log.scheduleId === taskId)
        .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt) || a.id.localeCompare(b.id))
      const offset = Math.max(0, options.offset ?? 0)
      return { logs: options.limit === undefined ? logs.slice(offset) : logs.slice(offset, offset + Math.max(0, options.limit)), total: logs.length }
    }
    const durableOwner = this.queries.taskRunLogs?.getOwnerForTask?.(taskId)
    if (durableOwner === agentId && page) return page
    const logs = (await this.store.getState()).taskRunLogs
      .filter((log) => log.scheduleId === taskId)
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt) || a.id.localeCompare(b.id))
    if (logs.length === 0 || logs.some((log) => log.agentId !== agentId)) {
      throw new TaskAutomationCommandError('task-not-found')
    }
    const total = logs.length
    const offset = Math.max(0, options.offset ?? 0)
    const sliced = options.limit === undefined ? logs.slice(offset) : logs.slice(offset, offset + Math.max(0, options.limit))
    return { logs: sliced, total }
  }

  async addRunLog(log: TaskRunLogEntity): Promise<TaskRunLogEntity> {
    if (this.store.upsertTaskRunLog) return this.store.upsertTaskRunLog(log)
    this.queries.tasks?.upsertLog?.(log)
    await this.store.update((state) => addTaskRunLog(state, log), { taskRunLogRowsOnly: true })
    return log
  }

  async patchRunLog(runLogId: string, patch: Partial<TaskRunLogEntity>): Promise<TaskRunLogEntity | null> {
    if (this.store.patchTaskRunLog) return this.store.patchTaskRunLog(runLogId, patch)
    let updated: TaskRunLogEntity | null = null
    await this.store.update((state) => {
      const current = state.taskRunLogs.find((log) => log.id === runLogId)
      if (!current) return state
      updated = { ...current, ...patch }
      return {
        ...state,
        taskRunLogs: state.taskRunLogs.map((log) => (log.id === runLogId ? updated! : log))
      }
    }, { taskRunLogRowsOnly: true })
    return updated
  }

  async recordRuntimeTaskRun(taskId: string, input: { startedAt: string; updatedAt: string }): Promise<ScheduledTaskEntity | null> {
    if (this.store.recordRuntimeTaskRun) return this.store.recordRuntimeTaskRun(taskId, input)
    let updated: ScheduledTaskEntity | null = null
    await this.store.update((state) => {
      const current = state.tasks.find((task) => task.id === taskId)
      if (!current) return state
      updated = {
        ...current,
        lastRun: input.startedAt,
        nextRun: current.trigger.kind === 'once' ? null : current.nextRun,
        status: current.trigger.kind === 'once' ? 'completed' : current.status,
        updatedAt: input.updatedAt
      }
      return {
        ...state,
        tasks: state.tasks.map((task) => (task.id === taskId ? updated! : task))
      }
    }, { taskRowsOnly: true })
    return updated
  }

  async pauseTaskForFailureCircuit(taskId: string, updatedAt: string): Promise<ScheduledTaskEntity | null> {
    if (this.store.pauseTaskForFailureCircuit) return this.store.pauseTaskForFailureCircuit(taskId, updatedAt)
    let updated: ScheduledTaskEntity | null = null
    await this.store.update((state) => {
      const current = state.tasks.find((task) => task.id === taskId)
      if (!current || !current.enabled || current.status !== 'active') return state
      updated = {
        ...current,
        enabled: false,
        status: 'paused',
        pauseReason: 'failure-circuit',
        revision: (current.revision ?? 1) + 1,
        updatedAt
      }
      return {
        ...state,
        tasks: state.tasks.map((task) => (task.id === taskId ? updated! : task))
      }
    }, { taskRowsOnly: true })
    return updated
  }
}
