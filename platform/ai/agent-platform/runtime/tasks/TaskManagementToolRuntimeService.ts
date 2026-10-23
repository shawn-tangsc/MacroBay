import { isSoulModeEnabled, normalizePermissionMode } from '../../schemas/agentSchemas'
import type { Trigger, CreateTaskDto, UpdateTaskDto } from '../../schemas/taskSchemas'
import type { AgentSessionWorkspaceSource } from '../../schemas/workspaceSchemas'
import type { AgentStoreState } from '../../store/agentStore'
import type { AgentPlatformStateStore } from '../../services'
import { TaskAutomationCommandError, TaskAutomationCommandService } from './TaskAutomationCommandService'

const maxIdLength = 160
const maxPageLimit = 100
const maxPageOffset = 1_000_000

export const taskManagementToolNames = [
  'scheduled_task_list',
  'scheduled_task_create',
  'scheduled_task_update',
  'scheduled_task_pause',
  'scheduled_task_resume',
  'scheduled_task_delete',
  'scheduled_task_list_runs'
] as const

const taskManagementRunNowToolName = 'scheduled_task_run_now' as const

export type TaskManagementToolName = (typeof taskManagementToolNames)[number] | typeof taskManagementRunNowToolName

export type TaskManagementToolDescriptor = {
  name: TaskManagementToolName
  description: string
  approval: 'auto'
  mutating: boolean
  inputSchema: Record<string, unknown>
}

export type TaskManagementToolsRuntimeSnapshot = {
  agentId: string
  toolNames: TaskManagementToolName[]
  tools: TaskManagementToolDescriptor[]
}

export type TaskManagementToolInvocation = {
  agentId: string
  sessionId: string
  toolCallId: string
  toolName: TaskManagementToolName
  input: unknown
}

type Dependencies = {
  store?: AgentPlatformStateStore
  commands?: TaskAutomationCommandService
  runTask?: (input: { agentId: string; taskId: string; expectedRevision: number; actor: Extract<import('./taskAutomationContracts').TaskActor, { kind: 'agent' }> }) => Promise<{ taskId: string; runLogId: string }>
}

export class TaskManagementToolRuntimeService {
  constructor(private readonly deps: Dependencies = {}) {}

  getAgentRuntime(state: AgentStoreState, agentId: string): TaskManagementToolsRuntimeSnapshot {
    const agent = state.agents.find((item) => item.id === agentId)
    if (!agent || !isAutonomous(agent.configuration)) return emptyRuntimeSnapshot(agentId)
    const tools = [
      ...taskManagementToolDescriptors,
      ...(this.deps.runTask ? [runNowDescriptor] : [])
    ]
    return {
      agentId,
      toolNames: tools.map((tool) => tool.name),
      tools: tools.map((tool) => ({ ...tool, inputSchema: { ...tool.inputSchema } }))
    }
  }

  async invoke(input: TaskManagementToolInvocation): Promise<unknown> {
    const state = await this.requireStore().getState()
    const actor = this.assertActor(state, input)

    switch (input.toolName) {
      case 'scheduled_task_list':
        return this.list(state, actor.agentId, input.input)
      case 'scheduled_task_list_runs':
        return this.listRuns(state, actor.agentId, input.input)
      case 'scheduled_task_create':
        return this.executeMutation({
          type: 'create',
          actor,
          agentId: actor.agentId,
          task: parseCreateTaskInput(input.input)
        })
      case 'scheduled_task_update': {
        const request = parseTaskPatchRequest(input.input)
        return this.executeMutation({ type: 'update', actor, agentId: actor.agentId, ...request })
      }
      case 'scheduled_task_pause':
        return this.executeMutation({ type: 'pause', actor, agentId: actor.agentId, ...parseTaskRevisionRequest(input.input) })
      case 'scheduled_task_resume':
        return this.executeMutation({ type: 'resume', actor, agentId: actor.agentId, ...parseTaskRevisionRequest(input.input) })
      case 'scheduled_task_delete':
        return this.executeMutation({ type: 'delete', actor, agentId: actor.agentId, ...parseTaskRevisionRequest(input.input) })
      case 'scheduled_task_run_now': {
        const request = parseTaskRevisionRequest(input.input)
        const result = await this.requireRunTask()({ agentId: actor.agentId, ...request, actor })
        return { ...result, status: 'queued' }
      }
    }
    throw new TaskAutomationCommandError('task-request-invalid')
  }

