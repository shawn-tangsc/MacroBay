import type { AgentChatRuntimeRequest, AgentChatRuntimeResult } from '../../ai/agent-platform/runtime/agentChatRuntime'
import { buildRuntimeTurnResult, createRuntimeTextData } from '../../ai/agent-platform/runtime/agentTurnPersistence'
import type { AgentRuntimeDriver } from '../../ai/agent-platform/runtime/runtimeTypes'
import type { TaskManagementToolRuntimeService } from '../../ai/agent-platform/runtime/tasks/TaskManagementToolRuntimeService'
import type { AgentChannelRuntimeHost } from '../../ai/agent-platform/channels/channelRuntimeHost'
import { addAgentSessionMessage, type AgentStoreSeed, type AgentStoreState } from '../../ai/agent-platform/store/agentStore'

export const TASK_AUTOMATION_SMOKE_AGENT_ID = 'task-smoke-agent'
export const TASK_AUTOMATION_SMOKE_CREATE_PROMPT = 'QA_SMOKE_CREATE_TASK'
export const TASK_AUTOMATION_SMOKE_RUNTIME_FAILURE_PROMPT = 'QA_SMOKE_RUNTIME_FAILURE'

const smokeSessionId = 'task-smoke-session'
const smokeWorkspaceId = 'task-smoke-workspace'

export function createTaskAutomationSmokeSeed(createdAt: string): AgentStoreSeed {
  const workspace = {
    id: smokeWorkspaceId,
    name: 'Task smoke workspace',
    path: '/tmp/task-automation-smoke-workspace',
    type: 'system' as const,
    orderKey: '0001',
    createdAt,
    updatedAt: createdAt
  }
  return {
    agents: [{
      id: TASK_AUTOMATION_SMOKE_AGENT_ID,
      type: 'claude-code',
      name: 'Task smoke agent',
      model: null,
      modelName: null,
      orderKey: '0001',
      createdAt,
      updatedAt: createdAt,
      configuration: { permission_mode: 'bypassPermissions' }
    }],
    workspaces: [workspace],
    sessions: [{
      id: smokeSessionId,
      agentId: TASK_AUTOMATION_SMOKE_AGENT_ID,
      name: 'Task smoke session',
      workspaceId: workspace.id,
      workspace,
      orderKey: '0001',
      createdAt,
      updatedAt: createdAt
    }],
    channels: [
      {
        id: 'task-smoke-loopback',
        type: 'telegram',
        name: 'Task smoke loopback',
        agentId: TASK_AUTOMATION_SMOKE_AGENT_ID,
        workspace: { type: 'system' },
        config: { bot_token: 'loopback-only' },
        activeChatIds: ['task-smoke-chat'],
        isActive: true,
        createdAt,
        updatedAt: createdAt
      },
      {
        id: 'task-smoke-inactive',
        type: 'telegram',
        name: 'Task smoke inactive',
        agentId: TASK_AUTOMATION_SMOKE_AGENT_ID,
        workspace: { type: 'system' },
        config: { bot_token: 'loopback-only' },
        activeChatIds: [],
        isActive: false,
        createdAt,
        updatedAt: createdAt
      }
    ],
    activeAgentId: TASK_AUTOMATION_SMOKE_AGENT_ID,
    activeSessionId: smokeSessionId
  }
}

export function createTaskAutomationSmokeDriver(deps: {
  getState: () => Promise<AgentStoreState>
  saveState: (state: AgentStoreState, sessionId: string) => Promise<void>
  taskTools: Pick<TaskManagementToolRuntimeService, 'invoke'>
}): AgentRuntimeDriver {
  let turnSequence = 0
  return {
    async sendMessage(request): Promise<AgentChatRuntimeResult> {
      turnSequence += 1
      const turnId = request.runId ?? `chat-${turnSequence}`
      const userMessageId = `task-smoke-user-${turnId}`
      const assistantMessageId = `task-smoke-assistant-${turnId}`
      let state = await deps.getState()
      state = addAgentSessionMessage(state, request.sessionId, {
        id: userMessageId,
        role: 'user',
        status: 'success',
        data: createRuntimeTextData(request.text)
      })
      await deps.saveState(state, request.sessionId)

      const response = await resolveSmokeResponse(deps.taskTools, request)
      state = await deps.getState()
      state = addAgentSessionMessage(state, request.sessionId, {
        id: assistantMessageId,
        role: 'assistant',
        status: 'success',
        data: createRuntimeTextData(response),
        modelId: null,
        modelSnapshot: null,
        stats: null
      })
      await deps.saveState(state, request.sessionId)
      return buildRuntimeTurnResult(state, request.sessionId, assistantMessageId)
    },
    cancelMessage: () => false,
    cancelSession: () => false
  }
}

export function createTaskAutomationSmokeLoopbackHost(
  deliveredMessages: Array<{ chatId: string; text: string }>
): AgentChannelRuntimeHost {
  let shouldFail = true
  return {
    connect: async () => undefined,
    close: async () => undefined,
    sendMessage: async (chatId, text) => {
      if (shouldFail) {
        shouldFail = false
        throw new Error('task-smoke-delivery-failed')
      }
      deliveredMessages.push({ chatId, text })
    }
  }
}

async function createFixtureTask(
  taskTools: Pick<TaskManagementToolRuntimeService, 'invoke'>,
  request: AgentChatRuntimeRequest
): Promise<string> {
  const result = await taskTools.invoke({
    agentId: request.agentId,
    sessionId: request.sessionId,
    toolCallId: 'task-smoke-tool-create',
    toolName: 'scheduled_task_create',
    input: {
      name: 'Task smoke tool task',
      prompt: 'Task smoke local success',
      trigger: { kind: 'interval', ms: 300_000 },
      workspace: { type: 'system' },
      channelIds: []
    }
  })
  if (!isCreatedTaskResult(result)) return 'Task smoke fixture could not create a local scheduled task.'
  return 'Task smoke fixture created a local scheduled task.'
}

async function resolveSmokeResponse(
  taskTools: Pick<TaskManagementToolRuntimeService, 'invoke'>,
  request: AgentChatRuntimeRequest
): Promise<string> {
  if (request.text === TASK_AUTOMATION_SMOKE_CREATE_PROMPT) {
    return createFixtureTask(taskTools, request)
  }
  if (request.text === TASK_AUTOMATION_SMOKE_RUNTIME_FAILURE_PROMPT) {
    throw new Error('task-smoke-runtime-failed')
  }
  return 'Task smoke fixture received a local message.'
}

function isCreatedTaskResult(value: unknown): value is { task: { id: string } } {
  if (!value || typeof value !== 'object' || !('task' in value)) return false
  const task = value.task
  return Boolean(task && typeof task === 'object' && 'id' in task && typeof task.id === 'string' && task.id)
}
