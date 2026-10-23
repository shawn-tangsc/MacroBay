import { createHash, randomUUID } from 'node:crypto'

import { isSoulModeEnabled, normalizePermissionMode } from '../../schemas/agentSchemas'
import type { AgentChannelEntity } from '../../schemas/channelSchemas'
import type { CreateTaskDto, ScheduledTaskEntity, Trigger, UpdateTaskDto } from '../../schemas/taskSchemas'
import type { AgentStoreState } from '../../store/agentStore'
import { createScheduledAgentTask, deleteScheduledAgentTask, updateScheduledAgentTask } from '../../store/agentRelationsStore'
import type { AgentPlatformStateStore, TaskAutomationMutation } from '../../services'
import {
  type TaskAutomationCommand,
  type TaskAutomationCommandErrorCode,
  type TaskCommandResult,
  type TaskDeliveryReadiness,
  type TaskMutationAuditEntity,
  type TaskAutomationPolicyPreset,
  type UpdateTaskCommand
} from './taskAutomationContracts'
import { getTaskAutomationPolicy, taskMaxStartsPerAgentPerHour, validateTaskAutomationLimits } from './taskAutomationPolicy'
import {
  materializeTaskTriggerTimezone,
  previewNextTaskRun,
  validateTaskSchedule,
  validateTaskTimezone
} from './taskScheduleValidation'
import { buildAgentTaskSchedulerSnapshot } from './taskSchedulerPlanner'
import type { AgentTaskSchedulerRuntimeTask } from '../runtimeTypes'
import type { TaskRunLogEntity } from '../../schemas/taskSchemas'

const MAX_TASK_NAME_LENGTH = 120
const MAX_TASK_PROMPT_LENGTH = 16_000

export class TaskAutomationCommandError extends Error {
  constructor(readonly code: TaskAutomationCommandErrorCode) {
    super(code)
    this.name = 'TaskAutomationCommandError'
  }
}

type Dependencies = {
  store: AgentPlatformStateStore
  now?: () => Date
  defaultTimezone?: string
  getPolicyPreset: () => Promise<TaskAutomationPolicyPreset>
  hasEnabledDeliveryTarget?: (channelId: string, agentId: string) => boolean
}

type TaskMutationResult = {
  state: AgentStoreState
  result: TaskCommandResult
}

type CancelTaskRunCommand = {
  actor: Extract<TaskAutomationCommand['actor'], { kind: 'agent' }>
  agentId: string
  taskId: string
  runLogId: string
  expectedRevision: number
}

export type PreparedTaskRunCancellation = {
  command: CancelTaskRunCommand
  task: Pick<ScheduledTaskEntity, 'id' | 'name' | 'revision'>
}

export type TaskChannelDeleteCleanupMutation = {
  state: AgentStoreState
  audits: TaskMutationAuditEntity[]
}

export class TaskAutomationCommandService {
  private readonly defaultTimezone: string

  constructor(private readonly deps: Dependencies) {
    const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    this.defaultTimezone =
      deps.defaultTimezone ?? (validateTaskTimezone(systemTimezone).ok ? systemTimezone : 'UTC')
  }

  async execute(command: TaskAutomationCommand): Promise<TaskCommandResult> {
    if (command.type === 'run-now') {
      await this.rejectRunNow(command)
      throw new TaskAutomationCommandError('task-not-runnable')
    }
    const policy = getTaskAutomationPolicy(await this.deps.getPolicyPreset())
    if (this.deps.store.transactTaskAutomationMutation) {
      return this.deps.store.transactTaskAutomationMutation({
        mutate: (state) => {
          const mutation = this.executeAgainstState(state, command, policy)
          const auditTask = mutation.result.task ?? this.findAuditTask(state, command)
          const audit = this.createAudit(command, auditTask, 'accepted', null)
          return {
            state: mutation.state,
            result: { ...mutation.result, auditId: audit.id },
            audit
          } satisfies TaskAutomationMutation<TaskCommandResult>
        },
        rejectedAudit: (state, error) => this.createAudit(
          command,
          this.findAuditTask(state, command),
          'rejected',
          error instanceof TaskAutomationCommandError ? error.code : 'task-not-found'
        )
      })
    }
    const mutations: TaskMutationResult[] = []

    await this.deps.store.update((state) => {
      const mutation = this.executeAgainstState(state, command, policy)
      mutations.push(mutation)
      return mutation.state
    }, { taskRowsOnly: true })

    const mutation = mutations[0]
    if (!mutation) throw new Error('Task command did not produce a result.')
    return mutation.result
  }

