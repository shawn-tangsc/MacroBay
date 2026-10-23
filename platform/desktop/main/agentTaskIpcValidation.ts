import type { CreateTaskDto, ScheduledTaskEntity, Trigger, UpdateTaskDto } from '../../ai/agent-platform/schemas/taskSchemas'
import type { AgentSessionWorkspaceSource } from '../../ai/agent-platform/schemas/workspaceSchemas'
import type { TaskAutomationPolicyPreset } from '../../ai/agent-platform/runtime/tasks/taskAutomationContracts'
import { validateTaskSchedule } from '../../ai/agent-platform/runtime/tasks/taskScheduleValidation'

const MAX_ID_LENGTH = 160
const MAX_CURSOR_LENGTH = 1_000
const MAX_PAGE_LIMIT = 100

export class AgentTaskIpcValidationError extends Error {
  readonly code: 'task-request-invalid' | 'task-schedule-invalid' | 'task-timezone-invalid'

  constructor(code: AgentTaskIpcValidationError['code'] = 'task-request-invalid') {
    super(code)
    this.name = 'AgentTaskIpcValidationError'
    this.code = code
  }
}

export function parseTaskId(value: unknown): string {
  return parseShortString(value, MAX_ID_LENGTH)
}

export function parseTaskPageQuery(value: unknown): {
  agentId?: string
  status?: ScheduledTaskEntity['status']
  cursor?: string
  limit?: number
} {
  const input = optionalObject(value)
  const status = input.status
  if (status !== undefined && status !== 'active' && status !== 'paused' && status !== 'completed') fail()
  return {
    agentId: input.agentId === undefined ? undefined : parseTaskId(input.agentId),
    status,
    cursor: input.cursor === undefined ? undefined : parseTaskCursor(input.cursor),
    limit: input.limit === undefined ? undefined : parsePageLimit(input.limit)
  }
}

export function parseOffsetPage(value: unknown): { limit?: number; offset?: number } {
  const input = optionalObject(value)
  return {
    limit: input.limit === undefined ? undefined : parsePageLimit(input.limit),
    offset: input.offset === undefined ? undefined : parseNonNegativeInteger(input.offset)
  }
}

export function parseTaskListQuery(value: unknown): {
  limit?: number
  offset?: number
  includeHeartbeat?: boolean
} {
  const input = optionalObject(value)
  if (input.includeHeartbeat !== undefined && typeof input.includeHeartbeat !== 'boolean') fail()
  return {
    limit: input.limit === undefined ? undefined : parsePageLimit(input.limit),
    offset: input.offset === undefined ? undefined : parseNonNegativeInteger(input.offset),
    includeHeartbeat: input.includeHeartbeat as boolean | undefined
  }
}

export function parseTaskAuditQuery(value: unknown): { taskId?: string; agentId?: string; limit?: number; offset?: number } {
  const input = optionalObject(value)
  const taskId = input.taskId === undefined ? undefined : parseTaskId(input.taskId)
  const agentId = input.agentId === undefined ? undefined : parseTaskId(input.agentId)
  if (Boolean(taskId) === Boolean(agentId)) fail()
  return {
    taskId,
    agentId,
    limit: input.limit === undefined ? undefined : parsePageLimit(input.limit),
    offset: input.offset === undefined ? undefined : parseNonNegativeInteger(input.offset)
  }
}

export function parseTaskRevisionRequest(value: unknown): { expectedRevision: number } {
  const input = requiredObject(value)
  return { expectedRevision: parsePositiveInteger(input.expectedRevision, 2_147_483_647) }
}

export function parseTaskUpdateRequest(value: unknown, options: { now: Date; defaultTimezone: string }): {
  expectedRevision: number
  patch: UpdateTaskDto
} {
  const input = requiredObject(value)
  if (!('patch' in input)) fail()
  return {
    expectedRevision: parsePositiveInteger(input.expectedRevision, 2_147_483_647),
    patch: parseTaskPatch(input.patch, options)
  }
}

export function parseTaskCreateDto(value: unknown, options: { now: Date; defaultTimezone: string }): CreateTaskDto {
  const input = requiredObject(value)
  const trigger = parseTrigger(input.trigger)
  assertSchedule(trigger, options)
  return {
    name: parseShortString(input.name, 120),
    prompt: parseShortString(input.prompt, 16_000),
    trigger,
    workspace: parseWorkspace(input.workspace),
    ...(input.catchUpPolicy === undefined ? {} : { catchUpPolicy: parseCatchUpPolicy(input.catchUpPolicy) }),
    ...(input.timeoutMinutes === undefined || input.timeoutMinutes === null
      ? {}
      : { timeoutMinutes: parsePositiveInteger(input.timeoutMinutes, 120) }),
    ...(input.channelIds === undefined ? {} : { channelIds: parseStringArray(input.channelIds, MAX_ID_LENGTH) })
  }
}

export function parseTaskSchedulePreview(value: unknown, options: { now: Date; defaultTimezone: string }): Trigger {
  const input = requiredObject(value)
  const trigger = parseTrigger(input.trigger ?? value)
  assertSchedule(trigger, options)
  return trigger
}

