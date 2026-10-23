import type { AgentRuntimeControl } from '../../ai/agent-platform/runtime/runtimeTypes'
import type { AgentPlatformServices } from '../../ai/agent-platform/services'
import type { UpdateAgentDto } from '../../ai/agent-platform/schemas/agentSchemas'
import type { CreateTaskDto, UpdateTaskDto } from '../../ai/agent-platform/schemas/taskSchemas'
import type { Trigger } from '../../ai/agent-platform/schemas/taskSchemas'
import { selectAgentSession } from '../../ai/agent-platform/store/agentStore'
import type {
  AgentMentionedModelDescriptor,
  AgentSessionMessagesListQuery,
  ListAgentSessionsQuery,
  UpdateAgentSessionDto
} from '../../ai/agent-platform/schemas/sessionSchemas'
import type { CreateAgentSessionDto } from '../../ai/agent-platform/schemas/sessionSchemas'
import type { AgentSessionWorkspaceSource } from '../../ai/agent-platform/schemas/workspaceSchemas'
import type { AgentChatRuntimeRequest, AgentChatRuntimeResult } from '../../ai/agent-platform/runtime/agentChatRuntime'
import type { ToolApprovalDecision } from '../../ai/agent-platform/runtime/policy'
import type { AgentSkillsRuntimeCatalog } from '../../ai/agent-platform/skills/skillRuntimeSchemas'
import type { AgentStoreState } from '../../ai/agent-platform/store/agentStore'
import type { AgentChannelRuntimeSnapshot } from '../../ai/agent-platform/channels/ChannelRuntimeService'
import { addRuntimeErrorTurnToState, buildRuntimeTurnResult } from '../../ai/agent-platform/runtime/agentTurnPersistence'
import type { AgentRuntimeId } from '../../ai/agent-platform/runtime/compatibility/agentRuntimeCompatibilityTypes'
import {
  executeAndPersistRuntimeCommand,
  isAgentRuntimeCommandName,
  type AgentRuntimeCommandName
} from '../../ai/agent-platform/runtime/commands'
import type { AgentRuntimeComposition } from '../../ai/agent-platform/runtime/AgentRuntimeCompositionService'
import type { AgentModelCompatibilityControl } from './agentModelCompatibility/createAgentModelCompatibilityControl'

type AgentTaskRunner = {
  runTask: (agentId: string, taskId: string, expectedRevision: number) => Promise<{ taskId: string; runLogId: string }>
}

type AgentTaskRunController = {
  cancelTaskRun: (runLogId: string) => Promise<{
    runLogId: string
    jobRunId: string | null
    cancelled: boolean
  }>
}

type AgentTaskDeliveryRetry = {
  retryTaskDelivery: (agentId: string, runLogId: string, attemptId: string) => Promise<unknown>
}

type AgentSkillRuntimeReader = {
  getSkillRuntime: (agentId: string) => Promise<AgentSkillsRuntimeCatalog> | AgentSkillsRuntimeCatalog
}

type AgentProductToolReader = {
  listProductToolPackages: (agentId: string) => Promise<unknown[]> | unknown[]
  updateProductToolPackageBinding: (
    agentId: string,
    productId: string,
    permissionMode: 'allow-read-only' | 'prompt' | 'disabled'
  ) => Promise<AgentStoreState>
  listProductToolCallTracePage: (query: {
    agentSessionId?: string
    productId?: string
    consumerProductId?: string
    cursor?: string
    limit?: number
  }) => Promise<{ items: unknown[]; nextCursor?: string }>
  getProductToolCallTrace: (toolCallId: string) => Promise<unknown | null>
}

type AgentChannelRuntimeReader = {
  getChannelRuntimeSnapshot: (
    options?: { includeDiagnostics?: boolean }
  ) => Promise<AgentChannelRuntimeSnapshot> | AgentChannelRuntimeSnapshot
  restartChannelRuntime?: (
    channelId: string
  ) => Promise<AgentChannelRuntimeSnapshot> | AgentChannelRuntimeSnapshot
}

type AgentRuntimeCommandComposer = {
  compose: (input: {
    state: AgentStoreState
    agentId: string
    sessionId: string
  }) => AgentRuntimeComposition | Promise<AgentRuntimeComposition>
}