  async admitRunNow(input: {
    agentId: string
    taskId: string
    expectedRevision: number
    now: string
    actor?: UpdateTaskCommand['actor']
  }): Promise<{ task: AgentTaskSchedulerRuntimeTask; runLog: TaskRunLogEntity }> {
    const command: UpdateTaskCommand = {
      type: 'run-now',
      actor: input.actor ?? { kind: 'user', source: 'renderer-agent-drawer' },
      agentId: input.agentId,
      taskId: input.taskId,
      expectedRevision: input.expectedRevision
    }
    const admit = (state: AgentStoreState) => {
      const agent = state.agents.find((item) => item.id === command.agentId)
      if (!agent) throw new TaskAutomationCommandError('task-not-found')
      this.assertActorOwnership(state, command)
      const entity = state.tasks.find((item) => item.id === command.taskId)
      if (!entity) throw new TaskAutomationCommandError('task-not-found')
      if (entity.agentId !== command.agentId) throw new TaskAutomationCommandError('task-ownership-denied')
      if ((entity.revision ?? 1) !== command.expectedRevision) throw new TaskAutomationCommandError('task-revision-conflict')
      if (entity.status === 'completed') throw new TaskAutomationCommandError('task-completed')
      this.assertAutonomous(agent.configuration)
      if (countRecentTaskStarts(state.taskRunLogs, command.agentId, input.now) >= taskMaxStartsPerAgentPerHour) {
        throw new TaskAutomationCommandError('task-policy-limit')
      }
      const task = buildAgentTaskSchedulerSnapshot(state, { now: input.now }).tasksById[command.taskId]
      if (!task || !task.isRunnable || state.taskRunLogs.some((log) => log.scheduleId === command.taskId && (log.status === 'queued' || log.status === 'running'))) {
        throw new TaskAutomationCommandError('task-not-runnable')
      }
      const runLog: TaskRunLogEntity = {
        id: randomUUID(),
        scheduleId: task.taskId,
        agentId: task.agentId,
        taskNameSnapshot: task.name,
        startedAt: input.now,
        durationMs: 0,
        status: 'queued'
      }
      const audit = this.createAudit(command, entity, 'accepted', null)
      return { state, result: { task, runLog }, audit, runLog }
    }
    if (this.deps.store.transactTaskRunAdmission) {
      return this.deps.store.transactTaskRunAdmission({
        mutate: admit,
        rejectedAudit: (state, error) => this.createAudit(
          command,
          this.findAuditTask(state, command),
          'rejected',
          error instanceof TaskAutomationCommandError ? error.code : 'task-not-runnable'
        )
      })
    }
    let result: { task: AgentTaskSchedulerRuntimeTask; runLog: TaskRunLogEntity } | null = null
    await this.deps.store.update((state) => {
      const mutation = admit(state)
      result = mutation.result
      return {
        ...mutation.state,
        taskRunLogs: [...mutation.state.taskRunLogs, mutation.runLog]
      }
    }, { taskRunLogRowsOnly: true })
    if (!result) throw new Error('Task run admission did not produce a result.')
    return result
  }

