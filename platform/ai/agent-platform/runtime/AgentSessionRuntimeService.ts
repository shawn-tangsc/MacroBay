import type { AgentStoreState } from '../store/agentStore'
import type { ToolApprovalDecision, ToolApprovalRegistry } from './policy'
import type { AgentChatRuntimeRequest, AgentChatRuntimeResult } from './agentChatRuntime'
import type { AgentRuntimeCompositionService } from './AgentRuntimeCompositionService'
import { RuntimeDriverRegistry } from './RuntimeDriverRegistry'
import type {
  AgentRuntimeStopReason,
  AgentRuntimeAssistantTextUpdateChunk,
  AgentRuntimeDriver,
  AgentRuntimeDriverContext,
  AgentRuntimePrewarmSessionRequest,
  AgentRuntimePrewarmSessionResult,
  AgentSessionRuntimeSnapshot,
  AgentSessionRuntimeState,
  AgentSessionRuntimeTerminalStatus,
  AgentRuntimeTraceRecorder,
  AgentRuntimeTraceOperation,
  AgentRuntimeTraceSpan,
  AgentRuntimeToolApprovalRequestChunk,
  AgentRuntimeToolApprovalResolvedChunk,
  AgentRuntimeSessionChunk,
  ToolApprovalRequestInput
} from './runtimeTypes'
import { isRuntimeAbortError, throwRuntimeAbort } from './runtimeAbort'
import { readPersistedSessionRuntimeState } from './sessionRuntimePersistence'

type AgentSessionRuntimeServiceDependencies = {
  getAgentState: () => Promise<AgentStoreState>
  driverRegistry: RuntimeDriverRegistry
  compositionService?: Pick<AgentRuntimeCompositionService, 'compose'>
  toolApprovalRegistry?: ToolApprovalRegistry
  traceRecorder?: AgentRuntimeTraceRecorder
  now?: () => string
}

type RuntimeEntry = {
  sessionId: string
  agentId: string | null
  agentType: AgentSessionRuntimeState['agentType']
  inflightRequestCount: number
  queuedTurnCount: number
  turnPhase: AgentSessionRuntimeState['turnPhase']
  activeRunIds: Set<string>
  activeToolIds: Set<string>
  pendingCancelReasonByRunId: Map<string, AgentRuntimeStopReason>
  pendingSessionCancelReason: AgentRuntimeStopReason | null
  currentRunId: string | null
  currentDriver: AgentRuntimeDriver | null
  interruptRequested: boolean
  interruptDispatched: boolean
  executionChain: Promise<void>
  lastRunId: string | null
  lastResumeToken: string | null
  lastResumeTokenSource: AgentSessionRuntimeState['lastResumeTokenSource']
  lastTerminalStatus: AgentSessionRuntimeTerminalStatus | null
  lastStopReason: AgentSessionRuntimeState['lastStopReason']
  warmState: AgentSessionRuntimeState['warmState']
  traceId: string | null
  lastWarmAt: string | null
  lastWarmResultMessage: string | null
  updatedAt: string
}

const defaultNow = (): string => new Date().toISOString()
const sessionStopApprovalDenyMessage = 'Tool approval was denied because the session was stopped.'
const runtimeDisposeApprovalDenyMessage = 'Tool approval was denied because the runtime was disposed.'
const runtimeDisposedMessage = 'Agent session runtime is disposed.'
const defaultUserStopReason: AgentRuntimeStopReason = {
  kind: 'user-stop',
  message: 'Stopped by user request.'
}
const queuedTurnInterruptReason: AgentRuntimeStopReason = {
  kind: 'interrupt',
  message: 'Interrupted by a newer queued turn.'
}
const runtimeDisposeStopReason: AgentRuntimeStopReason = {
  kind: 'runtime-stop',
  message: runtimeDisposedMessage
}

/**
 * A reasoning model can stream thousands of deltas per turn. Every snapshot serializes the whole
 * retained list, so an unbounded list turns one thinking phase into quadratic IPC work. Keep a
 * bounded tail; approvals are never dropped because they need a user decision.
 */
export const MAX_RUNTIME_CHUNKS_PER_SESSION = 400

export class AgentSessionRuntimeService {
  private readonly entries = new Map<string, RuntimeEntry>()
  private readonly chunksBySessionId = new Map<string, AgentRuntimeSessionChunk[]>()
  private readonly listeners = new Set<(snapshot: AgentSessionRuntimeSnapshot) => void>()
  private disposed = false

