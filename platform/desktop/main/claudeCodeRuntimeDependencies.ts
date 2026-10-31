import { mkdir, realpath, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'

import type {
  ClaudeCodeAgentSdkOptions,
  ClaudeCodeAgentSdkQueryRequest,
  ClaudeCodeRuntimeExecutionInput,
  ClaudeCodeProviderEnvironmentOptions,
  ClaudeCodeProviderEnvironmentResult,
  ClaudeCodeRuntimeDriverDependencies,
  ClaudeCodeWorkspacePreparationInput,
  ClaudeCodeWorkspacePreparationResult
} from '../../ai/agent-platform/runtime/drivers/claudeCode'
import {
  AgentTurnOutputTruncatedError,
  buildAgentTurnOutputTruncatedDiagnosticText,
  buildClaudeCodeSkillContext,
  buildClaudeCodeSystemPromptAppend,
  createClaudeCodeAgentSdkOptions,
  createClaudeCodeProviderEnvironment,
  isClaudeCodeOutputTruncationErrorCode,
  isClaudeCodeOutputTruncationStopReason
} from '../../ai/agent-platform/runtime/drivers/claudeCode'
import { buildProductAgentToolSdkMcpServers } from './buildProductAgentToolSdkMcpServers'
import { buildPlatformWebSearchSdkMcpServer, type PlatformWebSearchBridge } from './buildPlatformWebSearchSdkMcpServer'
import { platformWebSearchSessionToolName } from '../../ai/agent-platform/tools/platformWebTools'
import {
  buildTaskManagementSdkMcpServer,
  type TaskManagementSdkModule
} from './buildTaskManagementSdkMcpServer'
import {
  buildSkillToolSdkMcpServers,
  type SkillToolSdkModule
} from './buildSkillToolSdkMcpServers'
import {
  addPendingAssistantMessageToState,
  buildRuntimePromptText,
  buildRuntimeTurnResult,
  createRuntimeUserMessageData,
  maybeAutoRenameSessionAfterTurn,
  patchRuntimeAssistantMessage
} from '../../ai/agent-platform/runtime/agentTurnPersistence'
import { throwIfAbortSignalAborted } from '../../ai/agent-platform/runtime/runtimeAbort'
import {
  createWarmQueryConsumptionPolicy,
  WarmQueryConsumptionError,
  type WarmQueryCloseReason,
  type WarmQueryConsumptionHandleMeta,
  type WarmQueryConsumptionOrigin,
  type WarmQueryConsumptionPolicy,
  type WarmQueryConsumptionSink,
  type WarmQueryModuleSource
} from './warmQueryConsumptionPolicy'
import {
  resolveRuntimeMentionedModels,
  type AgentRuntimeMentionedModelInput
} from '../../ai/agent-platform/runtime/agentMentionedModels'
import type { AgentRuntimeSessionChunk } from '../../ai/agent-platform/runtime/runtimeTypes'
import type { AgentStoreState } from '../../ai/agent-platform/store/agentStore'
import { addAgentSessionMessage } from '../../ai/agent-platform/store/agentStore'
import type { ProviderState, ProviderStateAccessor } from '../../ai/providers/modelProviderTypes'
import {
  isProviderRuntimeCheckReportStale,
  isProviderRuntimeCheckReportStaleForGateway,
  type ProviderRuntimeCheckReport
} from '../../ai/agent-platform/runtime/compatibility/providerRuntimeCheckTypes'
import type { AgentRuntimeProbeSnapshot } from '../../ai/agent-platform/runtime/compatibility/agentRuntimeCompatibilityTypes'
import type { AgentSessionMessageEntity, MessageData, MessageStats } from '../../ai/agent-platform/schemas/sessionSchemas'
import type { AgentModelGatewayService } from './agentModelGateway/AgentModelGatewayService'
import type { AgentRuntimeProbeSnapshotStore } from './agentModelCompatibility/AgentRuntimeProbeSnapshotStore'

type PathInfo = {
  exists: boolean
  isDirectory: boolean
}

type ProviderEnvironmentResolverDependencies = {
  getProviderState: ProviderStateAccessor
  refreshRuntimeCheck?: (providerId: string, modelId: string, checkGateway?: boolean) => Promise<ProviderRuntimeCheckReport | null>
  gatewayService?: Pick<
    AgentModelGatewayService,
    'getSnapshot' | 'getAuthToken' | 'isSyncedFor' | 'syncProviderConfig'
  >
  snapshotStore?: Pick<AgentRuntimeProbeSnapshotStore, 'getReport'>
}

type WorkspacePreparerDependencies = {
  systemWorkspaceRoot: string
  ensureDirectory?: (path: string) => Promise<void>
  getPathInfo?: (path: string) => Promise<PathInfo>
  getRealPath?: (path: string) => Promise<string>
}

type ClaudeCodeSdkModule = {
  query?: ClaudeAgentSdkQueryFunction | unknown
  startup?: ClaudeAgentSdkStartupFunction | unknown
}

type ClaudeAgentSdkAssistantContentBlock = {
  type?: string
  text?: string
  thinking?: string
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  content?: unknown
  structuredContent?: unknown
  is_error?: boolean
}

type ClaudeAgentSdkMessage = {
  type: string
  subtype?: string
  session_id?: string
  parent_tool_use_id?: string | null
  message?: string | {
    content?: ClaudeAgentSdkAssistantContentBlock[]
    stop_reason?: string | null
    usage?: ClaudeAgentSdkUsage
  }
  result?: string
  stop_reason?: string | null
  /** Assistant 消息的错误码；`max_output_tokens` 表示这一轮被输出上限截断。 */
  error?: string
  usage?: ClaudeAgentSdkUsage
  errors?: string[]
  is_error?: boolean
  event?: ClaudeAgentSdkStreamEvent
}

type ClaudeAgentSdkUsage = {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

type ClaudeAgentSdkStreamEvent =
  | {
      type: 'content_block_start'
      index: number
      content_block: ClaudeAgentSdkAssistantContentBlock
    }
  | {
      type: 'content_block_delta'
      index: number
      delta: ClaudeAgentSdkStreamDelta
    }
  | {
      type: 'content_block_stop'
      index: number
    }
  | {
      type: string
    }

type ClaudeAgentSdkStreamDelta =
  | {
      type: 'input_json_delta'
      partial_json: string
    }
  | {
      type: 'text_delta'
      text: string
    }
  | {
      type: 'thinking_delta'
      thinking: string
    }
  | {
      type: string
    }

type ClaudeAgentSdkQueryFunction = (input: {
  prompt: string
  options?: ClaudeCodeAgentSdkOptions & {
    systemPrompt?: string | string[] | { type: 'preset'; preset: 'claude_code'; append?: string }
  }
}) => AsyncIterable<ClaudeAgentSdkMessage>

type ClaudeAgentSdkStartupFunction = (input?: {
  options?: ClaudeCodeAgentSdkOptions & {
    systemPrompt?: string | string[] | { type: 'preset'; preset: 'claude_code'; append?: string }
  }
  initializeTimeoutMs?: number
}) => Promise<{
  query: (prompt: string) => AsyncIterable<ClaudeAgentSdkMessage>
  close: () => void
}>

type ClaudeAgentSdkWarmQueryHandle = {
  reuseKey?: string
  query: (prompt: string) => AsyncIterable<ClaudeAgentSdkMessage>
  close: () => void
  idleTimer?: ReturnType<typeof setTimeout>
}

type ClaudeAgentSdkRuntimeOptions = ClaudeCodeAgentSdkOptions & {
  systemPrompt?: string | string[] | { type: 'preset'; preset: 'claude_code'; append?: string }
}

type ClaudeAgentSdkRuntimeQueryRequest = ClaudeCodeAgentSdkQueryRequest & {
  options: ClaudeAgentSdkRuntimeOptions
  warmQueryReuseSignature: string
}

/**
 * Per-turn warm-query consumption context (WQ-2).
 *
 * `sdkIdentity` maps an adapter-tracked handle copy (`reuseKey` / `idleTimer`) back to the
 * object identity `startup()` actually returned: the fence must always key on the SDK-visible
 * object, never on the adapter's copy.
 */
type WarmQueryConsumptionContext = {
  policy: WarmQueryConsumptionPolicy
  moduleSource: WarmQueryModuleSource
  runId?: string
  sdkIdentity: (handle: object) => object
  track: (tracked: object, sdkHandle: object) => void
}

type WarmQueryConsumptionFence = {
  policy: WarmQueryConsumptionPolicy
  identity: object
  reason: WarmQueryCloseReason
}

function fenceMeta(
  fence: WarmQueryConsumptionContext,
  origin: WarmQueryConsumptionOrigin,
  platformSessionId: string
): WarmQueryConsumptionHandleMeta {
  return {
    origin,
    moduleSource: fence.moduleSource,
    platformSessionId,
    ...(fence.runId === undefined ? {} : { runId: fence.runId })
  }
}

function fenceConsumption(
  fence: WarmQueryConsumptionContext | undefined,
  handle: object,
  reason: WarmQueryCloseReason
): WarmQueryConsumptionFence | undefined {
  if (!fence) return undefined
  return { policy: fence.policy, identity: fence.sdkIdentity(handle), reason }
}

class ClaudeSdkQueryCollectionError extends Error {
  readonly observedSessionId: string | null
  readonly observedStats: MessageStats | null

  constructor(
    error: unknown,
    input: {
      observedSessionId: string | null
      observedStats: MessageStats | null
    }
  ) {
    super(error instanceof Error ? error.message : String(error))
    this.name = 'ClaudeSdkQueryCollectionError'
    this.observedSessionId = input.observedSessionId
    this.observedStats = input.observedStats
    if (error instanceof Error && error.stack) {
      this.stack = error.stack
    }
  }
}

type ClaudeCodeSdkModuleLoaderDependencies = {
  importer?: () => Promise<ClaudeCodeSdkModule>
  importers?: Array<() => Promise<ClaudeCodeSdkModule>>
}

export type ClaudeAgentSdkExecutorDependencies = {
  loadClaudeSdkModule: () => Promise<ClaudeCodeSdkModuleLoadResult>
  getProviderState: () => Promise<ProviderState>
  getAgentState: () => Promise<AgentStoreState>
  saveAgentState: (state: AgentStoreState, options?: { mergeSessionId?: string }) => Promise<void>
  warmQueryIdleTimeoutMs?: number
  /**
   * Optional WQ-2 audit sink. Absent by default: no sink means no diagnostics and no
   * behaviour change. The sink only ever receives whitelisted, non-sensitive fields.
   */
  warmQueryAuditSink?: WarmQueryConsumptionSink
  productAgentToolBridge?: {
    registry: import('../../ai/agent-platform/productTools/ProductAgentToolRegistry').ProductAgentToolRegistry
    runtime: import('../../ai/agent-platform/productTools/ProductAgentToolRuntimeService').ProductAgentToolRuntimeService
    getAgentState: () => Promise<AgentStoreState>
  }
  skillToolBridge?: {
    runtime: import('../../ai/agent-platform/skills/SkillsRuntimeService').SkillsRuntimeService
    getAgentState: () => Promise<AgentStoreState>
    loadSdkHelpers?: () => Promise<SkillToolSdkModule | null>
  }
  /** Platform web search for sessions whose provider cannot carry Anthropic server tools. */
  platformWebSearchBridge?: PlatformWebSearchBridge
  taskManagementToolBridge?: {
    runtime: Pick<import('../../ai/agent-platform/runtime/tasks/TaskManagementToolRuntimeService').TaskManagementToolRuntimeService, 'invoke'>
    commands: Pick<import('../../ai/agent-platform/runtime/tasks/TaskAutomationCommandService').TaskAutomationCommandService, 'prepareCancelRun' | 'recordCancelRunOutcome'>
    getAgentState: () => Promise<AgentStoreState>
    getTaskRunController: () => {
      cancelTaskRun: (input: string | {
        runLogId: string
        actor: Extract<import('../../ai/agent-platform/runtime/tasks/taskAutomationContracts').TaskActor, { kind: 'agent' }>
      }) => Promise<{ cancelled: boolean }>
    } | null
    loadSdkHelpers?: () => Promise<TaskManagementSdkModule | null>
  }
}

type ClaudeSdkPreferredExecutorDependencies = ClaudeAgentSdkExecutorDependencies & {
  sdkRuntime?: ClaudeAgentSdkRuntime
}

export type ClaudeAgentSdkPrewarmSessionInput = Pick<
  ClaudeCodeRuntimeExecutionInput,
  'composition' | 'query' | 'executor'
> & {
  sessionId: string
}

export type ClaudeAgentSdkPrewarmSessionResult =
  | {
      ok: true
      status: 'warmed'
    }
  | {
      ok: false
      reason: 'module-not-installed' | 'startup-unavailable'
      message: string
    }

export type ClaudeAgentSdkRuntime = {
  executeTurn: NonNullable<ClaudeCodeRuntimeDriverDependencies['executeTurn']>
  prewarmSession: (input: ClaudeAgentSdkPrewarmSessionInput) => Promise<ClaudeAgentSdkPrewarmSessionResult>
}

export type ClaudeCodeSdkModuleLoadResult =
  | {
      ok: true
      module: ClaudeCodeSdkModule
      /** Enum source of the loaded SDK module; never a module path. */
      source?: WarmQueryModuleSource
    }
  | {
      ok: false
      reason: 'module-not-installed'
      message: string
    }

export type ClaudeCodeRuntimeDriverDependencyFactoryOptions =
  ProviderEnvironmentResolverDependencies & WorkspacePreparerDependencies

export function createClaudeCodeProviderEnvironmentResolver(
  deps: ProviderEnvironmentResolverDependencies
): NonNullable<ClaudeCodeRuntimeDriverDependencies['resolveProviderEnvironment']> {
  return async (uniqueModelId: string): Promise<ClaudeCodeProviderEnvironmentResult> => {
    const providerState = await deps.getProviderState()
    const reference = parseProviderModelReference(uniqueModelId)
    const runtimeProvider = reference && deps.getProviderState.resolveRuntimeProvider
      ? await deps.getProviderState.resolveRuntimeProvider(reference.providerId)
      : null
    if (reference && deps.getProviderState.resolveRuntimeProvider && !runtimeProvider?.apiKey?.trim()) {
      return {
        ok: false,
        errorCode: 'missing-api-key',
        message: 'Claude Code provider API key is unavailable.'
      }
    }
    const runtimeState = runtimeProvider
      ? { providers: providerState.providers.map((provider) => provider.id === runtimeProvider.id ? runtimeProvider : provider) }
      : providerState
    const options = await resolveProviderEnvironmentOptions(runtimeState, uniqueModelId, deps)
    return createClaudeCodeProviderEnvironment(runtimeState, uniqueModelId, options)
  }
}

async function resolveProviderEnvironmentOptions(
  providerState: ProviderState,
  uniqueModelId: string,
  deps: ProviderEnvironmentResolverDependencies
): Promise<ClaudeCodeProviderEnvironmentOptions> {
  const reference = parseProviderModelReference(uniqueModelId)
  if (!reference || !deps.gatewayService || !deps.snapshotStore) {
    return {}
  }

  const provider = providerState.providers.find((entry) => entry.id === reference.providerId)
  const model = provider?.models.find((entry) => entry.id === reference.modelId)
  if (!provider || !model) {
    return {}
  }

  const gatewaySnapshot = deps.gatewayService.getSnapshot()
  const isGatewayStale = (candidate: ProviderRuntimeCheckReport): boolean =>
    isProviderRuntimeCheckReportStaleForGateway(candidate, gatewaySnapshot)
  let report = await deps.snapshotStore.getReport(reference.providerId, reference.modelId, 'claude-code')

  if (!report || isGatewayStale(report)) {
    // No evidence yet, or the gateway route changed: the route cannot be chosen without a fresh
    // answer, so this single turn pays for the probe.
    if (deps.refreshRuntimeCheck) {
      try {
        report = await deps.refreshRuntimeCheck(
          reference.providerId,
          reference.modelId,
          gatewaySnapshot.enabled === true
        )
      } catch {
        report = null
      }
    }
  } else if (isProviderRuntimeCheckReportStale(report)) {
    // Age alone must not gate the first token. Keep the last known-good route for this turn and
    // refresh in the background so the next turn can use the newer evidence.
    void deps.refreshRuntimeCheck?.(
      reference.providerId,
      reference.modelId,
      gatewaySnapshot.enabled === true
    ).catch(() => undefined)
  }
  if (!report || isGatewayStale(report)) {
    return {
      gatewayEnabled: gatewaySnapshot.enabled
    }
  }

  const options: ClaudeCodeProviderEnvironmentOptions = {
    gatewayEnabled: gatewaySnapshot.enabled
  }

  const directProbe = toProbeSnapshot(report, 'direct')
  const gatewayProbe = toProbeSnapshot(report, 'gateway')

  if (directProbe) {
    options.directProbe = directProbe
  }

  if (report.finalCompatibility.route !== 'gateway' || !report.finalCompatibility.selectable) {
    if (gatewayProbe) {
      options.gatewayProbe = gatewayProbe
    }
    return options
  }

  if (
    gatewaySnapshot.enabled !== true ||
    gatewaySnapshot.state !== 'running' ||
    !gatewaySnapshot.baseUrl
  ) {
    return options
  }

  if (!deps.gatewayService.isSyncedFor(reference.providerId, reference.modelId)) {
    deps.gatewayService.syncProviderConfig(provider, model)
  }

  return {
    ...options,
    ...(gatewayProbe ? { gatewayProbe } : {}),
    gateway: {
      baseUrl: gatewaySnapshot.baseUrl,
      authToken: deps.gatewayService.getAuthToken()
    }
  }
}

function parseProviderModelReference(
  uniqueModelId: string
): { providerId: string; modelId: string } | null {
  const separatorIndex = uniqueModelId.indexOf(':')
  if (separatorIndex <= 0 || separatorIndex === uniqueModelId.length - 1) {
    return null
  }
  return {
    providerId: uniqueModelId.slice(0, separatorIndex),
    modelId: uniqueModelId.slice(separatorIndex + 1)
  }
}

function toProbeSnapshot(
  report: ProviderRuntimeCheckReport,
  route: 'direct' | 'gateway'
): AgentRuntimeProbeSnapshot | undefined {
  const lane = route === 'direct' ? report.direct : report.gateway
  if (!lane || !lane.checkedAt) {
    return undefined
  }
  return {
    route,
    providerId: report.providerId,
    modelId: report.modelId,
    runtimeId: report.runtimeId,
    signature: `${report.signature}:${route}`,
    checkedAt: lane.checkedAt,
    status: mapLaneStatusToProbeStatus(lane.status),
    message: lane.summary
  }
}

function mapLaneStatusToProbeStatus(
  status: ProviderRuntimeCheckReport['ordinaryChat']['status']
): AgentRuntimeProbeSnapshot['status'] {
  switch (status) {
    case 'ready':
      return 'ready'
    case 'auth-failed':
      return 'auth-failed'
    case 'forbidden':
      return 'forbidden'
    case 'protocol-unsupported':
      return 'protocol-unsupported'
    case 'timeout':
      return 'timeout'
    case 'network-error':
      return 'network-error'
    default:
      return 'unknown'
  }
}

export function createClaudeCodeWorkspacePreparer(
  deps: WorkspacePreparerDependencies
): NonNullable<ClaudeCodeRuntimeDriverDependencies['prepareWorkspace']> {
  const ensureDirectory = deps.ensureDirectory ?? defaultEnsureDirectory
  const getPathInfo = deps.getPathInfo ?? defaultGetPathInfo
  const getRealPath = deps.getRealPath ?? realpath

  return async (input: ClaudeCodeWorkspacePreparationInput): Promise<ClaudeCodeWorkspacePreparationResult> => {
    if (input.workspaceType === 'system') {
      const managedWorkspacePath = pickManagedSystemWorkspacePath(
        input.workspacePath,
        deps.systemWorkspaceRoot,
        input.sessionId
      )

      await ensureDirectory(managedWorkspacePath)
      const [managedRootRealPath, cwdRealPath] = await Promise.all([
        getRealPath(deps.systemWorkspaceRoot),
        getRealPath(managedWorkspacePath)
      ])

      if (!isContainedPath(cwdRealPath, managedRootRealPath)) {
        throw new Error(`Claude Code system workspace escaped managed root: ${cwdRealPath}`)
      }

      return {
        cwd: cwdRealPath
      }
    }

    const pathInfo = await getPathInfo(input.workspacePath)
    if (!pathInfo.exists) {
      throw new Error(`Claude Code workspace does not exist: ${input.workspacePath}`)
    }
    if (!pathInfo.isDirectory) {
      throw new Error(`Claude Code workspace is not a directory: ${input.workspacePath}`)
    }

    return {
      cwd: await getRealPath(input.workspacePath)
    }
  }
}

export function createClaudeCodeRuntimeDriverDependencies(
  options: ClaudeCodeRuntimeDriverDependencyFactoryOptions
): Pick<ClaudeCodeRuntimeDriverDependencies, 'prepareWorkspace' | 'resolveProviderEnvironment'> & {
  loadClaudeSdkModule: () => Promise<ClaudeCodeSdkModuleLoadResult>
} {
  return {
    prepareWorkspace: createClaudeCodeWorkspacePreparer(options),
    resolveProviderEnvironment: createClaudeCodeProviderEnvironmentResolver(options),
    loadClaudeSdkModule: createClaudeCodeSdkModuleLoader()
  }
}

export function createClaudeCodeSdkModuleLoader(
  deps: ClaudeCodeSdkModuleLoaderDependencies = {}
): () => Promise<ClaudeCodeSdkModuleLoadResult> {
  const importers =
    deps.importers && deps.importers.length > 0
      ? deps.importers
      : deps.importer
        ? [deps.importer]
        : [defaultClaudeAgentSdkImporter, defaultClaudeCodeSdkImporter]
  // Diagnostic enum only: index 0 is the official SDK, anything after it is the fallback.
  const sources: WarmQueryModuleSource[] = importers.map((_, index) =>
    index === 0 ? 'claude-agent-sdk' : 'claude-code-fallback'
  )

  return async () => {
    let lastNotInstalledError: unknown = null

    for (const [index, importer] of importers.entries()) {
      try {
        const module = await importer()
        return {
          ok: true,
          module,
          source: sources[index] ?? 'claude-agent-sdk'
        }
      } catch (error) {
        if (isClaudeCodeSdkModuleNotInstalledError(error)) {
          lastNotInstalledError = error
          continue
        }

        throw error
      }
    }

    if (lastNotInstalledError) {
      return {
        ok: false,
        reason: 'module-not-installed',
        message: 'Claude Code SDK package is not installed in the desktop main process runtime.'
      }
    }

    return {
      ok: false,
      reason: 'module-not-installed',
      message: 'Claude Code SDK package is not installed in the desktop main process runtime.'
    }
  }
}

export function createClaudeAgentSdkExecutor(
  deps: ClaudeAgentSdkExecutorDependencies
): NonNullable<ClaudeCodeRuntimeDriverDependencies['executeTurn']> {
  return createClaudeAgentSdkRuntime(deps).executeTurn
}

export function createClaudeAgentSdkRuntime(deps: ClaudeAgentSdkExecutorDependencies): ClaudeAgentSdkRuntime {
  const warmQueriesBySessionId = new Map<string, ClaudeAgentSdkWarmQueryHandle>()
  const warmQueryConsumption = createWarmQueryConsumptionPolicy({ auditSink: deps.warmQueryAuditSink })
  // Adapter-tracked handle copies carry `reuseKey` / `idleTimer`; the fence must key on the
  // object identity `startup()` returned, so copies are mapped back to it here.
  const warmQuerySdkIdentities = new WeakMap<object, object>()
  const createWarmQueryFence = (
    moduleSource: WarmQueryModuleSource,
    runId?: string
  ): WarmQueryConsumptionContext => ({
    policy: warmQueryConsumption,
    moduleSource,
    ...(runId === undefined ? {} : { runId }),
    sdkIdentity: (handle) => warmQuerySdkIdentities.get(handle) ?? handle,
    track: (tracked, sdkHandle) => {
      warmQuerySdkIdentities.set(tracked, sdkHandle)
    }
  })

  const executeTurn: NonNullable<ClaudeCodeRuntimeDriverDependencies['executeTurn']> = async (input) => {
    const providerState = await deps.getProviderState()
    const mentionedModels = resolveRuntimeMentionedModels(
      input.request.mentionedModels as readonly AgentRuntimeMentionedModelInput[] | undefined,
      providerState
    )
    const initialState = await deps.getAgentState()
    const withUser = addAgentSessionMessage(initialState, input.request.sessionId, {
      role: 'user',
      status: 'success',
      data: createRuntimeUserMessageData(input.request.text, mentionedModels, {
        ...(input.request.displayText ? { displayText: input.request.displayText } : {}),
        ...(input.request.context ? { context: input.request.context } : {})
      })
    })
    const assistantMessageId = `assistant-${input.runId}`
    const withPending = addPendingAssistantMessageToState(withUser, {
      sessionId: input.request.sessionId,
      assistantMessageId,
      modelId: input.composition.modelId,
      modelName: input.composition.modelName
    })
    await deps.saveAgentState(withPending, { mergeSessionId: input.request.sessionId })
    let lastObservedRuntimeResumeToken: string | null = null

    try {
      const loaded = await deps.loadClaudeSdkModule()
      if (!loaded.ok) {
        throw new Error(loaded.message)
      }
      const startup = requireClaudeAgentSdkStartup(loaded.module)
      if (!startup) {
        requireClaudeAgentSdkQuery(loaded.module)
      }
      throwIfAbortSignalAborted(input.signal)
      const request = await createSdkQueryRequestAsync(input, mentionedModels, deps)
      throwIfAbortSignalAborted(input.signal)
      const query = await createSdkQueryIterable(
        loaded.module,
        request,
        input.request.sessionId,
        warmQueriesBySessionId,
        createWarmQueryFence(loaded.source ?? 'claude-agent-sdk', input.runId),
        input.signal
      )
      const queryWithObservedSessionPersistence = observeClaudeSdkSessionIds(query, async (observedSessionId) => {
        if (observedSessionId === lastObservedRuntimeResumeToken) return
        lastObservedRuntimeResumeToken = observedSessionId
        await patchRuntimeAssistantMessage(deps, input.request.sessionId, assistantMessageId, {
          runtimeResumeToken: observedSessionId
        })
      })
      const aggregated = await collectSdkQueryResult(
        queryWithObservedSessionPersistence,
        async (partialText, partialData) => {
          await patchRuntimeAssistantMessage(deps, input.request.sessionId, assistantMessageId, {
            status: 'pending',
            data: partialData ?? createClaudeSdkRuntimeMessageData(partialText)
          })
        },
        {
          sessionId: input.request.sessionId,
          runId: input.runId,
          emitChunk: input.emitChunk,
          toolHooks: input.toolHooks,
          maxOutputTokens: input.query.runtimeMetadata.outputLimit?.maxOutputTokens ?? null
        }
      )

      const successState = await patchRuntimeAssistantMessage(deps, input.request.sessionId, assistantMessageId, {
        status: 'success',
        data: aggregated.data,
        stats: aggregated.stats,
        runtimeResumeToken: aggregated.sessionId,
        modelSnapshot: buildModelSnapshot(input.composition.modelId, input.composition.modelName)
      })
      const renamedState = await maybeAutoRenameSessionAfterTurn(
        deps,
        successState,
        input.request.sessionId,
        input.request.text
      )
      return buildRuntimeTurnResult(renamedState, input.request.sessionId, assistantMessageId)
    } catch (error) {
      if (error instanceof AgentTurnOutputTruncatedError) {
        const errorState = await patchRuntimeAssistantMessage(deps, input.request.sessionId, assistantMessageId, {
          status: input.signal.aborted ? 'paused' : 'error',
          data: createClaudeSdkRuntimeMessageData(buildAgentTurnOutputTruncatedDiagnosticText(error)),
          ...(error.outputTokens === null ? {} : { stats: { completionTokens: error.outputTokens } })
        })
        return buildRuntimeTurnResult(errorState, input.request.sessionId, assistantMessageId)
      }
      const message = error instanceof Error ? error.message : String(error)
      const queryFailureMetadata = extractClaudeSdkQueryFailureMetadata(error)
      const errorState = await patchRuntimeAssistantMessage(deps, input.request.sessionId, assistantMessageId, {
        status: input.signal.aborted ? 'paused' : 'error',
        data: createClaudeSdkRuntimeMessageData(input.signal.aborted ? '已停止。' : message),
        ...(queryFailureMetadata.observedSessionId
          ? { runtimeResumeToken: queryFailureMetadata.observedSessionId }
          : {}),
        ...(queryFailureMetadata.observedStats ? { stats: queryFailureMetadata.observedStats } : {})
      })
      return buildRuntimeTurnResult(errorState, input.request.sessionId, assistantMessageId)
    }
  }

  const prewarmSession: ClaudeAgentSdkRuntime['prewarmSession'] = async (input) => {
    const loaded = await deps.loadClaudeSdkModule()
    if (!loaded.ok) {
      return {
        ok: false,
        reason: loaded.reason,
        message: loaded.message
      }
    }

    const startup = requireClaudeAgentSdkStartup(loaded.module)
    if (!startup) {
      return {
        ok: false,
        reason: 'startup-unavailable',
        message: 'Claude Agent SDK startup() is not available from the loaded SDK module.'
      }
    }

    const { options, warmQueryReuseSignature } = await createSdkOptionsForPrewarm(input, deps)
    const warmQueryFence = createWarmQueryFence(loaded.source ?? 'claude-agent-sdk')
    const warmQuery = await getOrCreatePrewarmedQuery(
      startup,
      options,
      warmQueryReuseSignature,
      input.sessionId,
      warmQueriesBySessionId,
      deps.warmQueryIdleTimeoutMs,
      warmQueryFence
    )
    scheduleWarmQueryIdleClose(
      input.sessionId,
      warmQuery,
      warmQueriesBySessionId,
      deps.warmQueryIdleTimeoutMs,
      warmQueryFence
    )

    return {
      ok: true,
      status: 'warmed'
    }
  }

  return {
    executeTurn,
    prewarmSession
  }
}

export function createClaudeSdkPreferredExecutor(
  deps: ClaudeSdkPreferredExecutorDependencies
): NonNullable<ClaudeCodeRuntimeDriverDependencies['executeTurn']> {
  return deps.sdkRuntime?.executeTurn ?? createClaudeAgentSdkExecutor(deps)
}

async function defaultEnsureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
}

async function defaultGetPathInfo(path: string): Promise<PathInfo> {
  try {
    const info = await stat(path)
    return {
      exists: true,
      isDirectory: info.isDirectory()
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        exists: false,
        isDirectory: false
      }
    }
    throw error
  }
}