  async rejectRunNow(input: Pick<UpdateTaskCommand, 'agentId' | 'taskId' | 'expectedRevision'> & Partial<Pick<UpdateTaskCommand, 'actor'>>): Promise<void> {
    const command: UpdateTaskCommand = {
      type: 'run-now',
      actor: input.actor ?? { kind: 'user', source: 'renderer-agent-drawer' },
      agentId: input.agentId,
      taskId: input.taskId,
      expectedRevision: input.expectedRevision
    }
    if (!this.deps.store.transactTaskAutomationMutation) {
      const state = await this.deps.store.getState()
      const agent = state.agents.find((item) => item.id === command.agentId)
      if (!agent) throw new TaskAutomationCommandError('task-not-found')
      const task = state.tasks.find((item) => item.id === command.taskId)
      if (!task) throw new TaskAutomationCommandError('task-not-found')
      if (task.agentId !== command.agentId) throw new TaskAutomationCommandError('task-ownership-denied')
      if ((task.revision ?? 1) !== command.expectedRevision) throw new TaskAutomationCommandError('task-revision-conflict')
      if (task.status === 'completed') throw new TaskAutomationCommandError('task-completed')
      this.assertAutonomous(agent.configuration)
      throw new TaskAutomationCommandError('task-not-runnable')
    }
    await this.deps.store.transactTaskAutomationMutation({
      mutate: (state) => {
        const agent = state.agents.find((item) => item.id === command.agentId)
        if (!agent) throw new TaskAutomationCommandError('task-not-found')
        const task = state.tasks.find((item) => item.id === command.taskId)
        if (!task) throw new TaskAutomationCommandError('task-not-found')
        if (task.agentId !== command.agentId) throw new TaskAutomationCommandError('task-ownership-denied')
        if ((task.revision ?? 1) !== command.expectedRevision) throw new TaskAutomationCommandError('task-revision-conflict')
        if (task.status === 'completed') throw new TaskAutomationCommandError('task-completed')
        this.assertAutonomous(agent.configuration)
        throw new TaskAutomationCommandError('task-not-runnable')
      },
      rejectedAudit: (state, error) => this.createAudit(
        command,
        this.findAuditTask(state, command),
        'rejected',
        error instanceof TaskAutomationCommandError ? error.code : 'task-not-runnable'
      )
    })
  }

  async prepareCancelRun(command: CancelTaskRunCommand): Promise<PreparedTaskRunCancellation> {
    const validate = (state: AgentStoreState) => {
      const agent = state.agents.find((item) => item.id === command.agentId)
      if (!agent) throw new TaskAutomationCommandError('task-not-found')
      this.assertActorOwnership(state, { ...command, type: 'delete' })
      this.assertAutonomous(agent.configuration)
      const task = state.tasks.find((item) => item.id === command.taskId)
      if (!task) throw new TaskAutomationCommandError('task-not-found')
      if (task.agentId !== command.agentId) throw new TaskAutomationCommandError('task-ownership-denied')
      if ((task.revision ?? 1) !== command.expectedRevision) throw new TaskAutomationCommandError('task-revision-conflict')
      const run = state.taskRunLogs.find((item) => item.id === command.runLogId)
      if (!run || run.scheduleId !== task.id) throw new TaskAutomationCommandError('task-not-found')
      if (run.agentId !== command.agentId) throw new TaskAutomationCommandError('task-ownership-denied')
      if (run.status !== 'queued' && run.status !== 'running') throw new TaskAutomationCommandError('task-not-runnable')
      return {
        command,
        task: { id: task.id, name: task.name, revision: task.revision }
      }
    }
    const state = await this.deps.store.getState()
    try {
      return validate(state)
    } catch (error) {
      const errorCode = error instanceof TaskAutomationCommandError ? error.code : 'task-not-found'
      await this.deps.store.recordTaskMutationAudit?.(
        this.createCancelRunAudit(
          command,
          state.tasks.find((item) => item.id === command.taskId && item.agentId === command.agentId) ?? null,
          'rejected',
          errorCode
        )
      )
      throw error
    }
  }

  async recordCancelRunOutcome(
    prepared: PreparedTaskRunCancellation,
    outcome: { outcome: 'accepted' } | { outcome: 'rejected'; errorCode: 'task-not-runnable' | 'task-internal-error' }
  ): Promise<void> {
    const audit = this.createCancelRunAudit(
      prepared.command,
      prepared.task,
      outcome.outcome,
      outcome.outcome === 'accepted' ? null : outcome.errorCode
    )
    await this.deps.store.recordTaskMutationAudit?.(audit)
  }