export function parseTaskAutomationPolicyUpdate(value: unknown): { policyPreset: TaskAutomationPolicyPreset } {
  const input = requiredObject(value)
  if (input.policyPreset !== 'balanced' && input.policyPreset !== 'conservative') fail()
  return { policyPreset: input.policyPreset }
}

function parseTaskPatch(value: unknown, options: { now: Date; defaultTimezone: string }): UpdateTaskDto {
  const input = requiredObject(value)
  const patch: UpdateTaskDto = {}
  if (input.name !== undefined) patch.name = parseShortString(input.name, 120)
  if (input.prompt !== undefined) patch.prompt = parseShortString(input.prompt, 16_000)
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== 'boolean') fail()
    patch.enabled = input.enabled
  }
  if (input.trigger !== undefined) {
    patch.trigger = parseTrigger(input.trigger)
    assertSchedule(patch.trigger, options)
  }
  if (input.workspace !== undefined) patch.workspace = parseWorkspace(input.workspace)
  if (input.catchUpPolicy !== undefined) patch.catchUpPolicy = parseCatchUpPolicy(input.catchUpPolicy)
  if (input.timeoutMinutes !== undefined && input.timeoutMinutes !== null) {
    patch.timeoutMinutes = parsePositiveInteger(input.timeoutMinutes, 120)
  }
  if (input.channelIds !== undefined) patch.channelIds = parseStringArray(input.channelIds, MAX_ID_LENGTH)
  return patch
}

function parseTrigger(value: unknown): Trigger {
  const input = requiredObject(value)
  if (input.kind === 'cron') {
    return {
      kind: 'cron',
      expr: parseShortString(input.expr, 500),
      ...(input.timezone === undefined ? {} : { timezone: parseShortString(input.timezone, 120) }),
      ...(input.limit === undefined ? {} : { limit: parsePositiveInteger(input.limit, 1_000_000) })
    }
  }
  if (input.kind === 'interval') {
    const anchor = input.anchor
    if (anchor !== undefined && anchor !== 'createdAt' && anchor !== 'lastRun') fail()
    return { kind: 'interval', ms: parsePositiveInteger(input.ms, 31 * 24 * 60 * 60 * 1000), ...(anchor === undefined ? {} : { anchor }) }
  }
  if (input.kind === 'once') return { kind: 'once', at: parsePositiveInteger(input.at, 8_640_000_000_000_000) }
  return fail()
}

function parseWorkspace(value: unknown): AgentSessionWorkspaceSource {
  const input = requiredObject(value)
  if (input.type === 'system') return { type: 'system' }
  if (input.type === 'user') return { type: 'user', workspaceId: parseTaskId(input.workspaceId) }
  return fail()
}

function parseCatchUpPolicy(value: unknown): NonNullable<CreateTaskDto['catchUpPolicy']> {
  const input = requiredObject(value)
  if (input.kind === 'skip-missed') return { kind: 'skip-missed' }
  if (input.kind === 'after-startup') return { kind: 'after-startup', minutes: parsePositiveInteger(input.minutes, 44_640) }
  return fail()
}

function assertSchedule(trigger: Trigger, options: { now: Date; defaultTimezone: string }): void {
  const result = validateTaskSchedule(trigger, options)
  if (!result.ok) throw new AgentTaskIpcValidationError(result.code)
}

function parseStringArray(value: unknown, maxLength: number): string[] {
  if (!Array.isArray(value) || value.length > 10) fail()
  const values = value.map((item) => parseShortString(item, maxLength))
  if (new Set(values).size !== values.length) fail()
  return values
}

function parseShortString(value: unknown, maxLength = MAX_ID_LENGTH): string {
  if (typeof value !== 'string') fail()
  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength) fail()
  return normalized
}

function parsePositiveInteger(value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) fail()
  return value
}

function parseNonNegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 1_000_000) fail()
  return value
}

function parsePageLimit(value: unknown): number {
  const limit = parsePositiveInteger(value, MAX_PAGE_LIMIT)
  if (limit > MAX_PAGE_LIMIT) fail()
  return limit
}

function parseTaskCursor(value: unknown): string {
  const cursor = parseShortString(value, MAX_CURSOR_LENGTH)
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      nextRun?: unknown
      createdAt?: unknown
      id?: unknown
    }
    if (
      (typeof parsed.nextRun !== 'string' && parsed.nextRun !== null) ||
      typeof parsed.createdAt !== 'string' || !Number.isFinite(Date.parse(parsed.createdAt)) ||
      (typeof parsed.nextRun === 'string' && !Number.isFinite(Date.parse(parsed.nextRun))) ||
      typeof parsed.id !== 'string' || !parsed.id || parsed.id.length > MAX_ID_LENGTH
    ) fail()
  } catch (error) {
    if (error instanceof AgentTaskIpcValidationError) throw error
    fail()
  }
  return cursor
}

function requiredObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail()
  return value as Record<string, unknown>
}

function optionalObject(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {}
  return requiredObject(value)
}

function fail(): never {
  throw new AgentTaskIpcValidationError()
}
