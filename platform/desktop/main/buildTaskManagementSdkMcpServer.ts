import { throwIfAbortSignalAborted } from '../../ai/agent-platform/runtime/runtimeAbort'
import type { AgentRuntimeComposition } from '../../ai/agent-platform/runtime/AgentRuntimeCompositionService'
import type { AgentRuntimeSessionChunk } from '../../ai/agent-platform/runtime/runtimeTypes'
import {
  TaskAutomationCommandError,
  TaskManagementToolRuntimeService,
  type TaskManagementToolDescriptor
} from '../../ai/agent-platform/runtime/tasks'
import type { TaskActor } from '../../ai/agent-platform/runtime/tasks/taskAutomationContracts'
import type { AgentStoreState } from '../../ai/agent-platform/store/agentStore'

export type TaskManagementSdkModule = {
  tool?: (
    name: string,
    description: string,
    schema: unknown,
    handler: (args: Record<string, unknown>) => Promise<TaskManagementSdkToolResult>
  ) => unknown
  createSdkMcpServer?: (input: {
    name: string
    version?: string
    tools: unknown[]
  }) => unknown
}

export type TaskManagementSdkToolResult = {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

export type TaskManagementSdkMcpServer = {
  name: string
  server: unknown
  toolNames: string[]
}

type BuildTaskManagementSdkMcpServerInput = {
  composition: AgentRuntimeComposition
  agentId: string
  sessionId: string
  getAgentState: () => Promise<AgentStoreState>
  runtime: Pick<TaskManagementToolRuntimeService, 'invoke'>
  commands: Pick<import('../../ai/agent-platform/runtime/tasks/TaskAutomationCommandService').TaskAutomationCommandService, 'prepareCancelRun' | 'recordCancelRunOutcome'>
  getTaskRunController: () => {
    cancelTaskRun: (input: string | { runLogId: string; actor: Extract<TaskActor, { kind: 'agent' }> }) => Promise<{ cancelled: boolean }>
  } | null
  emitChunk: (chunk: AgentRuntimeSessionChunk) => void
  signal?: AbortSignal
  loadSdkHelpers?: () => Promise<TaskManagementSdkModule | null>
}

const taskManagementMcpServerKey = 'agent-task-management'
const maxIdLength = 160

export async function buildTaskManagementSdkMcpServer(
  input: BuildTaskManagementSdkMcpServerInput
): Promise<TaskManagementSdkMcpServer | null> {
  const taskManagement = input.composition.taskManagement
  if (!taskManagement || taskManagement.tools.length === 0) return null

  const sdk = (await input.loadSdkHelpers?.()) ?? (await defaultLoadTaskManagementSdkHelpers())
  if (!sdk?.tool || !sdk.createSdkMcpServer) return null

  const descriptors = [
    ...taskManagement.tools,
    ...(input.getTaskRunController() ? [cancelRunDescriptor] : [])
  ]
  const tools = descriptors.map((descriptor) =>
    sdk.tool!(
      descriptor.name,
      descriptor.description,
      descriptor.inputSchema,
      async (args) => invokeDescriptor(input, descriptor, args)
    )
  )

  return {
    name: taskManagementMcpServerKey,
    server: sdk.createSdkMcpServer({
      name: taskManagementMcpServerKey,
      version: '1.0.0',
      tools
    }),
    toolNames: descriptors.map((descriptor) => descriptor.name)
  }
}

const cancelRunDescriptor = {
  name: 'scheduled_task_cancel_run',
  description: 'Cancels a caller-owned active scheduled task run.',
  approval: 'auto',
  mutating: true,
  inputSchema: {
    type: 'object',
    required: ['taskId', 'runLogId', 'expectedRevision'],
    properties: {
      taskId: { type: 'string', minLength: 1, maxLength: maxIdLength },
      runLogId: { type: 'string', minLength: 1, maxLength: maxIdLength },
      expectedRevision: { type: 'integer', minimum: 1, maximum: 2_147_483_647 }
    }
  }
} as const

async function invokeDescriptor(
  input: BuildTaskManagementSdkMcpServerInput,
  descriptor: TaskManagementToolDescriptor | typeof cancelRunDescriptor,
  args: Record<string, unknown>
): Promise<TaskManagementSdkToolResult> {
  const toolCallId = createTaskToolCallId()
  input.emitChunk({
    type: 'tool-input-start',
    sessionId: input.sessionId,
    toolCallId,
    toolName: descriptor.name
  })
  input.emitChunk({
    type: 'tool-input-available',
    sessionId: input.sessionId,
    toolCallId,
    toolName: descriptor.name,
    input: args
  })

  try {
    throwIfAborted(input.signal)
    const output = descriptor.name === 'scheduled_task_cancel_run'
      ? await cancelOwnedTaskRun(input, args, toolCallId)
      : await input.runtime.invoke({
          agentId: input.agentId,
          sessionId: input.sessionId,
          toolCallId,
          toolName: descriptor.name,
          input: args
        })
    throwIfAborted(input.signal)
    input.emitChunk({
      type: 'tool-output-available',
      sessionId: input.sessionId,
      toolCallId,
      output
    })
    return textResult(output)
  } catch (error) {
    const message = safeTaskToolErrorMessage(error)
    input.emitChunk({
      type: 'tool-output-error',
      sessionId: input.sessionId,
      toolCallId,
      errorText: message
    })
    return {
      content: [{ type: 'text', text: message }],
      isError: true
    }
  }
}

async function cancelOwnedTaskRun(
  input: BuildTaskManagementSdkMcpServerInput,
  args: Record<string, unknown>,
  toolCallId: string
): Promise<{ taskId: string; runLogId: string; cancelled: boolean }> {
  const request = parseCancelRunRequest(args)
  const state = await input.getAgentState()
  throwIfAborted(input.signal)

  const task = state.tasks.find((item) => item.id === request.taskId)
  const run = state.taskRunLogs.find((item) => item.id === request.runLogId)
  if (!task || !run) throw new TaskAutomationCommandError('task-not-found')
  const actor = { kind: 'agent' as const, agentId: input.agentId, sessionId: input.sessionId, toolCallId }
  const prepared = await input.commands.prepareCancelRun({ ...request, agentId: input.agentId, actor })
  throwIfAborted(input.signal)

  const controller = input.getTaskRunController()
  let outcome: { outcome: 'accepted' } | { outcome: 'rejected'; errorCode: 'task-not-runnable' | 'task-internal-error' }
  if (!controller) {
    outcome = { outcome: 'rejected', errorCode: 'task-internal-error' }
  } else {
    try {
      const result = await controller.cancelTaskRun({
        runLogId: run.id,
        actor
      })
      outcome = result.cancelled
        ? { outcome: 'accepted' }
        : { outcome: 'rejected', errorCode: 'task-not-runnable' }
    } catch {
      outcome = { outcome: 'rejected', errorCode: 'task-internal-error' }
    }
  }

  await persistCancelOutcome(input, prepared, outcome)
  if (outcome.outcome === 'accepted') {
    return { taskId: task.id, runLogId: run.id, cancelled: true }
  }
  throw new TaskAutomationCommandError(outcome.errorCode)
}

async function persistCancelOutcome(
  input: BuildTaskManagementSdkMcpServerInput,
  prepared: Parameters<BuildTaskManagementSdkMcpServerInput['commands']['recordCancelRunOutcome']>[0],
  outcome: Parameters<BuildTaskManagementSdkMcpServerInput['commands']['recordCancelRunOutcome']>[1]
): Promise<void> {
  try {
    await input.commands.recordCancelRunOutcome(prepared, outcome)
  } catch {
    // A failed audit must not rewrite the already determined host outcome.
    throw new TaskAutomationCommandError('task-internal-error')
  }
}

function parseCancelRunRequest(value: Record<string, unknown>): {
  taskId: string
  runLogId: string
  expectedRevision: number
} {
  return {
    taskId: parseId(value.taskId),
    runLogId: parseId(value.runLogId),
    expectedRevision: parseRevision(value.expectedRevision)
  }
}

function parseId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxIdLength) {
    throw new TaskAutomationCommandError('task-request-invalid')
  }
  return value.trim()
}

function parseRevision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new TaskAutomationCommandError('task-request-invalid')
  }
  return value
}

function textResult(output: unknown): TaskManagementSdkToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(output) }]
  }
}

function safeTaskToolErrorMessage(error: unknown): string {
  if (error instanceof TaskAutomationCommandError) return error.code
  if (error instanceof DOMException && error.name === 'AbortError') return 'Aborted'
  return 'task-internal-error'
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal) throwIfAbortSignalAborted(signal)
}

function createTaskToolCallId(): string {
  return `task-tool-call-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

async function defaultLoadTaskManagementSdkHelpers(): Promise<TaskManagementSdkModule | null> {
  try {
    return (await import('@anthropic-ai/claude-agent-sdk')) as TaskManagementSdkModule
  } catch {
    return null
  }
}