  prepareChannelDeleteCleanup(
    state: AgentStoreState,
    input: {
      channelId: string
      actor: Extract<TaskAutomationCommand['actor'], { kind: 'user' }>
      expectedRevisionByTaskId: ReadonlyMap<string, number>
    }
  ): TaskChannelDeleteCleanupMutation {
    const channel = state.channels.find((item) => item.id === input.channelId)
    if (!channel) return { state, audits: [] }

    const subscribedTaskIds = new Set(
      state.channelTaskSubscriptions
        .filter((subscription) => subscription.channelId === input.channelId)
        .map((subscription) => subscription.taskId)
    )
    const affectedTasks = state.tasks.filter((task) => task.channelIds?.includes(input.channelId) || subscribedTaskIds.has(task.id))
    const now = this.now().toISOString()
    const nextTasksById = new Map<string, ScheduledTaskEntity>()
    const audits: TaskMutationAuditEntity[] = []

    for (const task of affectedTasks) {
      if (channel.agentId !== task.agentId) throw new TaskAutomationCommandError('task-channel-ineligible')
      const revision = task.revision ?? 1
      if (input.expectedRevisionByTaskId.get(task.id) !== revision) {
        throw new TaskAutomationCommandError('task-revision-conflict')
      }
      const next: ScheduledTaskEntity = {
        ...task,
        channelIds: (task.channelIds ?? []).filter((channelId) => channelId !== input.channelId),
        revision: revision + 1,
        updatedAt: now
      }
      nextTasksById.set(task.id, next)
      audits.push({
        id: randomUUID(),
        taskId: task.id,
        agentId: task.agentId,
        taskNameSnapshot: task.name,
        action: 'channel-delete-cleanup',
        actor: input.actor,
        requestHash: createHash('sha256')
          .update(JSON.stringify({ type: 'channel-delete-cleanup', channelId: input.channelId, taskId: task.id, revision }))
          .digest('hex'),
        resultRevision: next.revision ?? null,
        createdAt: now,
        outcome: 'accepted',
        errorCode: null
      })
    }

    return {
      state: {
        ...state,
        channels: state.channels.filter((item) => item.id !== input.channelId),
        tasks: state.tasks.map((task) => nextTasksById.get(task.id) ?? task),
        channelTaskSubscriptions: state.channelTaskSubscriptions.filter((subscription) => subscription.channelId !== input.channelId)
      },
      audits
    }
  }

  private executeAgainstState(
    state: AgentStoreState,
    command: TaskAutomationCommand,
    policy: ReturnType<typeof getTaskAutomationPolicy>
  ): TaskMutationResult {
    const agent = state.agents.find((item) => item.id === command.agentId)
    if (!agent) throw new TaskAutomationCommandError('task-not-found')
    this.assertActorOwnership(state, command)

    if (command.type === 'create') {
      this.assertAutonomous(agent.configuration)
      const task = this.prepareTaskDto(state, command.agentId, command.task, policy)
      const next = createScheduledAgentTask(state, command.agentId, task)
      const created = next.tasks.find((item) => !state.tasks.some((previous) => previous.id === item.id))
      if (!created) throw new TaskAutomationCommandError('task-not-found')
      const taskWithProvenance = withActorProvenance(created, command.actor)
      const provenanceState = {
        ...next,
        tasks: next.tasks.map((item) => (item.id === created.id ? taskWithProvenance : item))
      }
      return {
        state: provenanceState,
        result: this.toResult(taskWithProvenance, state.channels)
      }
    }

    const task = state.tasks.find((item) => item.id === command.taskId)
    if (!task) throw new TaskAutomationCommandError('task-not-found')
    if (task.agentId !== command.agentId) throw new TaskAutomationCommandError('task-ownership-denied')
    if (command.expectedRevision !== (task.revision ?? 1)) throw new TaskAutomationCommandError('task-revision-conflict')

    if (command.type === 'delete') {
      return { state: deleteScheduledAgentTask(state, task.id), result: this.toResult(null, state.channels) }
    }
    if (task.status === 'completed') throw new TaskAutomationCommandError('task-completed')
    if (command.type === 'run-now') {
      this.assertAutonomous(agent.configuration)
      return { state, result: this.toResult(task, state.channels) }
    }

    if (isPauseCommand(command)) {
      const patch = this.preparePausePatch(state, task, command, policy)
      const next = updateScheduledAgentTask(state, task.id, patch)
      const paused = next.tasks.find((item) => item.id === task.id)
      if (!paused) throw new TaskAutomationCommandError('task-not-found')
      return { state: next, result: this.toResult(paused, next.channels) }
    }

    this.assertAutonomous(agent.configuration)
    const patch = this.prepareUpdatePatch(state, task, command, policy)
    const next = updateScheduledAgentTask(state, task.id, patch)
    const updated = next.tasks.find((item) => item.id === task.id)
    if (!updated) throw new TaskAutomationCommandError('task-not-found')
    return { state: next, result: this.toResult(updated, next.channels) }
  }

