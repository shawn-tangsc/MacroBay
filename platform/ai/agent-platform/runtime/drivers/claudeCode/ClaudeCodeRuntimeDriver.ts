import type { AgentChatRuntimeRequest, AgentChatRuntimeResult } from '../../agentChatRuntime'
import type { AgentRuntimeComposition } from '../../AgentRuntimeCompositionService'
import type {
  AgentRuntimeStopReason,
  AgentRuntimeDriver,
  AgentRuntimeDriverContext,
  AgentRuntimePrewarmSessionRequest,
  AgentRuntimePrewarmSessionResult,
  AgentRuntimeToolApprovalRequestChunk,
  AgentRuntimeSessionChunk,
  ToolApprovalRequestInput
} from '../../runtimeTypes'
import type { ToolApprovalDecision } from '../../policy'
import { throwIfAbortSignalAborted } from '../../runtimeAbort'
import { DEFAULT_SYSTEM_WORKSPACE_PATH } from '../../../schemas/workspaceSchemas'
import {
  buildClaudeCodeSettingsFromComposition,
  type ClaudeCodeCompositionSettings,
  type ClaudeCodeSettingsBuilderOptions
} from './ClaudeCodeSettingsBuilder'
import type {
  ClaudeCodeProviderEnvironmentMetadata,
  ClaudeCodeProviderEnvironmentResult,
  ClaudeCodeProviderEnvironmentSuccess
} from './ClaudeCodeProviderEnvironment'
import { createClaudeCodeExecutorDescriptor, type ClaudeCodeExecutorDescriptor } from './ClaudeCodeExecutorDescriptor'
import { createClaudeCodeQueryOptionsFromSettings, type ClaudeCodeQueryOptions } from './ClaudeCodeQueryOptions'
import { createClaudeCodeToolHooks, type ClaudeCodeToolHooks } from './ClaudeCodeToolHooks'

export type ClaudeCodeRuntimeExecutionInput = {
  request: AgentChatRuntimeRequest
  composition: AgentRuntimeComposition
  runId: string
  settings: ClaudeCodeCompositionSettings
  providerMetadata?: ClaudeCodeProviderEnvironmentMetadata
  query: ClaudeCodeQueryOptions
  toolHooks: ClaudeCodeToolHooks
  executor: ClaudeCodeExecutorDescriptor
  requestToolApproval: (input: ToolApprovalRequestInput) => Promise<ToolApprovalDecision>
  emitChunk: (chunk: AgentRuntimeSessionChunk) => void
  signal: AbortSignal
}

export type ClaudeCodeRuntimePrewarmInput = {
  sessionId: string
  composition: AgentRuntimeComposition
  settings: ClaudeCodeCompositionSettings
  providerMetadata?: ClaudeCodeProviderEnvironmentMetadata
  query: ClaudeCodeQueryOptions
  toolHooks: ClaudeCodeToolHooks
  executor: ClaudeCodeExecutorDescriptor
  requestToolApproval: (input: ToolApprovalRequestInput) => Promise<ToolApprovalDecision>
  emitChunk: (chunk: AgentRuntimeSessionChunk) => void
}

export type ClaudeCodeWorkspacePreparationInput = {
  sessionId: string
  workspacePath: string
  workspaceType: AgentRuntimeComposition['workspaceType']
}

export type ClaudeCodeWorkspacePreparationResult = {
  cwd: string
}

export type ClaudeCodeRuntimeDriverDependencies = ClaudeCodeSettingsBuilderOptions & {
  prepareWorkspace?: (input: ClaudeCodeWorkspacePreparationInput) => Promise<ClaudeCodeWorkspacePreparationResult>
  resolveProviderEnvironment?: (uniqueModelId: string) => Promise<ClaudeCodeProviderEnvironmentResult>
  emitChunk?: (chunk: AgentRuntimeSessionChunk) => void
  requestToolApproval?: (input: ToolApprovalRequestInput) => Promise<ToolApprovalDecision>
  executeTurn?: (input: ClaudeCodeRuntimeExecutionInput) => Promise<AgentChatRuntimeResult>
  prewarmSession?: (input: ClaudeCodeRuntimePrewarmInput) => Promise<AgentRuntimePrewarmSessionResult>
}

type ActiveClaudeCodeRun = {
  runId: string
  sessionId: string
  controller: AbortController
}

export class ClaudeCodeRuntimeDriver implements AgentRuntimeDriver {
  private readonly activeRunsByRunId = new Map<string, ActiveClaudeCodeRun>()
  private readonly activeRunIdsBySessionId = new Map<string, Set<string>>()

  constructor(private readonly deps: ClaudeCodeRuntimeDriverDependencies = {}) {}