  constructor(private readonly deps: AgentSessionRuntimeServiceDependencies) {}

  private timestamp(): string {
    return (this.deps.now ?? defaultNow)()
  }

  subscribe(listener: (snapshot: AgentSessionRuntimeSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot(): AgentSessionRuntimeSnapshot {
    return {
      sessions: Object.fromEntries(
        [...this.entries.entries()].map(([sessionId, entry]) => [sessionId, toSnapshotState(entry)])
      ),
      toolApprovals: this.listToolApprovals(),
      toolApprovalHistory: this.listToolApprovalHistory(),
      chunksBySessionId: Object.fromEntries(this.chunksBySessionId.entries()),
      updatedAt: this.timestamp()
    }
  }

  isSessionBusy(sessionId: string): boolean {
    return (this.entries.get(sessionId)?.inflightRequestCount ?? 0) > 0
  }

  requestToolApproval(input: ToolApprovalRequestInput): Promise<ToolApprovalDecision> {
    const registry = this.requireToolApprovalRegistry()
    this.getOrCreateEntry(input.sessionId, null, null)
    const approvalId = input.approvalId ?? createApprovalId()
    if (!input.approvalId) {
      this.appendChunk(
        createToolApprovalRequestChunk({
          ...input,
          approvalId
        })
      )
    }
    const pending = registry.createPending({
      ...input,
      approvalId
    })
    this.emitSnapshot()
    return pending.result
  }

  listToolApprovals(): AgentSessionRuntimeSnapshot['toolApprovals'] {
    return this.deps.toolApprovalRegistry?.listPending() ?? []
  }

  listToolApprovalHistory(): AgentSessionRuntimeSnapshot['toolApprovalHistory'] {
    return this.deps.toolApprovalRegistry?.listHistory() ?? []
  }

  resolveToolApproval(
    approvalId: string,
    decision: ToolApprovalDecision
  ): AgentSessionRuntimeSnapshot {
    const registry = this.requireToolApprovalRegistry()
    const pending = registry.get(approvalId)
    registry.resolve(approvalId, decision)
    if (pending) {
      this.replaceApprovalRequestWithResolvedChunk(pending, decision)
    }
    this.emitSnapshot()
    return this.getSnapshot()
  }

  cancelMessage(runId: string, reason: AgentRuntimeStopReason = defaultUserStopReason): boolean {
    const entry = [...this.entries.values()].find((candidate) => candidate.activeRunIds.has(runId))
    if (!entry) return false
    if (reason.kind !== 'interrupt') {
      entry.interruptRequested = false
      entry.interruptDispatched = false
    }
    entry.lastStopReason = cloneStopReason(reason)
    if (entry.currentRunId === runId && entry.currentDriver) {
      entry.updatedAt = this.timestamp()
      this.emitSnapshot()
      return entry.currentDriver.cancelMessage(runId, reason)
    }
    entry.pendingCancelReasonByRunId.set(runId, cloneStopReason(reason))
    entry.updatedAt = this.timestamp()
    this.emitSnapshot()
    return true
  }

  cancelSession(sessionId: string, reason: AgentRuntimeStopReason = defaultUserStopReason): boolean {
    const approvalRegistry = this.deps.toolApprovalRegistry
    const hasPendingApprovals =
      approvalRegistry?.listPending().some((candidate) => candidate.sessionId === sessionId) ?? false
    const entry = this.entries.get(sessionId) ?? (hasPendingApprovals ? this.getOrCreateEntry(sessionId, null, null) : undefined)
    if (!entry && !hasPendingApprovals) return false
    if (approvalRegistry) {
      this.clearChunksForSession(sessionId)
      approvalRegistry.denySession(sessionId, sessionStopApprovalDenyMessage)
    }
    if (!entry) {
      this.emitSnapshot()
      return true
    }
    if (reason.kind !== 'interrupt') {
      entry.interruptRequested = false
      entry.interruptDispatched = false
    }
    entry.lastStopReason = cloneStopReason(reason)
    entry.turnPhase = 'pausing'
    if (entry.currentDriver) {
      const didCancel = entry.currentDriver.cancelSession(sessionId, reason)
      entry.updatedAt = this.timestamp()
      this.emitSnapshot()
      return didCancel
    }
    entry.pendingSessionCancelReason = cloneStopReason(reason)
    entry.updatedAt = this.timestamp()
    this.emitSnapshot()
    return true
  }

  async sendMessage(request: AgentChatRuntimeRequest): Promise<AgentChatRuntimeResult> {
    if (this.disposed) {
      throw new Error(runtimeDisposedMessage)
    }
    const runId = request.runId ?? null
    const entry = this.getOrCreateEntry(request.sessionId, request.agentId, null)
    const wasBusy = entry.inflightRequestCount > 0
    entry.agentId = request.agentId
    entry.inflightRequestCount += 1
    entry.queuedTurnCount = Math.max(0, entry.inflightRequestCount - 1)
    if (runId) entry.activeRunIds.add(runId)
    if (!wasBusy && entry.currentRunId === null) {
      entry.currentRunId = runId
    }
    entry.turnPhase = wasBusy ? deriveTurnPhase(entry) : 'resolving-context'
    entry.lastRunId = runId
    if (!wasBusy) {
      entry.lastStopReason = null
    }
    entry.updatedAt = this.timestamp()
    this.requestQueuedTurnInterrupt(entry)
    this.emitSnapshot()

    const executeTurn = async (): Promise<AgentChatRuntimeResult> => {
      let traceSpan: AgentRuntimeTraceSpan | null = null
      try {
        if (this.disposed) {
          throw new Error(runtimeDisposedMessage)
        }
        this.setTurnPhase(entry, 'resolving-context')
        const { agent, session, driver, context } = await this.resolveDriverContext({
          agentId: request.agentId,
          sessionId: request.sessionId
        })
        entry.agentId = agent.id
        entry.agentType = agent.type
        traceSpan = this.startTraceSpan('send-message', {
          agentId: agent.id,
          agentType: agent.type,
          sessionId: session.id,
          runId,
          traceId: entry.traceId,
          parentResumeToken: entry.lastResumeToken
        })
        const preDispatchStopReason = this.consumePreDispatchStopReason(entry, runId)
        if (preDispatchStopReason) {
          entry.lastStopReason = cloneStopReason(preDispatchStopReason)
          this.setTurnPhase(entry, 'pausing')
          throwRuntimeAbort()
        }
        entry.currentRunId = runId
        entry.currentDriver = driver
        this.setTurnPhase(entry, 'opening-stream')
        if (
          !entry.interruptRequested &&
          entry.pendingSessionCancelReason === null &&
          !(runId && entry.pendingCancelReasonByRunId.has(runId))
        ) {
          entry.lastStopReason = null
        }

        const resultPromise = driver.sendMessage(request, context)
        if (entry.pendingSessionCancelReason) {
          const pendingSessionCancelReason = entry.pendingSessionCancelReason
          entry.pendingSessionCancelReason = null
          queueMicrotask(() => {
            driver.cancelSession(session.id, pendingSessionCancelReason)
          })
        }
        const pendingRunCancelReason = runId ? entry.pendingCancelReasonByRunId.get(runId) ?? null : null
        if (runId && pendingRunCancelReason) {
          entry.pendingCancelReasonByRunId.delete(runId)
          queueMicrotask(() => {
            driver.cancelMessage(runId, pendingRunCancelReason)
          })
        }
        this.requestQueuedTurnInterrupt(entry)
        entry.updatedAt = this.timestamp()
        this.emitSnapshot()

        const result = await resultPromise
        this.setTurnPhase(entry, 'finishing')
        entry.lastResumeToken = result.assistantMessage.runtimeResumeToken
        entry.lastResumeTokenSource = result.assistantMessage.runtimeResumeToken ? 'runtime' : null
        entry.lastTerminalStatus = normalizeTerminalStatus(result.assistantMessage.status)
        this.endTraceSpan(traceSpan, {
          status: entry.lastTerminalStatus,
          stopReason: entry.lastStopReason,
          resumeToken: entry.lastResumeToken
        })
        traceSpan = null
        return result
      } catch (error) {
        entry.lastTerminalStatus = isRuntimeAbortError(error) ? 'paused' : 'error'
        entry.lastStopReason =
          entry.lastTerminalStatus === 'error'
            ? {
                kind: 'runtime-stop',
                message: error instanceof Error ? error.message : String(error)
              }
            : entry.lastStopReason
        if (entry.lastTerminalStatus === 'paused') {
          this.setTurnPhase(entry, 'pausing')
        } else {
          this.setTurnPhase(entry, 'finishing')
        }
        this.endTraceSpan(traceSpan, {
          status: entry.lastTerminalStatus,
          stopReason: entry.lastStopReason,
          resumeToken: null
        })
        traceSpan = null
        throw error
      } finally {
        this.clearRuntimeChunksForSession(request.sessionId)
        entry.activeToolIds.clear()
        entry.interruptRequested = false
        entry.interruptDispatched = false
        entry.inflightRequestCount = Math.max(0, entry.inflightRequestCount - 1)
        entry.queuedTurnCount = Math.max(0, entry.inflightRequestCount - 1)
        if (runId) entry.activeRunIds.delete(runId)
        if (entry.currentRunId === runId) {
          entry.currentRunId = null
          entry.currentDriver = null
        }
        entry.turnPhase = deriveTurnPhase(entry)
        entry.updatedAt = this.timestamp()
        this.emitSnapshot()
      }
    }

    const runPromise = entry.executionChain.then(executeTurn, executeTurn)
    entry.executionChain = runPromise.then(
      () => undefined,
      () => undefined
    )
    return runPromise
  }

  async prewarmSession(request: AgentRuntimePrewarmSessionRequest): Promise<AgentRuntimePrewarmSessionResult> {
    if (this.disposed) {
      throw new Error(runtimeDisposedMessage)
    }

    const entry = this.getOrCreateEntry(request.sessionId, request.agentId, null)
    entry.agentId = request.agentId
    entry.warmState = 'warming'
    entry.lastWarmResultMessage = null
    entry.updatedAt = this.timestamp()
    this.emitSnapshot()

    const { agent, session, driver, context } = await this.resolveDriverContext(request)
    const traceSpan = this.startTraceSpan('prewarm-session', {
      agentId: agent.id,
      agentType: agent.type,
      sessionId: session.id,
      runId: null,
      traceId: entry.traceId,
      parentResumeToken: entry.lastResumeToken
    })
    if (!driver.prewarmSession) {
      const result: AgentRuntimePrewarmSessionResult = {
        ok: false,
        reason: 'prewarm-unavailable',
        message: `Runtime driver for agent "${request.agentId}" does not support session prewarm.`
      }
      entry.warmState = 'cold'
      entry.lastWarmResultMessage = result.message
      entry.updatedAt = this.timestamp()
      this.emitSnapshot()
      this.endTraceSpan(traceSpan, {
        status: 'error',
        stopReason: null,
        resumeToken: entry.lastResumeToken
      })
      return result
    }

    try {
      const result = await driver.prewarmSession(request, context)
      entry.warmState = result.ok ? 'warm' : 'error'
      entry.lastWarmAt = result.ok ? this.timestamp() : entry.lastWarmAt
      entry.lastWarmResultMessage = result.ok ? null : result.message
      entry.updatedAt = this.timestamp()
      this.emitSnapshot()
      this.endTraceSpan(traceSpan, {
        status: result.ok ? 'success' : 'error',
        stopReason: null,
        resumeToken: entry.lastResumeToken
      })
      return result
    } catch (error) {
      entry.warmState = 'error'
      entry.lastWarmResultMessage = error instanceof Error ? error.message : String(error)
      entry.updatedAt = this.timestamp()
      this.emitSnapshot()
      this.endTraceSpan(traceSpan, {
        status: isRuntimeAbortError(error) ? 'paused' : 'error',
        stopReason: entry.lastStopReason,
        resumeToken: entry.lastResumeToken
      })
      throw error
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.clearAllApprovalChunks(runtimeDisposeApprovalDenyMessage)
    this.deps.toolApprovalRegistry?.clearAll(runtimeDisposeApprovalDenyMessage)
    for (const [sessionId, entry] of this.entries) {
      entry.lastStopReason = cloneStopReason(runtimeDisposeStopReason)
      entry.turnPhase = entry.inflightRequestCount > 0 ? 'pausing' : deriveTurnPhase(entry)
      if (entry.currentDriver) {
        entry.currentDriver.cancelSession(sessionId, runtimeDisposeStopReason)
      } else if (entry.inflightRequestCount > 0) {
        entry.pendingSessionCancelReason = cloneStopReason(runtimeDisposeStopReason)
        entry.updatedAt = this.timestamp()
      }
    }
    this.emitSnapshot()
    await this.flushTraceRecorder()
  }

  private async resolveDriverContext(request: AgentRuntimePrewarmSessionRequest): Promise<{
    agent: AgentStoreState['agents'][number]
    session: AgentStoreState['sessions'][number]
    driver: AgentRuntimeDriver
    context: AgentRuntimeDriverContext
  }> {
    const state = await this.deps.getAgentState()
    const session = state.sessions.find((item) => item.id === request.sessionId)
    if (!session) {
      throw new Error(`Session "${request.sessionId}" was not found.`)
    }
    if (session.agentId !== request.agentId) {
      throw new Error(`Session "${request.sessionId}" does not belong to agent "${request.agentId}".`)
    }
    const agent = state.agents.find((item) => item.id === request.agentId)
    if (!agent) {
      throw new Error(`Agent "${request.agentId}" was not found.`)
    }

    const driver = this.deps.driverRegistry.require(agent.type)
    const composition = await this.deps.compositionService?.compose({
      state,
      agentId: agent.id,
      sessionId: session.id
    })
    const entry = this.getOrCreateEntry(session.id, agent.id, agent.type)
    this.hydrateEntryFromPersistedState(entry, state)
    entry.agentId = agent.id
    entry.agentType = agent.type
    entry.traceId = normalizeTraceId(session.traceId)

    return {
      agent,
      session,
      driver,
      context: {
        composition,
        traceId: entry.traceId,
        lastResumeToken: entry.lastResumeToken
      }
    }
  }

  private getOrCreateEntry(
    sessionId: string,
    agentId: string | null,
    agentType: AgentSessionRuntimeState['agentType']
  ): RuntimeEntry {
    const existing = this.entries.get(sessionId)
    if (existing) return existing

    const created: RuntimeEntry = {
      sessionId,
      agentId,
      agentType,
      inflightRequestCount: 0,
      queuedTurnCount: 0,
      activeRunIds: new Set<string>(),
      activeToolIds: new Set<string>(),
      turnPhase: 'idle',
      pendingCancelReasonByRunId: new Map<string, AgentRuntimeStopReason>(),
      pendingSessionCancelReason: null,
      currentRunId: null,
      currentDriver: null,
      interruptRequested: false,
      interruptDispatched: false,
      executionChain: Promise.resolve(),
      lastRunId: null,
      lastResumeToken: null,
      lastResumeTokenSource: null,
      lastTerminalStatus: null,
      lastStopReason: null,
      warmState: 'cold',
      traceId: null,
      lastWarmAt: null,
      lastWarmResultMessage: null,
      updatedAt: this.timestamp()
    }
    this.entries.set(sessionId, created)
    return created
  }

  private hydrateEntryFromPersistedState(entry: RuntimeEntry, state: AgentStoreState): void {
    const persisted = readPersistedSessionRuntimeState(state, entry.sessionId)
    if (persisted.lastResumeToken && persisted.lastResumeToken !== entry.lastResumeToken) {
      entry.lastResumeToken = persisted.lastResumeToken
      entry.lastResumeTokenSource = persisted.lastResumeTokenSource
    }
    if (persisted.lastTerminalStatus) {
      entry.lastTerminalStatus = persisted.lastTerminalStatus
    }
  }

  private requireToolApprovalRegistry(): ToolApprovalRegistry {
    if (!this.deps.toolApprovalRegistry) {
      throw new Error('Tool approval registry is not configured for this runtime service.')
    }
    return this.deps.toolApprovalRegistry
  }

  emitChunk(chunk: AgentRuntimeSessionChunk): void {
    const entry = this.getOrCreateEntry(chunk.sessionId, null, null)
    this.applyChunkRuntimeState(entry, chunk)
    this.appendChunk(chunk)
    this.requestQueuedTurnInterrupt(entry)
    this.emitSnapshot()
  }

  private applyChunkRuntimeState(entry: RuntimeEntry, chunk: AgentRuntimeSessionChunk): void {
    switch (chunk.type) {
      case 'assistant-text-update':
      case 'reasoning-start':
      case 'reasoning-delta':
      case 'reasoning-end':
      case 'runtime-control':
        if (entry.turnPhase !== 'pausing' && entry.turnPhase !== 'finishing') {
          entry.turnPhase = 'streaming'
          entry.updatedAt = this.timestamp()
        }
        return
      case 'tool-input-start':
      case 'tool-input-available':
        entry.activeToolIds.add(chunk.toolCallId)
        if (entry.turnPhase !== 'pausing' && entry.turnPhase !== 'finishing') {
          entry.turnPhase = 'streaming'
          entry.updatedAt = this.timestamp()
        }
        return
      case 'tool-output-available':
      case 'tool-output-error':
      case 'tool-output-denied':
        entry.activeToolIds.delete(chunk.toolCallId)
        if (entry.turnPhase !== 'pausing' && entry.turnPhase !== 'finishing') {
          entry.turnPhase = 'streaming'
          entry.updatedAt = this.timestamp()
        }
        return
      default:
        return
    }
  }

  private requestQueuedTurnInterrupt(entry: RuntimeEntry): void {
    if (entry.queuedTurnCount <= 0 || entry.inflightRequestCount <= 1) {
      return
    }
    if (entry.pendingSessionCancelReason && entry.pendingSessionCancelReason.kind !== 'interrupt') {
      return
    }
    if (entry.lastStopReason && entry.lastStopReason.kind !== 'interrupt') {
      return
    }

    entry.interruptRequested = true
    entry.lastStopReason = cloneStopReason(queuedTurnInterruptReason)
    entry.turnPhase = 'pausing'
    entry.updatedAt = this.timestamp()

    if (entry.activeToolIds.size > 0 || !entry.currentRunId || entry.interruptDispatched) {
      return
    }

    entry.interruptDispatched = true
    if (entry.currentDriver) {
      entry.currentDriver.cancelMessage(entry.currentRunId, queuedTurnInterruptReason)
      return
    }
    entry.pendingCancelReasonByRunId.set(entry.currentRunId, cloneStopReason(queuedTurnInterruptReason))
  }

  private consumePreDispatchStopReason(
    entry: RuntimeEntry,
    runId: string | null
  ): AgentRuntimeStopReason | null {
    if (entry.pendingSessionCancelReason) {
      const reason = cloneStopReason(entry.pendingSessionCancelReason)
      entry.pendingSessionCancelReason = null
      return reason
    }

    if (runId) {
      const pendingRunCancelReason = entry.pendingCancelReasonByRunId.get(runId)
      if (pendingRunCancelReason) {
        entry.pendingCancelReasonByRunId.delete(runId)
        return cloneStopReason(pendingRunCancelReason)
      }
    }

    return null
  }

  private appendChunk(chunk: AgentRuntimeSessionChunk): void {
    const current = this.chunksBySessionId.get(chunk.sessionId) ?? []
    const next = isApprovalChunk(chunk)
      ? [...current.filter((candidate) => !(isApprovalChunk(candidate) && candidate.approvalId === chunk.approvalId)), chunk]
      : isAssistantTextUpdateChunk(chunk)
        ? [
            ...current.filter(
              (candidate) =>
                !isAssistantTextUpdateChunk(candidate) ||
                candidate.runId !== chunk.runId
            ),
            chunk
          ]
        : [...current, chunk]
    this.chunksBySessionId.set(chunk.sessionId, boundRuntimeChunks(next))
  }

  private replaceApprovalRequestWithResolvedChunk(
    pending: AgentSessionRuntimeSnapshot['toolApprovals'][number],
    decision: ToolApprovalDecision
  ): void {
    const current = this.chunksBySessionId.get(pending.sessionId) ?? []
    const resolvedChunk = createToolApprovalResolvedChunk(pending, decision)
    const next = [
      ...current.filter(
        (candidate) =>
          !(isApprovalChunk(candidate) && candidate.approvalId === pending.approvalId) &&
          !(
            isApprovalResolvedChunk(candidate) &&
            candidate.approvalId === pending.approvalId
          )
      ),
      resolvedChunk
    ]
    this.chunksBySessionId.set(pending.sessionId, next)
  }

  private removeChunkByApprovalId(sessionId: string, approvalId: string): void {
    const current = this.chunksBySessionId.get(sessionId)
    if (!current) return
    const next = current.filter((candidate) => !isApprovalChunk(candidate) || candidate.approvalId !== approvalId)
    if (next.length === 0) {
      this.chunksBySessionId.delete(sessionId)
      return
    }
    this.chunksBySessionId.set(sessionId, next)
  }

  private clearAllApprovalChunks(message: string): void {
    const pendingBySession = new Map<string, AgentSessionRuntimeSnapshot['toolApprovals']>()
    for (const pending of this.deps.toolApprovalRegistry?.listPending() ?? []) {
      const current = pendingBySession.get(pending.sessionId) ?? []
      current.push(pending)
      pendingBySession.set(pending.sessionId, current)
    }
    for (const [sessionId, pendingApprovals] of pendingBySession.entries()) {
      this.replaceSessionApprovalRequestsWithResolvedChunks(sessionId, pendingApprovals, message)
    }
  }

  private clearChunksForSession(sessionId: string): void {
    const approvalRegistry = this.deps.toolApprovalRegistry
    const pendingApprovals = approvalRegistry?.listPending().filter((candidate) => candidate.sessionId === sessionId) ?? []
    this.replaceSessionApprovalRequestsWithResolvedChunks(sessionId, pendingApprovals, sessionStopApprovalDenyMessage)
  }

  private replaceSessionApprovalRequestsWithResolvedChunks(
    sessionId: string,
    pendingApprovals: AgentSessionRuntimeSnapshot['toolApprovals'],
    message: string
  ): void {
    const current = this.chunksBySessionId.get(sessionId) ?? []
    const resolvedApprovalChunks = pendingApprovals.map((pending) =>
      createToolApprovalResolvedChunk(pending, {
        behavior: 'deny',
        message
      })
    )
    const next = [
      ...current.filter((candidate) => !isApprovalChunk(candidate)),
      ...resolvedApprovalChunks
    ]
    if (next.length === 0) {
      this.chunksBySessionId.delete(sessionId)
      return
    }
    this.chunksBySessionId.set(sessionId, next)
  }

  private clearRuntimeChunksForSession(sessionId: string): void {
    const current = this.chunksBySessionId.get(sessionId)
    if (!current) return
    const next = current.filter((chunk) => isApprovalChunk(chunk) || isApprovalResolvedChunk(chunk))
    if (next.length === 0) {
      this.chunksBySessionId.delete(sessionId)
      return
    }
    this.chunksBySessionId.set(sessionId, next)
  }

  private emitSnapshot(): void {
    const snapshot = this.getSnapshot()
    for (const listener of this.listeners) {
      listener(snapshot)
    }
  }

  private setTurnPhase(entry: RuntimeEntry, turnPhase: AgentSessionRuntimeState['turnPhase']): void {
    entry.turnPhase = turnPhase
    entry.updatedAt = this.timestamp()
    this.emitSnapshot()
  }

  private startTraceSpan(
    operation: AgentRuntimeTraceOperation,
    input: {
      traceId: string | null
      agentId: string
      agentType: AgentSessionRuntimeState['agentType']
      sessionId: string
      runId: string | null
      parentResumeToken: string | null
    }
  ): AgentRuntimeTraceSpan | null {
    if (!this.deps.traceRecorder || input.agentType === null) return null
    try {
      return (
        this.deps.traceRecorder.startSpan({
          operation,
          traceId: input.traceId,
          agentId: input.agentId,
          agentType: input.agentType,
          sessionId: input.sessionId,
          runId: input.runId,
          parentResumeToken: input.parentResumeToken,
          startedAt: this.timestamp()
        }) ?? null
      )
    } catch {
      return null
    }
  }

  private endTraceSpan(
    span: AgentRuntimeTraceSpan | null,
    input: {
      status: AgentSessionRuntimeTerminalStatus
      stopReason: AgentRuntimeStopReason | null
      resumeToken: string | null
    }
  ): void {
    if (!span) return
    try {
      span.end({
        status: input.status,
        endedAt: this.timestamp(),
        stopReason: input.stopReason ? cloneStopReason(input.stopReason) : null,
        resumeToken: input.resumeToken
      })
    } catch {
      // Trace sinks must never affect the user-visible runtime turn.
    }
  }

  private async flushTraceRecorder(): Promise<void> {
    try {
      await this.deps.traceRecorder?.flush?.()
    } catch {
      // Trace sinks must never affect runtime shutdown.
    }
  }
}

function boundRuntimeChunks(chunks: AgentRuntimeSessionChunk[]): AgentRuntimeSessionChunk[] {
  if (chunks.length <= MAX_RUNTIME_CHUNKS_PER_SESSION) return chunks
  let excess = chunks.length - MAX_RUNTIME_CHUNKS_PER_SESSION
  const kept: AgentRuntimeSessionChunk[] = []
  for (const chunk of chunks) {
    if (excess > 0 && !isApprovalChunk(chunk) && !isApprovalResolvedChunk(chunk)) {
      excess -= 1
      continue
    }
    kept.push(chunk)
  }
  return kept
}

function isApprovalChunk(chunk: AgentRuntimeSessionChunk): chunk is Extract<AgentRuntimeSessionChunk, { type: 'tool-approval-request' }> {
  return chunk.type === 'tool-approval-request'
}

function isApprovalResolvedChunk(
  chunk: AgentRuntimeSessionChunk
): chunk is AgentRuntimeToolApprovalResolvedChunk {
  return chunk.type === 'tool-approval-resolved'
}

function isAssistantTextUpdateChunk(
  chunk: AgentRuntimeSessionChunk
): chunk is AgentRuntimeAssistantTextUpdateChunk {
  return chunk.type === 'assistant-text-update'
}

function normalizeTerminalStatus(status: AgentChatRuntimeResult['assistantMessage']['status']): AgentSessionRuntimeTerminalStatus {
  if (status === 'paused') return 'paused'
  if (status === 'error') return 'error'
  return 'success'
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

function createToolApprovalResolvedChunk(
  pending: Pick<AgentSessionRuntimeSnapshot['toolApprovals'][number], 'approvalId' | 'sessionId' | 'toolCallId' | 'toolName'>,
  decision: ToolApprovalDecision
): AgentRuntimeToolApprovalResolvedChunk {
  return {
    type: 'tool-approval-resolved',
    approvalId: pending.approvalId,
    sessionId: pending.sessionId,
    toolCallId: pending.toolCallId,
    toolName: pending.toolName,
    decision: decision.behavior,
    ...(decision.behavior === 'allow' && Object.prototype.hasOwnProperty.call(decision, 'updatedInput')
      ? { updatedInput: decision.updatedInput }
      : {}),
    ...(decision.behavior === 'deny' ? { message: decision.message } : {})
  }
}

function createApprovalId(): string {
  return `tool-approval-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function toSnapshotState(entry: RuntimeEntry): AgentSessionRuntimeState {
  return {
    sessionId: entry.sessionId,
    agentId: entry.agentId,
    agentType: entry.agentType,
    inflightRequestCount: entry.inflightRequestCount,
    queuedTurnCount: entry.queuedTurnCount,
    turnState: deriveTurnState(entry),
    turnPhase: deriveTurnPhase(entry),
    warmState: entry.warmState,
    traceId: entry.traceId,
    lastRunId: entry.lastRunId,
    lastResumeToken: entry.lastResumeToken,
    lastResumeTokenSource: entry.lastResumeTokenSource,
    lastTerminalStatus: entry.lastTerminalStatus,
    lastStopReason: entry.lastStopReason ? cloneStopReason(entry.lastStopReason) : null,
    lastWarmAt: entry.lastWarmAt,
    lastWarmResultMessage: entry.lastWarmResultMessage,
    updatedAt: entry.updatedAt
  }
}

function deriveTurnState(entry: RuntimeEntry): AgentSessionRuntimeState['turnState'] {
  const hasPendingStop =
    entry.lastStopReason !== null ||
    (entry.currentRunId !== null && entry.pendingCancelReasonByRunId.has(entry.currentRunId)) ||
    entry.pendingSessionCancelReason !== null
  if (entry.currentRunId) {
    return hasPendingStop ? 'stopping' : 'running'
  }
  if (entry.inflightRequestCount > 0 || entry.queuedTurnCount > 0) {
    return 'queued'
  }
  return 'idle'
}

function deriveTurnPhase(entry: RuntimeEntry): AgentSessionRuntimeState['turnPhase'] {
  const turnState = deriveTurnState(entry)
  if (turnState === 'idle') return 'idle'
  if (turnState === 'queued') return 'queued'
  if (turnState === 'stopping') return 'pausing'
  return entry.turnPhase === 'idle' || entry.turnPhase === 'queued' ? 'resolving-context' : entry.turnPhase
}

function cloneStopReason(reason: AgentRuntimeStopReason): AgentRuntimeStopReason {
  return {
    kind: reason.kind,
    ...(reason.message ? { message: reason.message } : {})
  }
}

function normalizeTraceId(traceId: string | undefined): string | null {
  if (typeof traceId !== 'string') return null
  const trimmed = traceId.trim()
  return trimmed.length > 0 ? trimmed : null
}