  private prepareTaskDto(
    state: AgentStoreState,
    agentId: string,
    dto: CreateTaskDto,
    policy: ReturnType<typeof getTaskAutomationPolicy>
  ): CreateTaskDto {
    this.assertTextBounds(dto.name, dto.prompt)
    this.assertWorkspace(state, dto.workspace)
    this.assertChannels(state.channels, agentId, dto.channelIds ?? [], policy.maxChannelsPerTask)
    const timeoutMinutes = dto.timeoutMinutes ?? 2
    this.assertPolicy(policy, state.tasks.filter((task) => task.agentId === agentId && task.enabled).length, timeoutMinutes, dto.trigger)
    const trigger = this.materializeTrigger(dto.trigger)
    return { ...dto, trigger, timeoutMinutes, channelIds: uniqueIds(dto.channelIds ?? []) }
  }

  private prepareUpdatePatch(
    state: AgentStoreState,
    task: ScheduledTaskEntity,
    command: UpdateTaskCommand,
    policy: ReturnType<typeof getTaskAutomationPolicy>
  ): UpdateTaskDto {
    const requestedPatch = command.type === 'pause' ? { enabled: false } : command.type === 'resume' ? { enabled: true } : command.patch ?? {}
    const trigger = this.materializeTrigger(requestedPatch.trigger ?? task.trigger)
    const timeoutMinutes = requestedPatch.timeoutMinutes ?? task.timeoutMinutes
    const channelIds = uniqueIds(requestedPatch.channelIds ?? task.channelIds ?? [])
    this.assertTextBounds(requestedPatch.name ?? task.name, requestedPatch.prompt ?? task.prompt)
    this.assertWorkspace(state, requestedPatch.workspace ?? task.workspace)
    this.assertChannels(state.channels, task.agentId, channelIds, policy.maxChannelsPerTask)
    this.assertPolicy(policy, state.tasks.filter((item) => item.agentId === task.agentId && item.enabled && item.id !== task.id).length, timeoutMinutes, trigger)
    return { ...requestedPatch, trigger, timeoutMinutes, channelIds }
  }