  private async executeMutation(command: Parameters<TaskAutomationCommandService['execute']>[0]) {
    const result = await this.requireCommands().execute(command)
    return {
      task: result.task ? toTaskSummary(result.task) : null,
      nextRun: result.nextRun,
      deliveryReadiness: result.deliveryReadiness.map((item) => ({ ...item }))
    }
  }

  private list(state: AgentStoreState, agentId: string, input: unknown) {
    const page = parsePage(input)
    const tasks = state.tasks
      .filter((task) => task.agentId === agentId)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt) || left.id.localeCompare(right.id))
    const channels = state.channels
      .filter((channel) => channel.agentId === agentId)
      .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        type: channel.type,
        isActive: channel.isActive,
        activeChatCount: channel.activeChatIds?.length ?? 0
      }))
    return {
      tasks: slicePage(tasks, page).map(toTaskSummary),
      total: tasks.length,
      channels
    }
  }

  private listRuns(state: AgentStoreState, agentId: string, input: unknown) {
    const request = requiredObject(input)
    const taskId = parseId(request.taskId)
    const page = parsePage(request)
    const task = state.tasks.find((item) => item.id === taskId && item.agentId === agentId)
    if (!task) throw new TaskAutomationCommandError('task-not-found')
    const runs = state.taskRunLogs
      .filter((run) => run.scheduleId === taskId && run.agentId === agentId)
      .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt) || left.id.localeCompare(right.id))
    return {
      taskId,
      runs: slicePage(runs, page).map((run) => ({
        id: run.id,
        status: run.status,
        startedAt: run.startedAt,
        durationMs: run.durationMs,
        resultPreview: run.resultPreview ?? null,
        terminalReason: run.terminalReason ?? null
      })),
      total: runs.length
    }
  }

  private assertActor(state: AgentStoreState, input: TaskManagementToolInvocation) {
    const agent = state.agents.find((item) => item.id === input.agentId)
    if (!agent) throw new TaskAutomationCommandError('task-not-found')
    if (!isAutonomous(agent.configuration)) throw new TaskAutomationCommandError('task-autonomy-required')
    const session = state.sessions.find((item) => item.id === input.sessionId)
    if (!session || session.agentId !== input.agentId) throw new TaskAutomationCommandError('task-ownership-denied')
    if (!isBoundedString(input.toolCallId, maxIdLength)) throw new TaskAutomationCommandError('task-request-invalid')
    return { kind: 'agent' as const, agentId: input.agentId, sessionId: input.sessionId, toolCallId: input.toolCallId }
  }

  private requireStore(): AgentPlatformStateStore {
    if (!this.deps.store) throw new Error('Task management invocation requires a state store.')
    return this.deps.store
  }

  private requireCommands(): TaskAutomationCommandService {
    if (!this.deps.commands) throw new Error('Task management invocation requires the task command service.')
    return this.deps.commands
  }

  private requireRunTask(): NonNullable<Dependencies['runTask']> {
    if (!this.deps.runTask) throw new TaskAutomationCommandError('task-not-runnable')
    return this.deps.runTask
  }
}