export function createAgentIpcHandlers(
  services: AgentPlatformServices,
  runtime?: AgentRuntimeControl,
  taskRunner?: AgentTaskRunner,
  taskRunController?: AgentTaskRunController,
  skillRuntimeReader?: AgentSkillRuntimeReader,
  productToolReader?: AgentProductToolReader,
  channelRuntimeReader?: AgentChannelRuntimeReader,
  modelCompatibility?: AgentModelCompatibilityControl,
  runtimeCommandComposer?: AgentRuntimeCommandComposer,
  taskDeliveryRetry?: AgentTaskDeliveryRetry
) {
  return {
    getState: () => services.state.getState(),
    getRuntimeSnapshot: () =>
      runtime?.getSnapshot?.() ?? {
        sessions: {},
        toolApprovals: [],
        toolApprovalHistory: [],
        chunksBySessionId: {},
        updatedAt: new Date().toISOString()
      },
    getChannelRuntimeSnapshot: async (options?: { includeDiagnostics?: boolean }) =>
      channelRuntimeReader?.getChannelRuntimeSnapshot(options) ??
      {
        channels: []
      },
    restartChannelRuntime: async (channelId: string) => {
      if (!channelRuntimeReader?.restartChannelRuntime) {
        throw new Error('Channel runtime control is not available.')
      }
      return channelRuntimeReader.restartChannelRuntime(channelId)
    },
    listToolApprovals: () => runtime?.listToolApprovals?.() ?? [],
    resolveToolApproval: (approvalId: string, decision: ToolApprovalDecision) =>
      runtime?.resolveToolApproval?.(approvalId, decision) ??
      {
        sessions: {},
        toolApprovals: [],
        toolApprovalHistory: [],
        chunksBySessionId: {},
        updatedAt: new Date().toISOString()
      },
    sendMessage: async (request: AgentChatRuntimeRequest): Promise<AgentChatRuntimeResult> => {
      if (!runtime) throw new Error('Agent runtime is not available.')
      try {
        return await runtime.sendMessage(request)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const state = await services.state.getState()
        const existingMessages = state.messagesBySessionId[request.sessionId] ?? []
        const assistantMessageId = `assistant-${request.runId ?? `error-${Date.now().toString(36)}`}`
        if (existingMessages.some((item) => item.id === assistantMessageId)) {
          return buildRuntimeTurnResult(state, request.sessionId, assistantMessageId)
        }
        const agent = state.agents.find((item) => item.id === request.agentId)
        const nextState = addRuntimeErrorTurnToState(state, {
          sessionId: request.sessionId,
          text: request.text,
          errorText: message,
          assistantMessageId,
          modelId: agent?.model ?? null,
          modelName: agent?.modelName ?? null,
          mentionedModels: normalizeFallbackMentionedModels(request.mentionedModels),
          ...(request.displayText ? { displayText: request.displayText } : {}),
          ...(request.context ? { context: request.context } : {})
        })
        await services.state.replace(nextState)
        return buildRuntimeTurnResult(nextState, request.sessionId, assistantMessageId)
      }
    },
    listAgents: (query: Parameters<typeof services.agents.list>[0] = {}) => services.agents.list(query),
    getSkillRuntime: async (agentId: string) =>
      skillRuntimeReader?.getSkillRuntime(agentId) ??
      {
        agentId,
        skills: []
      },
    createAgent: (dto: Parameters<typeof services.agents.create>[0]) => services.agents.create(dto),
    listTasks: (agentId: string, query: Parameters<typeof services.tasks.list>[1] = {}) =>
      services.tasks.list(agentId, query),
    getTaskLogs: (agentId: string, taskId: string, query: Parameters<typeof services.tasks.getLogs>[2] = {}) =>
      services.tasks.getLogs(agentId, taskId, query),
    previewTaskSchedule: (trigger: Trigger) => services.taskAutomation.previewTaskSchedule(trigger),
    listTaskPage: (query: Parameters<typeof services.taskAutomation.listTaskPage>[0] = {}) =>
      services.taskAutomation.listTaskPage(query),
    getTaskDeliveryAttempts: (agentId: string, runLogId: string, query: { limit?: number; offset?: number } = {}) =>
      services.taskAutomation.getTaskDeliveryAttempts(agentId, runLogId, query),
    retryTaskDelivery: (agentId: string, runLogId: string, attemptId: string) => {
      if (!taskDeliveryRetry) throw new Error('Task delivery retry is not available.')
      return taskDeliveryRetry.retryTaskDelivery(agentId, runLogId, attemptId)
    },
    listTaskMutationAudits: (query: Parameters<typeof services.taskAutomation.listTaskMutationAudits>[0]) =>
      services.taskAutomation.listTaskMutationAudits(query),
    getTaskAutomationPolicy: () => services.taskAutomation.getTaskAutomationPolicy(),
    updateTaskAutomationPolicy: (input: { policyPreset: 'balanced' | 'conservative' }) =>
      services.taskAutomation.updateTaskAutomationPolicy(input),
    getTaskDeliveryReadiness: (agentId: string, taskId: string) =>
      services.taskAutomation.getTaskDeliveryReadiness(agentId, taskId),
    createTask: (agentId: string, dto: CreateTaskDto) => services.tasks.create(agentId, dto),
    updateTask: (agentId: string, taskId: string, request: { expectedRevision: number; patch: UpdateTaskDto }) =>
      services.tasks.update(agentId, taskId, request),
    deleteTask: (agentId: string, taskId: string, request: { expectedRevision: number }) =>
      services.tasks.delete(agentId, taskId, request),
    runTask: async (agentId: string, taskId: string, request: { expectedRevision: number }) => {
      if (!taskRunner) throw new Error('Agent task runner is not available.')
      return taskRunner.runTask(agentId, taskId, request.expectedRevision)
    },
    cancelTaskRun: (runLogId: string) => {
      if (!taskRunController) throw new Error('Agent task run controller is not available.')
      return taskRunController.cancelTaskRun(runLogId)
    },
    listSessions: (query: ListAgentSessionsQuery = {}) => services.sessions.listByCursor(query),
    listSessionMessages: (sessionId: string, query: AgentSessionMessagesListQuery = {}) =>
      services.messages.listSessionMessages(sessionId, query),
    createSession: (dto: CreateAgentSessionDto) => services.sessions.create(dto),
    updateAgent: (agentId: string, patch: UpdateAgentDto) => services.agents.update(agentId, patch),
    deleteAgent: async (agentId: string) => {
      await services.agents.delete(agentId)
      return services.state.getState()
    },
    reorderAgents: async (orderedAgentIds: string[]) => {
      await services.agents.reorder(orderedAgentIds)
      return services.state.getState()
    },
    selectAgent: (agentId: string) => services.agents.select(agentId),
    updateSession: (sessionId: string, patch: UpdateAgentSessionDto) => services.sessions.update(sessionId, patch),
    deleteSessions: (sessionIds: string[]) => services.sessions.deleteByIds(sessionIds),
    reorderSessions: async (orderedSessionIds: string[]) => {
      await services.sessions.reorderBatch(orderedSessionIds)
      return services.state.getState()
    },
    setSessionAgent: (sessionId: string, agentId: string | null) => services.sessions.setAgent(sessionId, agentId),
    setSessionWorkspace: (sessionId: string, source: AgentSessionWorkspaceSource) =>
      services.sessions.setWorkspace(sessionId, source),
    setSessionWorkspaceByPath: (sessionId: string, rawPath: string) =>
      services.sessions.setWorkspaceByPath(sessionId, rawPath),
    toggleSessionPin: (sessionId: string) => services.sessions.togglePin(sessionId),
    clearSessionMessages: (sessionId: string) => services.messages.clearSessionMessages(sessionId),
    deleteSessionMessage: async (sessionId: string, messageId: string) => {
      await services.messages.deleteSessionMessage(sessionId, messageId)
      return services.state.getState()
    },
    cancelSession: (sessionId: string) => runtime?.cancelSession(sessionId) ?? false,
    selectSession: async (sessionId: string) =>
      services.state.update((state) => selectAgentSession(state, sessionId), { activeSelectionRowOnly: true }),
    listProductToolPackages: (agentId: string) =>
      productToolReader?.listProductToolPackages(agentId) ?? Promise.resolve([]),
    updateProductToolPackageBinding: (
      agentId: string,
      productId: string,
      permissionMode: 'allow-read-only' | 'prompt' | 'disabled'
    ) => {
      if (!productToolReader) throw new Error('Product agent tool reader is not available.')
      return productToolReader.updateProductToolPackageBinding(agentId, productId, permissionMode)
    },
    listProductToolCallTracePage: (query: {
      agentSessionId?: string
      productId?: string
      consumerProductId?: string
      cursor?: string
      limit?: number
    }) => productToolReader?.listProductToolCallTracePage(query) ?? Promise.resolve({ items: [] }),
    getProductToolCallTrace: (toolCallId: string) =>
      productToolReader?.getProductToolCallTrace(toolCallId) ?? Promise.resolve(null),
    getRuntimeCompatibility: (providerId: string, modelId: string, runtimeId: AgentRuntimeId) => {
      if (!modelCompatibility) {
        throw new Error('Agent model compatibility control is not available.')
      }
      return modelCompatibility.getRuntimeCompatibility(providerId, modelId, runtimeId)
    },
    probeRuntimeCompatibility: (providerId: string, modelId: string, runtimeId: AgentRuntimeId) => {
      if (!modelCompatibility) {
        throw new Error('Agent model compatibility control is not available.')
      }
      return modelCompatibility.probeRuntimeCompatibility(providerId, modelId, runtimeId)
    },
    getModelGatewayStatus: () => {
      if (!modelCompatibility) {
        throw new Error('Agent model compatibility control is not available.')
      }
      return modelCompatibility.getModelGatewayStatus()
    },
    startModelGateway: (providerId?: string, modelId?: string) => {
      if (!modelCompatibility) {
        throw new Error('Agent model compatibility control is not available.')
      }
      return modelCompatibility.startModelGateway(providerId, modelId)
    },
    stopModelGateway: () => {
      if (!modelCompatibility) {
        throw new Error('Agent model compatibility control is not available.')
      }
      return modelCompatibility.stopModelGateway()
    },
    setModelGatewayEnabled: async (enabled: boolean) => {
      if (!modelCompatibility) {
        throw new Error('Agent model compatibility control is not available.')
      }
      return modelCompatibility.setModelGatewayEnabled(enabled)
    },
    executeRuntimeCommand: async (input: {
      command: string
      agentId: string
      sessionId: string
    }) => {
      if (!isAgentRuntimeCommandName(input.command)) {
        throw new Error(`Unsupported runtime command: ${input.command}`)
      }
      const state = await services.state.getState()
      let composition: AgentRuntimeComposition | null = null
      try {
        composition = await runtimeCommandComposer?.compose({
          state,
          agentId: input.agentId,
          sessionId: input.sessionId
        }) ?? null
      } catch {
        composition = null
      }
      const persisted = executeAndPersistRuntimeCommand({
        command: input.command as AgentRuntimeCommandName,
        agentId: input.agentId,
        sessionId: input.sessionId,
        state,
        composition,
        runtimeSnapshot: runtime?.getSnapshot?.() ?? null
      })
      await services.state.replace(persisted.state)
      return {
        state: persisted.state,
        command: persisted.output.command,
        result: persisted.output.result,
        text: persisted.output.text,
        messageId: persisted.messageId
      }
    }
  }
}

function normalizeFallbackMentionedModels(
  models: AgentChatRuntimeRequest['mentionedModels']
): AgentMentionedModelDescriptor[] {
  return (models ?? []).map((item) => {
    const id = typeof item === 'string' ? item : item.id
    const fallback = fallbackMentionedModelNames(id)
    return {
      id,
      label: typeof item === 'string' ? fallback.label : item.label?.trim() || fallback.label,
      providerName: typeof item === 'string' ? fallback.providerName : item.providerName?.trim() || fallback.providerName
    }
  })
}

function fallbackMentionedModelNames(id: string): { label: string; providerName: string } {
  const separatorIndex = id.indexOf(':')
  if (separatorIndex <= 0 || separatorIndex === id.length - 1) {
    return { label: id, providerName: 'unknown' }
  }
  return {
    label: id.slice(separatorIndex + 1),
    providerName: id.slice(0, separatorIndex)
  }
}