  private preparePausePatch(
    state: AgentStoreState,
    task: ScheduledTaskEntity,
    command: UpdateTaskCommand,
    policy: ReturnType<typeof getTaskAutomationPolicy>
  ): UpdateTaskDto {
    const patch = command.type === 'pause' ? {} : command.patch ?? {}
    if (patch.name !== undefined || patch.prompt !== undefined) {
      this.assertTextBounds(patch.name ?? task.name, patch.prompt ?? task.prompt)
    }
    if (patch.workspace !== undefined) this.assertWorkspace(state, patch.workspace)
    if (patch.channelIds !== undefined) {
      const channelIds = uniqueIds(patch.channelIds)
      this.assertChannels(state.channels, task.agentId, channelIds, policy.maxChannelsPerTask)
    }
    if (patch.timeoutMinutes !== undefined && patch.timeoutMinutes !== null) {
      const limits = validateTaskAutomationLimits(policy, { activeTaskCount: 0, timeoutMinutes: patch.timeoutMinutes })
      if (!limits.ok) throw new TaskAutomationCommandError(limits.code)
    }
    if (patch.trigger !== undefined) this.materializeTrigger(patch.trigger)
    return {
      ...patch,
      ...(patch.trigger === undefined ? {} : { trigger: this.materializeTrigger(patch.trigger) }),
      ...(patch.channelIds === undefined ? {} : { channelIds: uniqueIds(patch.channelIds) }),
      enabled: false
    }
  }

  private materializeTrigger(trigger: Trigger): Trigger {
    const options = { now: this.now(), defaultTimezone: this.defaultTimezone }
    const validation = validateTaskSchedule(trigger, options)
    if (!validation.ok) throw new TaskAutomationCommandError(validation.code)
    const materialized = materializeTaskTriggerTimezone(trigger, options)
    if (!materialized.ok) throw new TaskAutomationCommandError(materialized.code)
    return materialized.trigger
  }

  private assertPolicy(
    policy: ReturnType<typeof getTaskAutomationPolicy>,
    activeTaskCount: number,
    timeoutMinutes: number,
    trigger: Trigger
  ): void {
    const limits = validateTaskAutomationLimits(policy, { activeTaskCount, timeoutMinutes })
    if (!limits.ok) throw new TaskAutomationCommandError(limits.code)
    if (trigger.kind === 'interval' && trigger.ms < policy.minimumRecurringIntervalMs) {
      throw new TaskAutomationCommandError('task-policy-limit')
    }
  }

  private assertTextBounds(name: string, prompt: string): void {
    if (!name.trim() || name.length > MAX_TASK_NAME_LENGTH || !prompt.trim() || prompt.length > MAX_TASK_PROMPT_LENGTH) {
      throw new TaskAutomationCommandError('task-policy-limit')
    }
  }

  private assertChannels(channels: readonly AgentChannelEntity[], agentId: string, channelIds: readonly string[], maxChannels: number): void {
    if (channelIds.length > maxChannels || new Set(channelIds).size !== channelIds.length) {
      throw new TaskAutomationCommandError('task-channel-ineligible')
    }
    if (channelIds.some((channelId) => channels.find((channel) => channel.id === channelId)?.agentId !== agentId)) {
      throw new TaskAutomationCommandError('task-channel-ineligible')
    }
  }

  private assertWorkspace(state: AgentStoreState, workspace: ScheduledTaskEntity['workspace']): void {
    if (workspace.type === 'system') return
    if (!state.workspaces.some((item) => item.id === workspace.workspaceId && item.type === 'user')) {
      throw new TaskAutomationCommandError('task-not-found')
    }
  }

  private assertActorOwnership(state: AgentStoreState, command: TaskAutomationCommand): void {
    const actor = command.actor
    if (actor.kind !== 'agent') return
    if (actor.agentId !== command.agentId) throw new TaskAutomationCommandError('task-ownership-denied')
    if (!state.sessions.some((session) => session.id === actor.sessionId && session.agentId === command.agentId)) {
      throw new TaskAutomationCommandError('task-ownership-denied')
    }
  }

  private assertAutonomous(configuration: AgentStoreState['agents'][number]['configuration']): void {
    if (!isSoulModeEnabled(configuration) && normalizePermissionMode(configuration?.permission_mode) !== 'bypassPermissions') {
      throw new TaskAutomationCommandError('task-autonomy-required')
    }
  }