const pageProperties = { limit: { type: 'integer', minimum: 1, maximum: maxPageLimit }, offset: { type: 'integer', minimum: 0, maximum: maxPageOffset } }
const revisionProperties = { taskId: { type: 'string', minLength: 1, maxLength: maxIdLength }, expectedRevision: { type: 'integer', minimum: 1, maximum: 2_147_483_647 } }
const revisionSchema = { type: 'object', required: ['taskId', 'expectedRevision'], properties: revisionProperties }
const triggerSchema = {
  oneOf: [
    {
      type: 'object',
      required: ['kind', 'ms'],
      properties: {
        kind: { const: 'interval' },
        ms: { type: 'integer', minimum: 300_000, maximum: 31 * 24 * 60 * 60 * 1000 },
        anchor: { enum: ['createdAt', 'lastRun'] }
      }
    },
    {
      type: 'object',
      required: ['kind', 'at'],
      properties: {
        kind: { const: 'once' },
        at: { type: 'integer', minimum: 1, maximum: 8_640_000_000_000_000 }
      }
    },
    {
      type: 'object',
      required: ['kind', 'expr'],
      properties: {
        kind: { const: 'cron' },
        expr: { type: 'string', minLength: 1, maxLength: 500 },
        timezone: { type: 'string', minLength: 1, maxLength: 120 },
        limit: { type: 'integer', minimum: 1, maximum: 1_000_000 }
      }
    }
  ]
}
const workspaceSchema = {
  oneOf: [
    { type: 'object', required: ['type'], properties: { type: { const: 'system' } } },
    {
      type: 'object',
      required: ['type', 'workspaceId'],
      properties: {
        type: { const: 'user' },
        workspaceId: { type: 'string', minLength: 1, maxLength: maxIdLength }
      }
    }
  ]
}
const taskPatchSchema = {
  type: 'object',
  minProperties: 1,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 120 },
    prompt: { type: 'string', minLength: 1, maxLength: 16_000 },
    trigger: triggerSchema,
    workspace: workspaceSchema,
    timeoutMinutes: { type: 'integer', minimum: 1, maximum: 120 },
    channelIds: { type: 'array', maxItems: 10, items: { type: 'string', minLength: 1, maxLength: maxIdLength } },
    enabled: { type: 'boolean' }
  }
}

const taskManagementToolDescriptors: readonly TaskManagementToolDescriptor[] = [
  descriptor('scheduled_task_list', false, { type: 'object', properties: pageProperties }),
  descriptor('scheduled_task_create', true, {
    type: 'object',
    required: ['name', 'prompt', 'trigger', 'workspace'],
    properties: { name: { type: 'string', minLength: 1, maxLength: 120 }, prompt: { type: 'string', minLength: 1, maxLength: 16_000 }, trigger: triggerSchema, workspace: workspaceSchema, timeoutMinutes: { type: 'integer', minimum: 1, maximum: 120 }, channelIds: { type: 'array', maxItems: 10, items: { type: 'string', minLength: 1, maxLength: maxIdLength } } }
  }),
  descriptor('scheduled_task_update', true, { type: 'object', required: ['taskId', 'expectedRevision', 'patch'], properties: { ...revisionProperties, patch: taskPatchSchema } }),
  descriptor('scheduled_task_pause', true, revisionSchema),
  descriptor('scheduled_task_resume', true, revisionSchema),
  descriptor('scheduled_task_delete', true, revisionSchema),
  descriptor('scheduled_task_list_runs', false, { type: 'object', required: ['taskId'], properties: { taskId: { type: 'string', minLength: 1, maxLength: maxIdLength }, ...pageProperties } })
]

const runNowDescriptor = descriptor(taskManagementRunNowToolName, true, revisionSchema)

function descriptor(name: TaskManagementToolName, mutating: boolean, inputSchema: Record<string, unknown>): TaskManagementToolDescriptor {
  return { name, description: name, approval: 'auto', mutating, inputSchema }
}

function emptyRuntimeSnapshot(agentId: string): TaskManagementToolsRuntimeSnapshot {
  return { agentId, toolNames: [], tools: [] }
}

function isAutonomous(configuration: AgentStoreState['agents'][number]['configuration']): boolean {
  return isSoulModeEnabled(configuration) || normalizePermissionMode(configuration?.permission_mode) === 'bypassPermissions'
}

function toTaskSummary(task: AgentStoreState['tasks'][number]) {
  return {
    id: task.id,
    name: task.name,
    trigger: cloneTrigger(task.trigger),
    status: task.status,
    enabled: task.enabled,
    revision: task.revision ?? 1,
    nextRun: task.nextRun ?? null,
    timeoutMinutes: task.timeoutMinutes,
    channelIds: [...(task.channelIds ?? [])]
  }
}

function parseCreateTaskInput(value: unknown): CreateTaskDto {
  const input = requiredObject(value)
  return {
    name: parseString(input.name, 120),
    prompt: parseString(input.prompt, 16_000),
    trigger: parseTrigger(input.trigger),
    workspace: parseWorkspace(input.workspace),
    ...(input.timeoutMinutes === undefined ? {} : { timeoutMinutes: parsePositiveInteger(input.timeoutMinutes, 120) }),
    ...(input.channelIds === undefined ? {} : { channelIds: parseChannelIds(input.channelIds) })
  }
}