  async sendMessage(
    request: AgentChatRuntimeRequest,
    context?: AgentRuntimeDriverContext
  ): Promise<AgentChatRuntimeResult> {
    const runId = request.runId ?? createRunId()
    const activeRun = this.createActiveRun(runId, request.sessionId)

    try {
      const runtimeInput = await this.buildRuntimeInput(context, activeRun.controller)
      throwIfAbortSignalAborted(activeRun.controller.signal)

      return await this.requireExecutor()({
        request,
        composition: runtimeInput.composition,
        runId,
        settings: runtimeInput.settings,
        ...(runtimeInput.providerMetadata ? { providerMetadata: runtimeInput.providerMetadata } : {}),
        query: runtimeInput.query,
        toolHooks: runtimeInput.toolHooks,
        executor: runtimeInput.executor,
        requestToolApproval: runtimeInput.requestToolApproval,
        emitChunk: runtimeInput.emitChunk,
        signal: activeRun.controller.signal
      })
    } finally {
      this.deleteActiveRun(activeRun)
    }
  }

  async prewarmSession(
    request: AgentRuntimePrewarmSessionRequest,
    context?: AgentRuntimeDriverContext
  ): Promise<AgentRuntimePrewarmSessionResult> {
    if (!this.deps.prewarmSession) {
      return {
        ok: false,
        reason: 'prewarm-unavailable',
        message: 'Claude Code runtime prewarm is not wired yet.'
      }
    }

    const controller = new AbortController()
    const runtimeInput = await this.buildRuntimeInput(context, controller)
    return this.deps.prewarmSession({
      sessionId: request.sessionId,
      composition: runtimeInput.composition,
      settings: runtimeInput.settings,
      ...(runtimeInput.providerMetadata ? { providerMetadata: runtimeInput.providerMetadata } : {}),
      query: runtimeInput.query,
      toolHooks: runtimeInput.toolHooks,
      executor: runtimeInput.executor,
      requestToolApproval: runtimeInput.requestToolApproval,
      emitChunk: runtimeInput.emitChunk
    })
  }

  cancelMessage(runId: string, reason?: AgentRuntimeStopReason): boolean {
    const activeRun = this.activeRunsByRunId.get(runId)
    if (!activeRun) return false
    activeRun.controller.abort(reason?.kind ?? 'user-stop')
    return true
  }

  cancelSession(sessionId: string, reason?: AgentRuntimeStopReason): boolean {
    const runIds = this.activeRunIdsBySessionId.get(sessionId)
    if (!runIds || runIds.size === 0) return false

    for (const runId of [...runIds]) {
      this.activeRunsByRunId.get(runId)?.controller.abort(reason?.kind ?? 'user-stop')
    }
    return true
  }

  async requestToolApproval(input: ToolApprovalRequestInput): Promise<ToolApprovalDecision> {
    if (!this.deps.emitChunk) {
      return {
        behavior: 'deny',
        message: 'Tool approval emitter not ready.'
      }
    }

    const requestToolApproval = this.deps.requestToolApproval
    if (!requestToolApproval) {
      return {
        behavior: 'deny',
        message: 'Tool approval requester not ready.'
      }
    }

    const approvalId = input.approvalId ?? createApprovalId()
    const approvalInput = {
      ...input,
      approvalId
    }

    this.emitChunk(createToolApprovalRequestChunk(approvalInput))
    return requestToolApproval(approvalInput)
  }

  private emitChunk(chunk: AgentRuntimeSessionChunk): void {
    this.deps.emitChunk?.(chunk)
  }

  private createActiveRun(runId: string, sessionId: string): ActiveClaudeCodeRun {
    const activeRun: ActiveClaudeCodeRun = {
      runId,
      sessionId,
      controller: new AbortController()
    }
    this.activeRunsByRunId.set(runId, activeRun)

    const sessionRunIds = this.activeRunIdsBySessionId.get(sessionId) ?? new Set<string>()
    sessionRunIds.add(runId)
    this.activeRunIdsBySessionId.set(sessionId, sessionRunIds)
    return activeRun
  }

  private deleteActiveRun(activeRun: ActiveClaudeCodeRun): void {
    this.activeRunsByRunId.delete(activeRun.runId)

    const sessionRunIds = this.activeRunIdsBySessionId.get(activeRun.sessionId)
    if (!sessionRunIds) return
    sessionRunIds.delete(activeRun.runId)
    if (sessionRunIds.size === 0) {
      this.activeRunIdsBySessionId.delete(activeRun.sessionId)
    }
  }

  private requireExecutor(): NonNullable<ClaudeCodeRuntimeDriverDependencies['executeTurn']> {
    if (!this.deps.executeTurn) {
      throw new Error('Claude Code runtime executor is not wired yet.')
    }
    return this.deps.executeTurn
  }