  private toResult(task: ScheduledTaskEntity | null, channels: readonly AgentChannelEntity[]): TaskCommandResult {
    const nextRun = task ? previewNextTaskRun(task, { now: this.now(), defaultTimezone: this.defaultTimezone }) : null
    return {
      task,
      nextRun: nextRun && nextRun.ok ? nextRun.nextRunAt : null,
      deliveryReadiness: task ? getDeliveryReadiness(task, channels, this.deps.hasEnabledDeliveryTarget) : [],
      auditId: null
    }
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  private findAuditTask(state: AgentStoreState, command: TaskAutomationCommand): ScheduledTaskEntity | null {
    if (command.type === 'create') return null
    return state.tasks.find((item) => item.id === command.taskId && item.agentId === command.agentId) ?? null
  }

  private createAudit(
    command: TaskAutomationCommand,
    task: Pick<ScheduledTaskEntity, 'id' | 'name' | 'revision'> | null,
    outcome: TaskMutationAuditEntity['outcome'],
    errorCode: string | null
  ): TaskMutationAuditEntity {
    return {
      id: randomUUID(),
      taskId: task?.id ?? (outcome === 'accepted' && command.type !== 'create' ? command.taskId : null),
      agentId: command.agentId,
      taskNameSnapshot: task?.name ?? (command.type === 'create' ? command.task.name : null),
      action: command.type,
      actor: command.actor,
      requestHash: createHash('sha256').update(JSON.stringify(command)).digest('hex'),
      resultRevision: outcome === 'accepted' ? task?.revision ?? null : null,
      createdAt: this.now().toISOString(),
      outcome,
      errorCode
    }
  }

  private createCancelRunAudit(
    command: CancelTaskRunCommand,
    task: Pick<ScheduledTaskEntity, 'id' | 'name' | 'revision'> | null,
    outcome: TaskMutationAuditEntity['outcome'],
    errorCode: string | null
  ): TaskMutationAuditEntity {
    return {
      id: randomUUID(),
      taskId: task?.id ?? null,
      agentId: command.agentId,
      taskNameSnapshot: task?.name ?? null,
      action: 'cancel-run',
      actor: command.actor,
      requestHash: createHash('sha256').update(JSON.stringify(command)).digest('hex'),
      resultRevision: outcome === 'accepted' ? task?.revision ?? null : null,
      createdAt: this.now().toISOString(),
      outcome,
      errorCode
    }
  }

}

function countRecentTaskStarts(runs: readonly TaskRunLogEntity[], agentId: string, now: string): number {
  const cutoff = Date.parse(now) - 60 * 60_000
  return runs.filter((run) => run.agentId === agentId && hasStartedTaskRun(run) && Date.parse(run.startedAt) >= cutoff).length
}

function hasStartedTaskRun(run: TaskRunLogEntity): boolean {
  return run.status !== 'queued' && !(run.status === 'cancelled' && run.terminalReason === 'policy-blocked')
}

function isPauseCommand(command: UpdateTaskCommand): boolean {
  return command.type === 'pause' || (command.type === 'update' && command.patch?.enabled === false)
}

function withActorProvenance(task: ScheduledTaskEntity, actor: TaskAutomationCommand['actor']): ScheduledTaskEntity {
  if (actor.kind !== 'agent') return { ...task, provenance: { createdBy: 'user' } }
  return {
    ...task,
    provenance: { createdBy: 'agent', createdAgentSessionId: actor.sessionId, createdToolCallId: actor.toolCallId }
  }
}

function getDeliveryReadiness(
  task: ScheduledTaskEntity,
  channels: readonly AgentChannelEntity[],
  hasEnabledDeliveryTarget?: (channelId: string, agentId: string) => boolean
): TaskDeliveryReadiness[] {
  const readiness: TaskDeliveryReadiness[] = []
  for (const channelId of task.channelIds ?? []) {
    const channel = channels.find((item) => item.id === channelId)
    if (!channel || !channel.isActive) {
      readiness.push({ channelId, status: 'inactive' })
      continue
    }
    readiness.push({ channelId, status: hasEnabledDeliveryTarget?.(channelId, task.agentId) ? 'ready' : 'no-active-chat' })
  }
  return readiness
}

function uniqueIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids))
}