function parseTaskPatchRequest(value: unknown): { taskId: string; expectedRevision: number; patch: UpdateTaskDto } {
  const input = requiredObject(value)
  const patch = requiredObject(input.patch)
  const next: UpdateTaskDto = {}
  if (patch.name !== undefined) next.name = parseString(patch.name, 120)
  if (patch.prompt !== undefined) next.prompt = parseString(patch.prompt, 16_000)
  if (patch.trigger !== undefined) next.trigger = parseTrigger(patch.trigger)
  if (patch.workspace !== undefined) next.workspace = parseWorkspace(patch.workspace)
  if (patch.timeoutMinutes !== undefined) next.timeoutMinutes = parsePositiveInteger(patch.timeoutMinutes, 120)
  if (patch.channelIds !== undefined) next.channelIds = parseChannelIds(patch.channelIds)
  if (patch.enabled !== undefined) {
    if (typeof patch.enabled !== 'boolean') fail()
    next.enabled = patch.enabled
  }
  if (Object.keys(next).length === 0) fail()
  return { taskId: parseId(input.taskId), expectedRevision: parsePositiveInteger(input.expectedRevision, 2_147_483_647), patch: next }
}

function parseTaskRevisionRequest(value: unknown): { taskId: string; expectedRevision: number } {
  const input = requiredObject(value)
  return { taskId: parseId(input.taskId), expectedRevision: parsePositiveInteger(input.expectedRevision, 2_147_483_647) }
}

function parsePage(value: unknown): { limit: number; offset: number } {
  const input = value === undefined ? {} : requiredObject(value)
  return {
    limit: input.limit === undefined ? maxPageLimit : parsePositiveInteger(input.limit, maxPageLimit),
    offset: input.offset === undefined ? 0 : parseNonNegativeInteger(input.offset, maxPageOffset)
  }
}

function parseTrigger(value: unknown): Trigger {
  const input = requiredObject(value)
  if (input.kind === 'interval') {
    if (input.anchor !== undefined && input.anchor !== 'createdAt' && input.anchor !== 'lastRun') fail()
    return {
      kind: 'interval',
      ms: parsePositiveInteger(input.ms, 31 * 24 * 60 * 60 * 1000),
      ...(input.anchor === undefined ? {} : { anchor: input.anchor })
    }
  }
  if (input.kind === 'once') return { kind: 'once', at: parsePositiveInteger(input.at, 8_640_000_000_000_000) }
  if (input.kind === 'cron') return { kind: 'cron', expr: parseString(input.expr, 500), ...(input.timezone === undefined ? {} : { timezone: parseString(input.timezone, 120) }), ...(input.limit === undefined ? {} : { limit: parsePositiveInteger(input.limit, 1_000_000) }) }
  return fail()
}

function parseWorkspace(value: unknown): AgentSessionWorkspaceSource {
  const input = requiredObject(value)
  if (input.type === 'system') return { type: 'system' }
  if (input.type === 'user') return { type: 'user', workspaceId: parseId(input.workspaceId) }
  return fail()
}

function parseChannelIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 10) fail()
  const channelIds = value.map((item) => parseId(item))
  if (new Set(channelIds).size !== channelIds.length) fail()
  return channelIds
}

function parseId(value: unknown): string {
  return parseString(value, maxIdLength)
}

function parseString(value: unknown, maxLength: number): string {
  if (!isBoundedString(value, maxLength)) fail()
  return value.trim()
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && Boolean(value.trim()) && value.trim().length <= maxLength
}

function parsePositiveInteger(value: unknown, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum) fail()
  return value
}

function parseNonNegativeInteger(value: unknown, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum) fail()
  return value
}

function requiredObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail()
  return value as Record<string, unknown>
}

function slicePage<T>(items: readonly T[], page: { limit: number; offset: number }): T[] {
  return items.slice(page.offset, page.offset + page.limit)
}

function cloneTrigger(trigger: Trigger): Trigger {
  return { ...trigger }
}

function fail(): never {
  throw new TaskAutomationCommandError('task-request-invalid')
}