  private async prepareWorkspaceSettings(
    composition: AgentRuntimeComposition,
    settings: ClaudeCodeCompositionSettings
  ): Promise<ClaudeCodeCompositionSettings> {
    const workspacePath = requireWorkspacePath(composition)
    if (!this.deps.prepareWorkspace) {
      return {
        ...settings,
        cwd: workspacePath
      }
    }

    const prepared = await this.deps.prepareWorkspace({
      sessionId: composition.sessionId,
      workspacePath,
      workspaceType: composition.workspaceType
    })

    return {
      ...settings,
      cwd: prepared.cwd
    }
  }

  private async resolveProviderEnvironment(
    uniqueModelId: string
  ): Promise<ClaudeCodeProviderEnvironmentSuccess | undefined> {
    if (!this.deps.resolveProviderEnvironment) return undefined

    const result = await this.deps.resolveProviderEnvironment(uniqueModelId)
    // Some hosts only provide the resolver for gating and return nothing; treat that as "route
    // unknown" instead of failing the turn.
    if (!result) return undefined
    if (!result.ok) {
      throw new Error(result.message)
    }
    return result
  }

  private async buildRuntimeInput(
    context: AgentRuntimeDriverContext | undefined,
    abortController: AbortController
  ): Promise<ClaudeCodeRuntimePrewarmInput> {
    if (!context?.composition) {
      throw new Error('Claude Code runtime driver requires AgentRuntimeDriverContext.composition.')
    }

    throwIfAbortSignalAborted(abortController.signal)
    const composition = context.composition
    const modelId = requireModelId(composition)
    // Resolve the provider route first: whether the endpoint can carry Anthropic server-side web
    // tools decides the allowed/disallowed tool lists, and the SDK must never receive an
    // unsupported `web_search` schema.
    const providerEnvironment = await this.resolveProviderEnvironment(modelId)
    throwIfAbortSignalAborted(abortController.signal)
    const baseSettings = buildClaudeCodeSettingsFromComposition(composition, {
      defaultEnv: this.deps.defaultEnv,
      ...(providerEnvironment
        ? { serverWebToolsSupported: providerEnvironment.metadata.serverWebToolsSupported }
        : {})
    })
    const settings = await this.prepareWorkspaceSettings(composition, baseSettings)
    throwIfAbortSignalAborted(abortController.signal)
    const query = createClaudeCodeQueryOptionsFromSettings({
      modelId: providerEnvironment?.modelId ?? modelId,
      settings,
      providerEnv: providerEnvironment?.env,
      abortController,
      effectiveResume: context.lastResumeToken ?? undefined,
      ...(providerEnvironment?.metadata.modelReasoningSupported === undefined
        ? {}
        : { modelSupportsReasoning: providerEnvironment.metadata.modelReasoningSupported })
    })
    const requestToolApproval = (input: ToolApprovalRequestInput) => this.requestToolApproval(input)
    const toolHooks = createClaudeCodeToolHooks({
      sessionId: composition.sessionId,
      toolPolicy: query.runtimeMetadata.toolPolicy,
      requestToolApproval,
      onDecision: ({ toolCallId }, decision) => {
        if (decision.behavior !== 'deny' || !toolCallId) {
          return
        }
        this.emitChunk({
          type: 'tool-output-denied',
          sessionId: composition.sessionId,
          toolCallId,
          message: decision.message
        })
      }
    })
    const executor = createClaudeCodeExecutorDescriptor({
      query,
      toolHooks,
      signal: abortController.signal,
      ...(providerEnvironment ? { providerMetadata: providerEnvironment.metadata } : {})
    })

    return {
      sessionId: composition.sessionId,
      composition,
      settings,
      ...(providerEnvironment ? { providerMetadata: providerEnvironment.metadata } : {}),
      query,
      toolHooks,
      executor,
      requestToolApproval,
      emitChunk: (chunk) => this.emitChunk(chunk)
    }
  }
}

function createRunId(): string {
  return `claude-run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function requireModelId(composition: AgentRuntimeComposition): string {
  if (!composition.modelId) {
    throw new Error('Claude Code runtime driver requires a model id in runtime composition.')
  }
  return composition.modelId
}

function requireWorkspacePath(composition: AgentRuntimeComposition): string {
  const workspacePath = composition.workspacePath?.trim()
  if (workspacePath) return workspacePath
  if (composition.workspaceType === 'system') return DEFAULT_SYSTEM_WORKSPACE_PATH
  if (!workspacePath) {
    throw new Error('Claude Code runtime driver requires a workspace path in runtime composition.')
  }
  return workspacePath
}

function createToolApprovalRequestChunk(
  input: ToolApprovalRequestInput
): AgentRuntimeToolApprovalRequestChunk {
  return {
    type: 'tool-approval-request',
    approvalId: input.approvalId ?? createApprovalId(),
    sessionId: input.sessionId,
    toolCallId: input.toolCallId,
    providerMetadata: {
      claudeAgent: {
        transport: 'claude-agent',
        toolName: input.toolName
      }
    }
  }
}

function createApprovalId(): string {
  return `tool-approval-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