function pickManagedSystemWorkspacePath(
  workspacePath: string,
  systemWorkspaceRoot: string,
  sessionId: string
): string {
  if (isContainedPath(workspacePath, systemWorkspaceRoot)) {
    return resolve(workspacePath)
  }
  return join(resolve(systemWorkspaceRoot), sanitizePathSegment(sessionId))
}

function sanitizePathSegment(value: string): string {
  const sanitized = value.trim().replace(/[^A-Za-z0-9._-]+/g, '-')
  return sanitized.length > 0 ? sanitized : 'session'
}

function isContainedPath(candidatePath: string, rootPath: string): boolean {
  const normalizedRoot = resolve(rootPath)
  const normalizedCandidate = resolve(candidatePath)
  if (normalizedCandidate === normalizedRoot) return true
  const rootWithSeparator = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`
  return normalizedCandidate.startsWith(rootWithSeparator)
}

async function defaultClaudeAgentSdkImporter(): Promise<ClaudeCodeSdkModule> {
  return import('@anthropic-ai/claude-agent-sdk')
}

async function defaultClaudeCodeSdkImporter(): Promise<ClaudeCodeSdkModule> {
  return import('@anthropic-ai/claude-code')
}

function isClaudeCodeSdkModuleNotInstalledError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const code = (error as Error & { code?: string }).code
  if (code !== 'ERR_MODULE_NOT_FOUND' && code !== 'MODULE_NOT_FOUND') {
    return false
  }

  return (
    error.message.includes('@anthropic-ai/claude-code') ||
    error.message.includes('@anthropic-ai/claude-agent-sdk')
  )
}

function requireClaudeAgentSdkQuery(module: ClaudeCodeSdkModule): ClaudeAgentSdkQueryFunction {
  if (typeof module.query !== 'function') {
    throw new Error('Claude Agent SDK query() is not available from the loaded SDK module.')
  }
  return module.query as ClaudeAgentSdkQueryFunction
}

function requireClaudeAgentSdkStartup(module: ClaudeCodeSdkModule): ClaudeAgentSdkStartupFunction | null {
  if (typeof module.startup !== 'function') {
    return null
  }
  return module.startup as ClaudeAgentSdkStartupFunction
}

async function createSdkQueryIterable(
  module: ClaudeCodeSdkModule,
  request: ClaudeAgentSdkRuntimeQueryRequest,
  sessionId: string,
  warmQueriesBySessionId: Map<string, ClaudeAgentSdkWarmQueryHandle>,
  fence: WarmQueryConsumptionContext,
  turnSignal?: AbortSignal
): Promise<AsyncIterable<ClaudeAgentSdkMessage>> {
  if (turnSignal) {
    throwIfAbortSignalAborted(turnSignal)
  }
  const startup = requireClaudeAgentSdkStartup(module)
  if (!startup) {
    const queryFunction = requireClaudeAgentSdkQuery(module)
    return createTrackedClaudeSdkQueryIterable(
      () => queryFunction({
        prompt: request.prompt,
        options: request.options
      }),
      undefined,
      turnSignal
    )
  }

  const { handle, origin } = await takeOrCreateConsumableWarmQuery(
    startup,
    request.options,
    request.warmQueryReuseSignature,
    sessionId,
    warmQueriesBySessionId,
    fence,
    turnSignal
  )
  // WQ-2: synchronously claim the SDK object identity before the async iterable exists and
  // before `handle.query()` is called. A second claim on the same identity throws here.
  fence.policy.claim(fence.sdkIdentity(handle), fenceMeta(fence, origin, sessionId))
  return createTrackedClaudeSdkQueryIterable(
    () => handle.query(request.prompt),
    handle,
    turnSignal,
    fence
  )
}

async function* createTrackedClaudeSdkQueryIterable(
  createQuery: () => AsyncIterable<ClaudeAgentSdkMessage>,
  activeWarmQuery?: ClaudeAgentSdkWarmQueryHandle,
  turnSignal?: AbortSignal,
  fence?: WarmQueryConsumptionContext
): AsyncIterable<ClaudeAgentSdkMessage> {
  try {
    if (turnSignal) {
      throwIfAbortSignalAborted(turnSignal)
    }
    const query = createQuery()
    for await (const message of query) {
      yield message
    }
  } finally {
    if (activeWarmQuery) {
      closeWarmQuery(activeWarmQuery, fenceConsumption(fence, activeWarmQuery, 'consumed'))
    }
  }
}

async function getOrCreatePrewarmedQuery(
  startup: ClaudeAgentSdkStartupFunction,
  options: ClaudeAgentSdkRuntimeOptions,
  warmQueryReuseSignature: string,
  sessionId: string,
  warmQueriesBySessionId: Map<string, ClaudeAgentSdkWarmQueryHandle>,
  warmQueryIdleTimeoutMs: number | undefined,
  fence: WarmQueryConsumptionContext,
  turnSignal?: AbortSignal
): Promise<ClaudeAgentSdkWarmQueryHandle> {
  if (turnSignal) {
    throwIfAbortSignalAborted(turnSignal)
  }
  const existing = warmQueriesBySessionId.get(sessionId)
  const warmQueryKey = buildWarmQueryReuseKey(options, warmQueryReuseSignature)

  if (existing && existing.reuseKey === warmQueryKey) {
    return existing
  }
  if (existing) {
    disposeTrackedWarmQuery(
      sessionId,
      existing,
      warmQueriesBySessionId,
      fenceConsumption(fence, existing, 'replaced')
    )
  }

  const warmQuery = await startup({
    options
  })
  if (turnSignal?.aborted) {
    closeWarmQuery(warmQuery, fenceConsumption(fence, warmQuery, 'aborted'))
    throwIfAbortSignalAborted(turnSignal)
  }
  registerConsumableWarmQuery(fence, warmQuery, 'prewarm', sessionId, warmQueriesBySessionId)
  const trackedWarmQuery = {
    ...warmQuery,
    reuseKey: warmQueryKey
  }
  fence.track(trackedWarmQuery, warmQuery)
  warmQueriesBySessionId.set(sessionId, trackedWarmQuery)
  return trackedWarmQuery
}

async function takeOrCreateConsumableWarmQuery(
  startup: ClaudeAgentSdkStartupFunction,
  options: ClaudeAgentSdkRuntimeOptions,
  warmQueryReuseSignature: string,
  sessionId: string,
  warmQueriesBySessionId: Map<string, ClaudeAgentSdkWarmQueryHandle>,
  fence: WarmQueryConsumptionContext,
  turnSignal?: AbortSignal
): Promise<{ handle: ClaudeAgentSdkWarmQueryHandle; origin: WarmQueryConsumptionOrigin }> {
  if (turnSignal) {
    throwIfAbortSignalAborted(turnSignal)
  }
  const existing = warmQueriesBySessionId.get(sessionId)
  const warmQueryKey = buildWarmQueryReuseKey(options, warmQueryReuseSignature)

  if (existing?.reuseKey === warmQueryKey) {
    removeTrackedWarmQuery(sessionId, existing, warmQueriesBySessionId)
    return { handle: existing, origin: 'execute-cache-hit' }
  }
  if (existing) {
    disposeTrackedWarmQuery(
      sessionId,
      existing,
      warmQueriesBySessionId,
      fenceConsumption(fence, existing, 'replaced')
    )
  }

  const warmQuery = await startup({ options })
  if (turnSignal?.aborted) {
    closeWarmQuery(warmQuery, fenceConsumption(fence, warmQuery, 'aborted'))
    throwIfAbortSignalAborted(turnSignal)
  }
  registerConsumableWarmQuery(fence, warmQuery, 'execute-startup', sessionId, warmQueriesBySessionId)
  return { handle: warmQuery, origin: 'execute-startup' }
}

/**
 * WQ-2 seam 6: a `startup()` result whose object identity is already registered is never
 * treated as consumable again. Any unconsumed cache slot pointing at it is evicted, the
 * handle is closed only while nobody owns it, and the current turn fails. There is no retry.
 */
function registerConsumableWarmQuery(
  fence: WarmQueryConsumptionContext,
  sdkHandle: ClaudeAgentSdkWarmQueryHandle,
  origin: WarmQueryConsumptionOrigin,
  platformSessionId: string,
  warmQueriesBySessionId: Map<string, ClaudeAgentSdkWarmQueryHandle>
): void {
  try {
    fence.policy.register(sdkHandle, fenceMeta(fence, origin, platformSessionId))
  } catch (error) {
    if (
      error instanceof WarmQueryConsumptionError &&
      error.code === 'warm-query-identity-reused-on-register'
    ) {
      const unconsumed = fence.policy.isUnconsumed(sdkHandle)
      for (const [sessionId, cached] of warmQueriesBySessionId) {
        if (fence.sdkIdentity(cached) === sdkHandle) {
          removeTrackedWarmQuery(sessionId, cached, warmQueriesBySessionId)
        }
      }
      if (unconsumed) {
        closeWarmQuery(sdkHandle, {
          policy: fence.policy,
          identity: sdkHandle,
          reason: 'startup-duplicate'
        })
      }
    }
    throw error
  }
}

async function createSdkQueryRequestAsync(
  input: ClaudeCodeRuntimeExecutionInput,
  mentionedModels: Parameters<typeof buildRuntimePromptText>[1],
  deps: ClaudeAgentSdkExecutorDependencies
): Promise<ClaudeAgentSdkRuntimeQueryRequest> {
  const productToolMcpServers =
    deps.productAgentToolBridge && input.composition.productTools
      ? await buildProductAgentToolSdkMcpServers({
          composition: input.composition,
          agentId: input.composition.agentId,
          sessionId: input.request.sessionId,
          getAgentState: deps.productAgentToolBridge.getAgentState,
          registry: deps.productAgentToolBridge.registry,
          runtime: deps.productAgentToolBridge.runtime,
          emitChunk: input.emitChunk,
          signal: input.signal
        })
      : {}
  const skillToolMcpServers =
    deps.skillToolBridge && input.composition.skills.toolIds.length > 0
      ? await buildSkillToolSdkMcpServers({
          composition: input.composition,
          agentId: input.composition.agentId,
          sessionId: input.request.sessionId,
          getAgentState: deps.skillToolBridge.getAgentState,
          runtime: deps.skillToolBridge.runtime,
          emitChunk: input.emitChunk,
          signal: input.signal,
          ...(deps.skillToolBridge.loadSdkHelpers ? { loadSdkHelpers: deps.skillToolBridge.loadSdkHelpers } : {})
        })
      : {}
  const taskManagementMcpServer =
    deps.taskManagementToolBridge && input.composition.taskManagement
      ? await buildTaskManagementSdkMcpServer({
          composition: input.composition,
          agentId: input.composition.agentId,
          sessionId: input.request.sessionId,
          getAgentState: deps.taskManagementToolBridge.getAgentState,
          runtime: deps.taskManagementToolBridge.runtime,
          commands: deps.taskManagementToolBridge.commands,
          getTaskRunController: deps.taskManagementToolBridge.getTaskRunController,
          emitChunk: input.emitChunk,
          signal: input.signal,
          ...(deps.taskManagementToolBridge.loadSdkHelpers
            ? { loadSdkHelpers: deps.taskManagementToolBridge.loadSdkHelpers }
            : {})
        })
      : null
  const executor = taskManagementMcpServer
    ? createTaskManagementBridgeExecutor(input.executor, taskManagementMcpServer.toolNames)
    : input.executor
  const webSearchMcpServer =
    deps.platformWebSearchBridge &&
    (input.composition.sessionAllowedTools ?? []).includes(platformWebSearchSessionToolName)
      ? await buildPlatformWebSearchSdkMcpServer({
          bridge: deps.platformWebSearchBridge,
          loadSdkHelpers: async () => {
            try {
              return (await import('@anthropic-ai/claude-agent-sdk')) as never
            } catch {
              return null
            }
          }
        })
      : null

  return {
    prompt: buildRuntimePromptText(input.request.text, mentionedModels),
    options: createSdkOptionsFromExecutionParts({ ...input, executor }, {
      ...productToolMcpServers,
      ...skillToolMcpServers,
      ...(taskManagementMcpServer ? { [taskManagementMcpServer.name]: taskManagementMcpServer.server } : {}),
      ...(webSearchMcpServer ? { [webSearchMcpServer.name]: webSearchMcpServer.server } : {})
    }),
    warmQueryReuseSignature: buildWarmQueryRuntimePolicySignature(input)
  }
}

function createTaskManagementBridgeExecutor(
  executor: ClaudeCodeRuntimeExecutionInput['executor'],
  toolNames: readonly string[]
): ClaudeCodeRuntimeExecutionInput['executor'] {
  const additionalToolNames = toolNames.filter(
    (toolName) => toolName === 'scheduled_task_cancel_run' || toolName === 'scheduled_task_run_now'
  )
  if (additionalToolNames.length === 0) return executor

  const additionalToolSet = new Set<string>(additionalToolNames)
  const toolPolicy = executor.metadata.toolPolicy
  const runtimeMcpToolNames = [...new Set([...(executor.metadata.runtimeMcpToolNames ?? []), ...additionalToolNames])]
  const runtimeMcpApprovalByName = {
    ...(toolPolicy.runtimeMcpApprovalByName ?? {}),
    ...Object.fromEntries(additionalToolNames.map((toolName) => [toolName, 'auto' as const]))
  }

  return {
    ...executor,
    sdkOptions: {
      ...executor.sdkOptions,
      allowedTools: [...new Set([...executor.sdkOptions.allowedTools, ...additionalToolNames])]
    },
    metadata: {
      ...executor.metadata,
      runtimeMcpToolNames,
      toolPolicy: {
        ...toolPolicy,
        runtimeMcpToolNames,
        runtimeMcpApprovalByName,
        canUseTool: (toolName) =>
          additionalToolSet.has(toolName)
            ? { kind: 'allow', toolName }
            : toolPolicy.canUseTool(toolName),
        preToolUse: (input) =>
          additionalToolSet.has(input.toolName)
            ? { kind: 'allow', toolName: input.toolName }
            : toolPolicy.preToolUse(input)
      }
    },
    toolHooks: {
      canUseTool: async (toolName) =>
        additionalToolSet.has(toolName)
          ? { behavior: 'allow' }
          : executor.toolHooks.canUseTool(toolName),
      preToolUse: async (input) =>
        additionalToolSet.has(input.toolName)
          ? { behavior: 'allow' }
          : executor.toolHooks.preToolUse(input)
    }
  }
}

function createSdkOptionsFromExecutionParts(
  input: Pick<ClaudeCodeRuntimeExecutionInput, 'composition' | 'query' | 'executor'>,
  additionalMcpServers: Record<string, unknown> = {}
): ClaudeCodeAgentSdkOptions & {
  systemPrompt?: string | string[] | { type: 'preset'; preset: 'claude_code'; append?: string }
} {
  const skillContext = input.query.runtimeMetadata.skillContext ?? buildClaudeCodeSkillContext(input.query.runtimeMetadata.skills)
  const systemPromptAppend = buildClaudeCodeSystemPromptAppend(
    input.composition.instructions,
    skillContext
  )
  const systemPrompt = systemPromptAppend
    ? {
        type: 'preset' as const,
        preset: 'claude_code' as const,
        append: systemPromptAppend
      }
    : {
        type: 'preset' as const,
        preset: 'claude_code' as const
      }

  return {
    ...createClaudeCodeAgentSdkOptions(input.executor, { additionalMcpServers }),
    systemPrompt
  }
}

function buildWarmQueryRuntimePolicySignature(
  input: Pick<ClaudeCodeRuntimeExecutionInput, 'composition' | 'query' | 'executor'>
): string {
  const metadata = input.query.runtimeMetadata
  const toolPolicy = metadata.toolPolicy
  return stableStringify({
    composition: {
      agentId: input.composition.agentId,
      sessionId: input.composition.sessionId,
      permissionMode: input.composition.permissionMode,
      workspacePath: input.composition.workspacePath,
      workspaceType: input.composition.workspaceType,
      environment: input.composition.environment
    },
    runtimeMetadata: {
      mcpSources: metadata.mcpSources,
      mcpServers: metadata.mcpServers,
      skillToolIds: sortStrings(metadata.skillToolIds),
      runtimeMcpToolNames: sortStrings(metadata.runtimeMcpToolNames ?? []),
      skillContext: metadata.skillContext ?? null
    },
    toolPolicy: {
      permissionMode: toolPolicy.permissionMode,
      allowedTools: sortStrings(toolPolicy.allowedTools),
      disallowedTools: sortStrings(toolPolicy.disallowedTools),
      mcpSources: toolPolicy.mcpSources,
      skillToolIds: sortStrings(toolPolicy.skillToolIds),
      runtimeMcpToolNames: sortStrings(toolPolicy.runtimeMcpToolNames ?? []),
      runtimeMcpApprovalByName: toolPolicy.runtimeMcpApprovalByName ?? null
    },
    executorMetadata: {
      skillToolIds: sortStrings(input.executor.metadata.skillToolIds),
      runtimeMcpToolNames: sortStrings(input.executor.metadata.runtimeMcpToolNames ?? []),
      skillContext: input.executor.metadata.skillContext ?? null,
      mcpServers: input.executor.metadata.mcpServers,
      toolPolicy: {
        permissionMode: input.executor.metadata.toolPolicy.permissionMode,
        allowedTools: sortStrings(input.executor.metadata.toolPolicy.allowedTools),
        disallowedTools: sortStrings(input.executor.metadata.toolPolicy.disallowedTools),
        mcpSources: input.executor.metadata.toolPolicy.mcpSources,
        skillToolIds: sortStrings(input.executor.metadata.toolPolicy.skillToolIds),
        runtimeMcpToolNames: sortStrings(input.executor.metadata.toolPolicy.runtimeMcpToolNames ?? []),
        runtimeMcpApprovalByName: input.executor.metadata.toolPolicy.runtimeMcpApprovalByName ?? null
      }
    }
  })
}

async function createSdkOptionsForPrewarm(
  input: ClaudeAgentSdkPrewarmSessionInput,
  deps: ClaudeAgentSdkExecutorDependencies
): Promise<{
  options: ClaudeAgentSdkRuntimeOptions
  warmQueryReuseSignature: string
}> {
  const skillToolMcpServers =
    deps.skillToolBridge && input.composition.skills.toolIds.length > 0
      ? await buildSkillToolSdkMcpServers({
          composition: input.composition,
          agentId: input.composition.agentId,
          sessionId: input.sessionId,
          getAgentState: deps.skillToolBridge.getAgentState,
          runtime: deps.skillToolBridge.runtime,
          ...(deps.skillToolBridge.loadSdkHelpers ? { loadSdkHelpers: deps.skillToolBridge.loadSdkHelpers } : {})
        })
      : {}

  return {
    options: createSdkOptionsFromExecutionParts(input, skillToolMcpServers),
    warmQueryReuseSignature: buildWarmQueryRuntimePolicySignature(input)
  }
}

export function buildWarmQueryReuseKey(
  options: ClaudeAgentSdkRuntimeOptions,
  warmQueryReuseSignature: string
): string {
  return stableStringify({
    runtimePolicy: warmQueryReuseSignature,
    resume: options.resume ?? null,
    model: options.model,
    cwd: options.cwd,
    env: options.env,
    permissionMode: options.permissionMode,
    thinking: options.thinking ?? null,
    effort: options.effort ?? null,
    systemPrompt: normalizeWarmQuerySystemPrompt(options.systemPrompt),
    allowedTools: sortStrings(options.allowedTools),
    disallowedTools: sortStrings(options.disallowedTools),
    strictMcpConfig: options.strictMcpConfig,
    allowDangerouslySkipPermissions: options.allowDangerouslySkipPermissions ?? false,
    outputFormat: options.outputFormat ?? null,
    // Only the server identity belongs in the reuse key. The values include live in-process MCP
    // server instances, which are cyclic and must never be walked.
    mcpServers: options.mcpServers ? describeMcpServers(options.mcpServers) : null
  })
}

function disposeTrackedWarmQuery(
  sessionId: string,
  warmQuery: ClaudeAgentSdkWarmQueryHandle,
  warmQueriesBySessionId: Map<string, ClaudeAgentSdkWarmQueryHandle>,
  fence?: WarmQueryConsumptionFence
): void {
  removeTrackedWarmQuery(sessionId, warmQuery, warmQueriesBySessionId)
  closeWarmQuery(warmQuery, fence)
}

function removeTrackedWarmQuery(
  sessionId: string,
  warmQuery: ClaudeAgentSdkWarmQueryHandle,
  warmQueriesBySessionId: Map<string, ClaudeAgentSdkWarmQueryHandle>
): void {
  if (warmQueriesBySessionId.get(sessionId) === warmQuery) {
    warmQueriesBySessionId.delete(sessionId)
  }
  if (warmQuery.idleTimer) {
    clearTimeout(warmQuery.idleTimer)
    warmQuery.idleTimer = undefined
  }
}

function closeWarmQuery(
  warmQuery: Pick<ClaudeAgentSdkWarmQueryHandle, 'close' | 'idleTimer'>,
  fence?: WarmQueryConsumptionFence
): void {
  if (warmQuery.idleTimer) {
    clearTimeout(warmQuery.idleTimer)
    warmQuery.idleTimer = undefined
  }
  try {
    warmQuery.close()
  } catch {
    // Best-effort cleanup; the original query failure is the actionable error.
  }
  if (fence) {
    fence.policy.close(fence.identity, fence.reason)
  }
}

function scheduleWarmQueryIdleClose(
  sessionId: string,
  warmQuery: ClaudeAgentSdkWarmQueryHandle,
  warmQueriesBySessionId: Map<string, ClaudeAgentSdkWarmQueryHandle>,
  warmQueryIdleTimeoutMs: number | undefined,
  fence?: WarmQueryConsumptionContext
): void {
  if (warmQuery.idleTimer) {
    clearTimeout(warmQuery.idleTimer)
    warmQuery.idleTimer = undefined
  }
  if (warmQueryIdleTimeoutMs === undefined || warmQueryIdleTimeoutMs <= 0) {
    return
  }

  warmQuery.idleTimer = setTimeout(() => {
    disposeTrackedWarmQuery(
      sessionId,
      warmQuery,
      warmQueriesBySessionId,
      fenceConsumption(fence, warmQuery, 'idle')
    )
  }, warmQueryIdleTimeoutMs)
}

function normalizeWarmQuerySystemPrompt(
  systemPrompt: string | string[] | { type: 'preset'; preset: 'claude_code'; append?: string } | undefined
): unknown {
  if (Array.isArray(systemPrompt)) {
    return [...systemPrompt]
  }

  if (systemPrompt && typeof systemPrompt === 'object') {
    return { ...systemPrompt }
  }

  return systemPrompt ?? null
}

function sortStrings(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right))
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stabilizeForStringify(value))
}

function describeMcpServers(servers: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(servers)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, config]) => [name, readServerKind(config)])
  )
}

function readServerKind(config: unknown): string {
  if (!config || typeof config !== 'object') return 'unknown'
  const type = (config as Record<string, unknown>).type
  if (typeof type === 'string') return type
  return 'stdio'
}

function stabilizeForStringify(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stabilizeForStringify(item, seen))
  }

  if (value && typeof value === 'object') {
    if (seen.has(value)) return '[circular]'
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      // Runtime handles (MCP server instances, sockets, abort controllers) carry internal cycles and
      // are not part of the policy; name the kind instead of walking them.
      return `[${value.constructor?.name ?? 'object'}]`
    }
    seen.add(value)
    const result = Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => typeof item !== 'function' && item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stabilizeForStringify(item, seen)])
    )
    seen.delete(value)
    return result
  }

  return value
}

async function collectSdkQueryResult(
  query: AsyncIterable<ClaudeAgentSdkMessage>,
  onPartialText: (text: string, data?: MessageData) => Promise<void>,
  options: {
    sessionId: string
    runId: string
    emitChunk: (chunk: AgentRuntimeSessionChunk) => void
    toolHooks: ClaudeCodeRuntimeExecutionInput['toolHooks']
    /** 本回合请求的单轮输出上限；只用于截断诊断。 */
    maxOutputTokens: number | null
  }
): Promise<{ text: string; data: MessageData; sessionId: string | null; stats: MessageStats | null }> {
  let assistantText = ''
  let resultText: string | null = null
  let sessionId: string | null = null
  let stats: MessageStats | null = null
  let sawResult = false
  let lastAssistantStopReason: string | null = null
  let assistantOutputTruncationError = false
  const streamState = createClaudeSdkToolStreamState()

  try {
    for await (const message of query) {
      if (typeof message.session_id === 'string') {
        sessionId = message.session_id
      }

      if (message.type === 'stream_event' && message.event) {
        const partialAssistantText = emitClaudeSdkStreamEventChunks(
          message.event,
          options.sessionId,
          options.runId,
          streamState,
          options.emitChunk
        )
        if (partialAssistantText != null && partialAssistantText !== assistantText) {
          assistantText = partialAssistantText
          await onPartialText(assistantText, createClaudeSdkRuntimeMessageData(assistantText, streamState))
        }
        continue
      }

      if (message.type === 'assistant') {
        emitClaudeSdkAssistantToolChunks(message, options.sessionId, streamState, options.emitChunk)
        // 子代理的输出上限不是主回合的上限，只看主线程。CLI 在 stop_reason=max_tokens 时会
        // 最多自动续写 3 次（`max_output_tokens_recovery`），所以这里只记录信号，
        // 最终是否截断以 result 的 stop_reason 为准，避免把已续写成功的回合误判为失败。
        if (!message.parent_tool_use_id) {
          const assistantStopReason = readClaudeSdkAssistantStopReason(message)
          if (assistantStopReason) lastAssistantStopReason = assistantStopReason
          if (isClaudeCodeOutputTruncationErrorCode(message.error)) {
            assistantOutputTruncationError = true
          }
        }
        const nextText = extractAssistantMessageText(message)
        if (nextText && nextText !== assistantText) {
          const textDelta = deriveAssistantTextDelta(assistantText, nextText)
          const mode = nextText.startsWith(assistantText) ? 'append' : 'replace'
          assistantText = nextText
          options.emitChunk({
            type: 'assistant-text-update',
            sessionId: options.sessionId,
            runId: options.runId,
            text: assistantText,
            textDelta,
            mode
          })
          await onPartialText(assistantText, createClaudeSdkRuntimeMessageData(assistantText, streamState))
        }
        continue
      }

      if (message.type === 'user') {
        emitClaudeSdkUserToolResultChunks(message, options.sessionId, streamState, options.emitChunk)
        continue
      }

      if (message.type === 'system') {
        emitClaudeSdkSystemControlChunk(message, options.sessionId, options.runId, streamState, options.emitChunk)
        continue
      }

      if (message.type === 'result') {
        sawResult = true
        const truncationStopReason = isClaudeCodeOutputTruncationStopReason(message.stop_reason)
          ? (message.stop_reason as string)
          : null
        if (truncationStopReason) {
          // Anthropic 协议把截断报在 stop_reason=max_tokens，OpenAI 兼容协议报 length；
          // SDK 仍可能把 subtype 标成 success，所以这里必须自己判失败。
          throw new AgentTurnOutputTruncatedError({
            stopReason: truncationStopReason,
            partialText:
              typeof message.result === 'string' && message.result.trim()
                ? message.result.trim()
                : assistantText,
            maxOutputTokens: options.maxOutputTokens,
            outputTokens: readClaudeSdkOutputTokens(message.usage)
          })
        }
        if (Array.isArray(message.errors) && message.errors.length > 0) {
          throw new Error(message.errors.join('\n'))
        }
        resultText = typeof message.result === 'string' && message.result.trim() ? message.result.trim() : resultText
        stats = normalizeClaudeAgentSdkUsage(message.usage)
        if (message.is_error) {
          throw new Error(resultText ?? 'Claude Agent SDK execution failed.')
        }
      }
    }

    // 流没有 result 就结束、但最后一条主线程 assistant 已被截断：同样不能当成成功。
    if (!sawResult && (assistantOutputTruncationError || isClaudeCodeOutputTruncationStopReason(lastAssistantStopReason))) {
      throw new AgentTurnOutputTruncatedError({
        stopReason: assistantOutputTruncationError ? 'max_output_tokens' : (lastAssistantStopReason as string),
        partialText: assistantText,
        maxOutputTokens: options.maxOutputTokens,
        outputTokens: null
      })
    }
  } catch (error) {
    if (error instanceof AgentTurnOutputTruncatedError) throw error
    throw new ClaudeSdkQueryCollectionError(error, {
      observedSessionId: sessionId,
      observedStats: stats
    })
  }

  finalizeOpenClaudeSdkStreamChunks(options.sessionId, options.runId, streamState, options.emitChunk)

  const text = resultText ?? assistantText.trim()
  if (!text) {
    throw new Error('Claude Agent SDK query did not return assistant text.')
  }

  return {
    text,
    data: createClaudeSdkRuntimeMessageData(text, streamState),
    sessionId,
    stats
  }
}

function readClaudeSdkAssistantStopReason(message: ClaudeAgentSdkMessage): string | null {
  if (!message.message || typeof message.message === 'string') return null
  return typeof message.message.stop_reason === 'string' ? message.message.stop_reason : null
}

function readClaudeSdkOutputTokens(usage: ClaudeAgentSdkUsage | undefined): number | null {
  const value = usage?.output_tokens
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function extractClaudeSdkQueryFailureMetadata(error: unknown): {
  observedSessionId: string | null
  observedStats: MessageStats | null
} {
  if (error instanceof ClaudeSdkQueryCollectionError) {
    return {
      observedSessionId: error.observedSessionId,
      observedStats: error.observedStats
    }
  }

  return {
    observedSessionId: null,
    observedStats: null
  }
}

async function* observeClaudeSdkSessionIds(
  query: AsyncIterable<ClaudeAgentSdkMessage>,
  onObservedSessionId: (sessionId: string) => Promise<void>
): AsyncIterable<ClaudeAgentSdkMessage> {
  let lastObservedSessionId: string | null = null
  for await (const message of query) {
    const observedSessionId = typeof message.session_id === 'string' ? message.session_id.trim() : ''
    if (observedSessionId && observedSessionId !== lastObservedSessionId) {
      lastObservedSessionId = observedSessionId
      await onObservedSessionId(observedSessionId)
    }
    yield message
  }
}

function createClaudeSdkRuntimeMessageData(text: string, state?: ClaudeSdkToolStreamState): MessageData {
  const parts: MessageData['parts'] = [{ type: 'text', text }]
  if (!state) {
    return { parts }
  }

  for (const reasoning of state.completedReasoningParts) {
    if (!reasoning.text.trim()) continue
    parts.push({
      type: 'claude-sdk-reasoning',
      source: 'claude-agent-sdk',
      partId: reasoning.partId,
      text: reasoning.text
    })
  }

  for (const toolCall of state.completedToolCalls) {
    parts.push({
      type: 'claude-sdk-tool-call',
      source: 'claude-agent-sdk',
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      input: toolCall.input
    })
  }

  for (const toolResult of state.completedToolResults) {
    parts.push({
      type: 'claude-sdk-tool-result',
      source: 'claude-agent-sdk',
      toolCallId: toolResult.toolCallId,
      ...(toolResult.isError ? { errorText: toolResult.errorText } : { output: toolResult.output }),
      ...(toolResult.content !== undefined ? { content: toolResult.content } : {}),
      ...(toolResult.structuredContent !== undefined ? { structuredContent: toolResult.structuredContent } : {}),
      isError: toolResult.isError
    })
  }

  for (const controlEvent of state.completedRuntimeControlEvents) {
    parts.push({
      type: 'claude-sdk-runtime-control',
      source: 'claude-agent-sdk',
      subtype: controlEvent.subtype,
      ...(controlEvent.message ? { message: controlEvent.message } : {})
    })
  }

  return { parts }
}

/**
 * Per-token thinking counters are not a user-visible runtime event. The transcript view already
 * hides them, so persisting one part per token only inflates every streaming save and every IPC
 * snapshot. Keep them out of the stream entirely.
 */
const QUIET_CLAUDE_SDK_RUNTIME_CONTROL_SUBTYPES = new Set(['thinking_tokens'])

function emitClaudeSdkSystemControlChunk(
  message: ClaudeAgentSdkMessage,
  sessionId: string,
  runId: string,
  state: ClaudeSdkToolStreamState,
  emitChunk: (chunk: AgentRuntimeSessionChunk) => void
): void {
  if (!message.subtype || message.subtype === 'init') return
  if (QUIET_CLAUDE_SDK_RUNTIME_CONTROL_SUBTYPES.has(message.subtype)) return
  const controlMessage =
    typeof message.message === 'string' && message.message.trim() ? message.message.trim() : undefined
  rememberClaudeSdkRuntimeControlEvent(state, message.subtype, controlMessage)
  emitChunk({
    type: 'runtime-control',
    sessionId,
    runId,
    source: 'claude-agent-sdk',
    subtype: message.subtype,
    ...(controlMessage ? { message: controlMessage } : {})
  })
}

function extractAssistantMessageText(message: ClaudeAgentSdkMessage): string {
  if (typeof message.message === 'string') return ''
  return (message.message?.content ?? [])
    .flatMap((block) => (block.type === 'text' && typeof block.text === 'string' ? [block.text] : []))
    .join('')
    .trim()
}

function deriveAssistantTextDelta(previousText: string, nextText: string): string {
  if (!previousText) return nextText
  if (nextText.startsWith(previousText)) {
    return nextText.slice(previousText.length)
  }
  return nextText
}

type ClaudeSdkToolStreamState = {
  toolIdsByIndex: Map<number, string>
  toolNamesById: Map<string, string>
  toolInputById: Map<string, string>
  emittedToolResultIds: Set<string>
  assistantTextByIndex: Map<number, string>
  reasoningPartIdsByIndex: Map<number, string>
  reasoningTextByPartId: Map<string, string>
  pendingReasoningDeltaByPartId: Map<string, string>
  completedRuntimeControlEvents: Array<{
    subtype: string
    message?: string
  }>
  completedReasoningParts: Array<{
    partId: string
    text: string
  }>
  completedToolCalls: Array<{
    toolCallId: string
    toolName: string
    input: unknown
  }>
  completedToolResults: Array<
    | {
        toolCallId: string
        output: unknown
        content?: unknown
        structuredContent?: unknown
        isError: false
      }
    | {
        toolCallId: string
        errorText: string
        content?: unknown
        structuredContent?: unknown
        isError: true
      }
  >
}

function createClaudeSdkToolStreamState(): ClaudeSdkToolStreamState {
  return {
    toolIdsByIndex: new Map(),
    toolNamesById: new Map(),
    toolInputById: new Map(),
    emittedToolResultIds: new Set(),
    assistantTextByIndex: new Map(),
    reasoningPartIdsByIndex: new Map(),
    reasoningTextByPartId: new Map(),
    pendingReasoningDeltaByPartId: new Map(),
    completedRuntimeControlEvents: [],
    completedReasoningParts: [],
    completedToolCalls: [],
    completedToolResults: []
  }
}

const REASONING_DELTA_BATCH_CHARS = 80

function emitClaudeSdkStreamEventChunks(
  event: ClaudeAgentSdkStreamEvent,
  sessionId: string,
  runId: string,
  state: ClaudeSdkToolStreamState,
  emitChunk: (chunk: AgentRuntimeSessionChunk) => void
): string | null {
  if (isClaudeSdkContentBlockStartEvent(event) && isClaudeSdkTextBlock(event.content_block)) {
    state.assistantTextByIndex.set(event.index, event.content_block.text ?? '')
    return null
  }

  if (isClaudeSdkContentBlockStartEvent(event) && isClaudeSdkThinkingBlock(event.content_block)) {
    const partId = buildClaudeSdkReasoningPartId(runId, event.index)
    state.reasoningPartIdsByIndex.set(event.index, partId)
    emitChunk({
      type: 'reasoning-start',
      sessionId,
      runId,
      partId
    })
    return null
  }

  if (isClaudeSdkContentBlockStartEvent(event) && isClaudeSdkToolUseBlock(event.content_block)) {
    state.toolIdsByIndex.set(event.index, event.content_block.id!)
    state.toolNamesById.set(event.content_block.id!, event.content_block.name!)
    state.toolInputById.set(event.content_block.id!, '')
    emitChunk({
      type: 'tool-input-start',
      sessionId,
      toolCallId: event.content_block.id!,
      toolName: event.content_block.name!
    })
    return null
  }

  if (isClaudeSdkContentBlockDeltaEvent(event) && isClaudeSdkInputJsonDelta(event.delta)) {
    const toolCallId = state.toolIdsByIndex.get(event.index)
    if (!toolCallId) return null
    state.toolInputById.set(toolCallId, `${state.toolInputById.get(toolCallId) ?? ''}${event.delta.partial_json}`)
    emitChunk({
      type: 'tool-input-delta',
      sessionId,
      toolCallId,
      inputTextDelta: event.delta.partial_json
    })
    return null
  }

  if (isClaudeSdkContentBlockDeltaEvent(event) && isClaudeSdkTextDelta(event.delta)) {
    const currentText = state.assistantTextByIndex.get(event.index) ?? ''
    const nextText = `${currentText}${event.delta.text}`
    state.assistantTextByIndex.set(event.index, nextText)
    const combinedText = combineClaudeSdkAssistantText(state)
    emitChunk({
      type: 'assistant-text-update',
      sessionId,
      runId,
      text: combinedText,
      textDelta: event.delta.text,
      mode: 'append'
    })
    return combinedText
  }

  if (isClaudeSdkContentBlockDeltaEvent(event) && isClaudeSdkThinkingDelta(event.delta)) {
    const partId = state.reasoningPartIdsByIndex.get(event.index)
    if (!partId) return null
    state.reasoningTextByPartId.set(partId, `${state.reasoningTextByPartId.get(partId) ?? ''}${event.delta.thinking}`)
    const pendingDelta = `${state.pendingReasoningDeltaByPartId.get(partId) ?? ''}${event.delta.thinking}`
    if (pendingDelta.length < REASONING_DELTA_BATCH_CHARS) {
      // Reasoning is token-by-token. Emitting one runtime chunk per token makes every later
      // snapshot re-serialize the whole turn, so batch small deltas and let the block stop flush.
      state.pendingReasoningDeltaByPartId.set(partId, pendingDelta)
      return null
    }
    state.pendingReasoningDeltaByPartId.delete(partId)
    emitChunk({
      type: 'reasoning-delta',
      sessionId,
      runId,
      partId,
      delta: pendingDelta
    })
    return null
  }

  if (isClaudeSdkContentBlockStopEvent(event)) {
    const toolCallId = state.toolIdsByIndex.get(event.index)
    if (toolCallId) {
      state.toolIdsByIndex.delete(event.index)
      const input = safeParseClaudeSdkJson(state.toolInputById.get(toolCallId) ?? '')
      rememberClaudeSdkCompletedToolCall(state, toolCallId, state.toolNamesById.get(toolCallId) ?? 'unknown-tool', input)
      emitChunk({
        type: 'tool-input-available',
        sessionId,
        toolCallId,
        toolName: state.toolNamesById.get(toolCallId) ?? 'unknown-tool',
        input
      })
      return null
    }

    const reasoningPartId = state.reasoningPartIdsByIndex.get(event.index)
    if (reasoningPartId) {
      state.reasoningPartIdsByIndex.delete(event.index)
      flushClaudeSdkPendingReasoningDelta(state, reasoningPartId, sessionId, runId, emitChunk)
      rememberClaudeSdkCompletedReasoningPart(state, reasoningPartId)
      emitChunk({
        type: 'reasoning-end',
        sessionId,
        runId,
        partId: reasoningPartId
      })
      return null
    }

    return null
  }

  return null
}

function finalizeOpenClaudeSdkStreamChunks(
  sessionId: string,
  runId: string,
  state: ClaudeSdkToolStreamState,
  emitChunk: (chunk: AgentRuntimeSessionChunk) => void
): void {
  for (const [index, toolCallId] of [...state.toolIdsByIndex.entries()].sort(([left], [right]) => left - right)) {
    state.toolIdsByIndex.delete(index)
    const input = safeParseClaudeSdkJson(state.toolInputById.get(toolCallId) ?? '')
    rememberClaudeSdkCompletedToolCall(state, toolCallId, state.toolNamesById.get(toolCallId) ?? 'unknown-tool', input)
    emitChunk({
      type: 'tool-input-available',
      sessionId,
      toolCallId,
      toolName: state.toolNamesById.get(toolCallId) ?? 'unknown-tool',
      input
    })
  }

  for (const [index, partId] of [...state.reasoningPartIdsByIndex.entries()].sort(([left], [right]) => left - right)) {
    state.reasoningPartIdsByIndex.delete(index)
    flushClaudeSdkPendingReasoningDelta(state, partId, sessionId, runId, emitChunk)
    rememberClaudeSdkCompletedReasoningPart(state, partId)
    emitChunk({
      type: 'reasoning-end',
      sessionId,
      runId,
      partId
    })
  }
}

function emitClaudeSdkAssistantToolChunks(
  message: ClaudeAgentSdkMessage,
  sessionId: string,
  state: ClaudeSdkToolStreamState,
  emitChunk: (chunk: AgentRuntimeSessionChunk) => void
): void {
  if (typeof message.message === 'string') return
  for (const block of message.message?.content ?? []) {
    if (!isClaudeSdkToolUseBlock(block)) continue
    const toolCallId = block.id!
    const toolName = block.name!
    if (!state.toolNamesById.has(toolCallId)) {
      emitChunk({
        type: 'tool-input-start',
        sessionId,
        toolCallId,
        toolName
      })
    }
    state.toolNamesById.set(toolCallId, toolName)
    const serializedInput = serializeClaudeSdkUnknown(block.input)
    if (serializedInput) {
      emitChunk({
        type: 'tool-input-delta',
        sessionId,
        toolCallId,
        inputTextDelta: serializedInput
      })
    }
    emitChunk({
      type: 'tool-input-available',
      sessionId,
      toolCallId,
      toolName,
      input: block.input ?? safeParseClaudeSdkJson(serializedInput)
    })
    rememberClaudeSdkCompletedToolCall(state, toolCallId, toolName, block.input ?? safeParseClaudeSdkJson(serializedInput))
  }
}

function emitClaudeSdkUserToolResultChunks(
  message: ClaudeAgentSdkMessage,
  sessionId: string,
  state: ClaudeSdkToolStreamState,
  emitChunk: (chunk: AgentRuntimeSessionChunk) => void
): void {
  if (typeof message.message === 'string') return
  for (const block of message.message?.content ?? []) {
    if (!isClaudeSdkToolResultBlock(block)) continue
    const toolCallId = block.tool_use_id!
    if (state.emittedToolResultIds.has(toolCallId)) continue
    state.emittedToolResultIds.add(toolCallId)
    if (block.is_error) {
      const errorText = typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
      rememberClaudeSdkCompletedToolError(state, toolCallId, errorText, block.content, block.structuredContent)
      emitChunk({
        type: 'tool-output-error',
        sessionId,
        toolCallId,
        errorText
      })
      continue
    }
    const output =
      block.structuredContent !== undefined ? block.structuredContent : normalizeClaudeSdkToolResultContent(block.content)
    rememberClaudeSdkCompletedToolResult(state, toolCallId, output, block.content, block.structuredContent)
    emitChunk({
      type: 'tool-output-available',
      sessionId,
      toolCallId,
      output
    })
  }
}

function flushClaudeSdkPendingReasoningDelta(
  state: ClaudeSdkToolStreamState,
  partId: string,
  sessionId: string,
  runId: string,
  emitChunk: (chunk: AgentRuntimeSessionChunk) => void
): void {
  const pendingDelta = state.pendingReasoningDeltaByPartId.get(partId)
  if (!pendingDelta) return
  state.pendingReasoningDeltaByPartId.delete(partId)
  emitChunk({
    type: 'reasoning-delta',
    sessionId,
    runId,
    partId,
    delta: pendingDelta
  })
}

function rememberClaudeSdkCompletedReasoningPart(state: ClaudeSdkToolStreamState, partId: string): void {
  if (state.completedReasoningParts.some((part) => part.partId === partId)) return
  state.completedReasoningParts.push({
    partId,
    text: state.reasoningTextByPartId.get(partId) ?? ''
  })
}

function rememberClaudeSdkRuntimeControlEvent(
  state: ClaudeSdkToolStreamState,
  subtype: string,
  message?: string
): void {
  state.completedRuntimeControlEvents.push({
    subtype,
    ...(message ? { message } : {})
  })
}

function rememberClaudeSdkCompletedToolCall(
  state: ClaudeSdkToolStreamState,
  toolCallId: string,
  toolName: string,
  input: unknown
): void {
  if (state.completedToolCalls.some((toolCall) => toolCall.toolCallId === toolCallId)) return
  state.completedToolCalls.push({
    toolCallId,
    toolName,
    input
  })
}

function rememberClaudeSdkCompletedToolResult(
  state: ClaudeSdkToolStreamState,
  toolCallId: string,
  output: unknown,
  content?: unknown,
  structuredContent?: unknown
): void {
  if (state.completedToolResults.some((toolResult) => toolResult.toolCallId === toolCallId)) return
  state.completedToolResults.push({
    toolCallId,
    output,
    ...(content !== undefined ? { content } : {}),
    ...(structuredContent !== undefined ? { structuredContent } : {}),
    isError: false
  })
}

function rememberClaudeSdkCompletedToolError(
  state: ClaudeSdkToolStreamState,
  toolCallId: string,
  errorText: string,
  content?: unknown,
  structuredContent?: unknown
): void {
  if (state.completedToolResults.some((toolResult) => toolResult.toolCallId === toolCallId)) return
  state.completedToolResults.push({
    toolCallId,
    errorText,
    ...(content !== undefined ? { content } : {}),
    ...(structuredContent !== undefined ? { structuredContent } : {}),
    isError: true
  })
}

function isClaudeSdkToolUseBlock(block: ClaudeAgentSdkAssistantContentBlock): boolean {
  return (
    (block.type === 'tool_use' || block.type === 'server_tool_use' || block.type === 'mcp_tool_use') &&
    typeof block.id === 'string' &&
    typeof block.name === 'string'
  )
}

function isClaudeSdkTextBlock(block: ClaudeAgentSdkAssistantContentBlock): boolean {
  return block.type === 'text'
}

function isClaudeSdkThinkingBlock(block: ClaudeAgentSdkAssistantContentBlock): boolean {
  return block.type === 'thinking'
}

function isClaudeSdkToolResultBlock(block: ClaudeAgentSdkAssistantContentBlock): boolean {
  return typeof block.type === 'string' && block.type.endsWith('tool_result') && typeof block.tool_use_id === 'string'
}

function isClaudeSdkContentBlockStartEvent(
  event: ClaudeAgentSdkStreamEvent
): event is Extract<ClaudeAgentSdkStreamEvent, { type: 'content_block_start' }> {
  return event.type === 'content_block_start'
}

function isClaudeSdkContentBlockDeltaEvent(
  event: ClaudeAgentSdkStreamEvent
): event is Extract<ClaudeAgentSdkStreamEvent, { type: 'content_block_delta' }> {
  return event.type === 'content_block_delta'
}

function isClaudeSdkContentBlockStopEvent(
  event: ClaudeAgentSdkStreamEvent
): event is Extract<ClaudeAgentSdkStreamEvent, { type: 'content_block_stop' }> {
  return event.type === 'content_block_stop'
}

function isClaudeSdkInputJsonDelta(
  delta: ClaudeAgentSdkStreamDelta
): delta is Extract<ClaudeAgentSdkStreamDelta, { type: 'input_json_delta' }> {
  return delta.type === 'input_json_delta'
}

function isClaudeSdkTextDelta(
  delta: ClaudeAgentSdkStreamDelta
): delta is Extract<ClaudeAgentSdkStreamDelta, { type: 'text_delta' }> {
  return delta.type === 'text_delta' && 'text' in delta && typeof delta.text === 'string'
}

function isClaudeSdkThinkingDelta(
  delta: ClaudeAgentSdkStreamDelta
): delta is Extract<ClaudeAgentSdkStreamDelta, { type: 'thinking_delta' }> {
  return delta.type === 'thinking_delta' && 'thinking' in delta && typeof delta.thinking === 'string'
}

function combineClaudeSdkAssistantText(state: ClaudeSdkToolStreamState): string {
  return [...state.assistantTextByIndex.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, text]) => text)
    .join('')
}

function buildClaudeSdkReasoningPartId(runId: string, index: number): string {
  return `reasoning-${runId}-${index}`
}

function serializeClaudeSdkUnknown(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function safeParseClaudeSdkJson(value: string): unknown {
  const trimmed = value.trim()
  if (!trimmed) return {}
  try {
    return JSON.parse(trimmed)
  } catch {
    return trimmed
  }
}

function normalizeClaudeSdkToolResultContent(content: unknown): unknown {
  if (typeof content === 'string') {
    return safeParseClaudeSdkJson(content)
  }
  if (Array.isArray(content) && content.length === 1) {
    const first = content[0] as { type?: unknown; text?: unknown }
    if (first?.type === 'text' && typeof first.text === 'string') {
      return first.text
    }
  }
  return content
}

function normalizeClaudeAgentSdkUsage(usage: ClaudeAgentSdkUsage | undefined): MessageStats | null {
  if (!usage) return null
  const promptTokens = typeof usage.input_tokens === 'number' ? usage.input_tokens : undefined
  const completionTokens = typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined
  const totalTokens =
    promptTokens !== undefined || completionTokens !== undefined
      ? (promptTokens ?? 0) + (completionTokens ?? 0)
      : undefined

  const stats: MessageStats = {
    ...(promptTokens !== undefined ? { promptTokens } : {}),
    ...(completionTokens !== undefined ? { completionTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {})
  }

  return Object.keys(stats).length > 0 ? stats : null
}

function buildModelSnapshot(
  modelId: string | null,
  modelName: string | null
): AgentSessionMessageEntity['modelSnapshot'] {
  if (!modelId) return null
  const separatorIndex = modelId.indexOf(':')
  if (separatorIndex <= 0 || separatorIndex === modelId.length - 1) {
    return {
      id: modelId,
      name: modelName ?? modelId,
      provider: 'unknown'
    }
  }

  return {
    id: modelId.slice(separatorIndex + 1),
    name: modelName ?? modelId.slice(separatorIndex + 1),
    provider: modelId.slice(0, separatorIndex)
  }
}
