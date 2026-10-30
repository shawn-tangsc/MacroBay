import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AgentEntity } from '../schemas/agentSchemas'
import type { AgentSessionEntity } from '../schemas/sessionSchemas'
import type { AgentWorkspaceEntity } from '../schemas/workspaceSchemas'
import { createAgentStoreState, type AgentStoreState } from '../store/agentStore'
import { ToolApprovalRegistry } from './policy'
import type { AgentChatRuntimeRequest, AgentChatRuntimeResult } from './agentChatRuntime'
import { AgentSessionRuntimeService, MAX_RUNTIME_CHUNKS_PER_SESSION } from './AgentSessionRuntimeService'
import type { AgentRuntimeComposition } from './AgentRuntimeCompositionService'
import { RuntimeDriverRegistry } from './RuntimeDriverRegistry'
import type {
  AgentRuntimeDriver,
  AgentRuntimeTraceRecorder,
  AgentRuntimeTraceSpanEnd,
  AgentRuntimeTraceSpanStart
} from './runtimeTypes'

const createdAt = '2026-01-01T00:00:00.000Z'

const workspace: AgentWorkspaceEntity = {
  id: 'workspace-1',
  name: 'Workspace',
  path: '/tmp/workspace',
  type: 'user',
  orderKey: '0001',
  createdAt,
  updatedAt: createdAt
}

const agent: AgentEntity = {
  id: 'agent-1',
  type: 'claude-code',
  name: 'Code Assistant',
  instructions: 'Answer as a concise code assistant.',
  model: 'provider-1:chat-model',
  modelName: 'Chat Model',
  configuration: { permission_mode: 'default' },
  createdAt,
  updatedAt: createdAt,
  orderKey: '0001'
}

const session: AgentSessionEntity = {
  id: 'session-1',
  agentId: 'agent-1',
  name: 'Session',
  workspaceId: workspace.id,
  workspace,
  orderKey: '0001',
  createdAt,
  updatedAt: createdAt
}

function createState(overrides: Partial<AgentStoreState> = {}): AgentStoreState {
  return createAgentStoreState({
    agents: [agent],
    sessions: [session],
    workspaces: [workspace],
    messagesBySessionId: {
      'session-1': []
    },
    activeAgentId: 'agent-1',
    activeSessionId: 'session-1',
    ...overrides
  })
}

function createRuntimeResult(
  request: AgentChatRuntimeRequest,
  status: 'success' | 'paused' | 'error' = 'success'
): AgentChatRuntimeResult {
  return {
    state: createState({
      messagesBySessionId: {
        'session-1': [
          {
            id: `user-${request.runId ?? 'default'}`,
            sessionId: request.sessionId,
            role: 'user',
            data: { parts: [{ type: 'text', text: request.text }] },
            searchableText: request.text,
            status: 'success',
            modelId: null,
            modelSnapshot: null,
            stats: null,
            runtimeResumeToken: null,
            createdAt,
            updatedAt: createdAt
          },
          {
            id: `assistant-${request.runId ?? 'default'}`,
            sessionId: request.sessionId,
            role: 'assistant',
            data: { parts: [{ type: 'text', text: `reply:${request.text}` }] },
            searchableText: `reply:${request.text}`,
            status,
            modelId: agent.model,
            modelSnapshot: agent.model
              ? {
                  id: 'chat-model',
                  name: 'Chat Model',
                  provider: 'provider-1'
                }
              : null,
            stats: null,
            runtimeResumeToken: `resume:${request.runId ?? 'default'}`,
            createdAt,
            updatedAt: createdAt
          }
        ]
      }
    }),
    userMessage: {
      id: `user-${request.runId ?? 'default'}`,
      sessionId: request.sessionId,
      role: 'user',
      data: { parts: [{ type: 'text', text: request.text }] },
      searchableText: request.text,
      status: 'success',
      modelId: null,
      modelSnapshot: null,
      stats: null,
      runtimeResumeToken: null,
      createdAt,
      updatedAt: createdAt
    },
    assistantMessage: {
      id: `assistant-${request.runId ?? 'default'}`,
      sessionId: request.sessionId,
      role: 'assistant',
      data: { parts: [{ type: 'text', text: `reply:${request.text}` }] },
      searchableText: `reply:${request.text}`,
      status,
      modelId: agent.model,
      modelSnapshot: agent.model
        ? {
            id: 'chat-model',
            name: 'Chat Model',
            provider: 'provider-1'
          }
        : null,
      stats: null,
      runtimeResumeToken: `resume:${request.runId ?? 'default'}`,
      createdAt,
      updatedAt: createdAt
    }
  }
}

function createDeferredDriver() {
  const pending: Array<{
    request: AgentChatRuntimeRequest
    resolve: (value: AgentChatRuntimeResult) => void
    reject: (error: unknown) => void
  }> = []
  const driver: AgentRuntimeDriver = {
    sendMessage: vi.fn((request: AgentChatRuntimeRequest) => {
      return new Promise<AgentChatRuntimeResult>((resolve, reject) => {
        pending.push({ request, resolve, reject })
      })
    }),
    cancelMessage: vi.fn(() => true),
    cancelSession: vi.fn(() => true)
  }

  return { driver, pending }
}

function createDeferredPromise<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })

  return {
    promise,
    resolve,
    reject
  }
}

function createTraceRecorder() {
  const spans: Array<{
    start: AgentRuntimeTraceSpanStart
    ends: AgentRuntimeTraceSpanEnd[]
  }> = []
  const flush = vi.fn()
  const recorder: AgentRuntimeTraceRecorder = {
    startSpan: vi.fn((start: AgentRuntimeTraceSpanStart) => {
      const span = {
        start,
        ends: [] as AgentRuntimeTraceSpanEnd[]
      }
      spans.push(span)
      return {
        end: (end: AgentRuntimeTraceSpanEnd) => {
          span.ends.push(end)
        }
      }
    }),
    flush
  }

  return {
    recorder,
    spans,
    flush
  }
}

afterEach(() => {
  vi.useRealTimers()
})

async function waitForPendingRequest(
  pending: Array<{
    request: AgentChatRuntimeRequest
    resolve: (value: AgentChatRuntimeResult) => void
    reject: (error: unknown) => void
  }>,
  index: number
): Promise<{
  request: AgentChatRuntimeRequest
  resolve: (value: AgentChatRuntimeResult) => void
  reject: (error: unknown) => void
}> {
  await vi.waitFor(() => {
    expect(pending[index]).toBeDefined()
  })
  return pending[index]!
}

describe('agent session runtime service', () => {
  it('tracks a running session as busy without relying on message state', async () => {
    const registry = new RuntimeDriverRegistry()
    const { driver, pending } = createDeferredDriver()
    registry.register('claude-code', driver)
    const runtime = new AgentSessionRuntimeService({
      getAgentState: async () => createState(),
      driverRegistry: registry
    })

    const turn = runtime.sendMessage({
      agentId: 'agent-1',
      sessionId: 'session-1',
      text: 'First turn',
      runId: 'run-1'
    })

    await vi.waitFor(() => expect(runtime.isSessionBusy('session-1')).toBe(true))
    await vi.waitFor(() =>
      expect(runtime.getSnapshot().sessions['session-1']).toMatchObject({
        agentType: 'claude-code'
      })
    )
    expect(runtime.getSnapshot().sessions['session-1']).toMatchObject({
      sessionId: 'session-1',
      agentId: 'agent-1',
      agentType: 'claude-code',
      inflightRequestCount: 1,
      queuedTurnCount: 0,
      lastRunId: 'run-1',
      lastTerminalStatus: null
    })

    const firstPending = await waitForPendingRequest(pending, 0)
    firstPending.resolve(
      createRuntimeResult({
        agentId: 'agent-1',
        sessionId: 'session-1',
        text: 'First turn',
        runId: 'run-1'
      })
    )
    await turn

    expect(runtime.isSessionBusy('session-1')).toBe(false)
    expect(runtime.getSnapshot().sessions['session-1']).toMatchObject({
      inflightRequestCount: 0,
      queuedTurnCount: 0,
      lastTerminalStatus: 'success',
      lastResumeToken: 'resume:run-1'
    })
  })

  it('tracks queued turns while the current turn is still running', async () => {
    const registry = new RuntimeDriverRegistry()
    const { driver, pending } = createDeferredDriver()
    registry.register('claude-code', driver)
    const runtime = new AgentSessionRuntimeService({
      getAgentState: async () => createState(),
      driverRegistry: registry
    })

    const first = runtime.sendMessage({
      agentId: 'agent-1',
      sessionId: 'session-1',
      text: 'First turn',
      runId: 'run-1'
    })
    await waitForPendingRequest(pending, 0)
    const second = runtime.sendMessage({
      agentId: 'agent-1',
      sessionId: 'session-1',
      text: 'Second turn',
      runId: 'run-2'
    })

    await vi.waitFor(() =>
      expect(runtime.getSnapshot().sessions['session-1']).toMatchObject({
        inflightRequestCount: 2,
        queuedTurnCount: 1,
        lastRunId: 'run-2',
        turnState: 'stopping',
        lastStopReason: {
          kind: 'interrupt'
        }
      })
    )

    pending[0]!.resolve(
      createRuntimeResult({
        agentId: 'agent-1',
        sessionId: 'session-1',
        text: 'First turn',
        runId: 'run-1'
      }, 'paused')
    )
    await first

    await vi.waitFor(() =>
      expect(runtime.getSnapshot().sessions['session-1']).toMatchObject({
        inflightRequestCount: 1,
        queuedTurnCount: 0,
        lastTerminalStatus: 'paused',
        lastStopReason: {
          kind: 'interrupt'
        }
      })
    )

    await vi.waitFor(() => {
      const snapshot = runtime.getSnapshot().sessions['session-1']
      expect(snapshot).toMatchObject({
        inflightRequestCount: 1,
        lastRunId: 'run-2'
      })
      expect(pending[1]).toBeDefined()
    })

    const secondPending = await waitForPendingRequest(pending, 1)
    secondPending.resolve(
      createRuntimeResult({
        agentId: 'agent-1',
        sessionId: 'session-1',
        text: 'Second turn',
        runId: 'run-2'
      })
    )
    await second

    expect(runtime.getSnapshot().sessions['session-1']).toMatchObject({
      inflightRequestCount: 0,
      queuedTurnCount: 0,
      lastRunId: 'run-2',
      lastTerminalStatus: 'success',
      lastStopReason: null
    })
  })

  it('exposes begin/open turn phases through the runtime snapshot', async () => {
    const registry = new RuntimeDriverRegistry()
    const { driver, pending } = createDeferredDriver()
    registry.register('claude-code', driver)
    const stateDeferred = createDeferredPromise<AgentStoreState>()
    const runtime = new AgentSessionRuntimeService({
      getAgentState: () => stateDeferred.promise,
      driverRegistry: registry
    })
    const snapshots: ReturnType<AgentSessionRuntimeService['getSnapshot']>[] = []
    const unsubscribe = runtime.subscribe((snapshot) => snapshots.push(snapshot))

    const turn = runtime.sendMessage({
      agentId: 'agent-1',
      sessionId: 'session-1',
      text: 'Phase me',
      runId: 'run-1'
    })

    expect(runtime.getSnapshot().sessions['session-1']).toMatchObject({
      turnState: 'running',
      turnPhase: 'resolving-context'
    })

    stateDeferred.resolve(createState())
    await waitForPendingRequest(pending, 0)

    expect(runtime.getSnapshot().sessions['session-1']).toMatchObject({
      turnState: 'running',
      turnPhase: 'opening-stream'
    })

    runtime.emitChunk({
      type: 'assistant-text-update',
      sessionId: 'session-1',
      runId: 'run-1',
      text: 'partial',
      textDelta: 'partial',
      mode: 'append'
    })

    expect(runtime.getSnapshot().sessions['session-1']).toMatchObject({
      turnState: 'running',
      turnPhase: 'streaming'
    })

    pending[0]!.resolve(
      createRuntimeResult({
        agentId: 'agent-1',
        sessionId: 'session-1',
        text: 'Phase me',
        runId: 'run-1'
      })
    )

    await turn
    unsubscribe()

    expect(snapshots.some((snapshot) => snapshot.sessions['session-1']?.turnPhase === 'finishing')).toBe(true)

    expect(runtime.getSnapshot().sessions['session-1']).toMatchObject({
      turnState: 'idle',
      turnPhase: 'idle',
      lastTerminalStatus: 'success'
    })
  })

  it('interrupts the pre-dispatch current turn when a newer queued turn arrives before driver dispatch begins', async () => {
    const registry = new RuntimeDriverRegistry()
    const { driver, pending } = createDeferredDriver()
    registry.register('claude-code', driver)
    const stateDeferred = createDeferredPromise<AgentStoreState>()
    let resolveCount = 0
    const runtime = new AgentSessionRuntimeService({
      getAgentState: () => {
        resolveCount += 1
        return resolveCount === 1 ? stateDeferred.promise : Promise.resolve(createState())
      },
      driverRegistry: registry
    })

    const first = runtime.sendMessage({
      agentId: 'agent-1',
      sessionId: 'session-1',
      text: 'First turn',
      runId: 'run-1'
    })
    const second = runtime.sendMessage({
      agentId: 'agent-1',
      sessionId: 'session-1',
      text: 'Second turn',
      runId: 'run-2'
    })

    expect(runtime.getSnapshot().sessions['session-1']).toMatchObject({
      inflightRequestCount: 2,
      queuedTurnCount: 1,
      lastRunId: 'run-2',
      lastStopReason: {
        kind: 'interrupt'
      }
    })

    stateDeferred.resolve(createState())

    await expect(first).rejects.toMatchObject({
      name: 'AbortError'
    })
    expect(driver.cancelMessage).not.toHaveBeenCalled()

    const secondPending = await waitForPendingRequest(pending, 0)
    expect(secondPending.request.runId).toBe('run-2')
    secondPending.resolve(
      createRuntimeResult({
        agentId: 'agent-1',
        sessionId: 'session-1',
        text: 'Second turn',
        runId: 'run-2'
      })
    )
    await second

    expect(driver.sendMessage).toHaveBeenCalledTimes(1)
    expect(runtime.getSnapshot().sessions['session-1']).toMatchObject({
      inflightRequestCount: 0,
      queuedTurnCount: 0,
      lastRunId: 'run-2',
      lastTerminalStatus: 'success',
      lastStopReason: null
    })
  })

  it('requests interrupt for the active run when a newer queued turn arrives', async () => {
    const registry = new RuntimeDriverRegistry()
    const { driver, pending } = createDeferredDriver()
    registry.register('claude-code', driver)
    const runtime = new AgentSessionRuntimeService({
      getAgentState: async () => createState(),
      driverRegistry: registry
    })

    const first = runtime.sendMessage({
      agentId: 'agent-1',
      sessionId: 'session-1',
      text: 'First turn',
      runId: 'run-1'
    })

    await waitForPendingRequest(pending, 0)

    const second = runtime.sendMessage({
      agentId: 'agent-1',
      sessionId: 'session-1',
      text: 'Second turn',
      runId: 'run-2'
    })

    await vi.waitFor(() =>
      expect(driver.cancelMessage).toHaveBeenCalledWith('run-1', {
        kind: 'interrupt',
        message: 'Interrupted by a newer queued turn.'
      })
    )
    expect(runtime.getSnapshot().sessions['session-1']).toMatchObject({
      inflightRequestCount: 2,
      queuedTurnCount: 1,
      turnState: 'stopping',
      lastStopReason: {
        kind: 'interrupt'
      }
    })

    pending[0]!.resolve(
      createRuntimeResult(
        {
          agentId: 'agent-1',
          sessionId: 'session-1',
          text: 'First turn',
          runId: 'run-1'
        },
        'paused'
      )
    )
    await first

    const secondPending = await waitForPendingRequest(pending, 1)
    secondPending.resolve(
      createRuntimeResult({
        agentId: 'agent-1',
        sessionId: 'session-1',
        text: 'Second turn',
        runId: 'run-2'
      })
    )
    await second

    expect(runtime.getSnapshot().sessions['session-1']).toMatchObject({
      inflightRequestCount: 0,
      queuedTurnCount: 0,
      turnState: 'idle',
      lastRunId: 'run-2',
      lastTerminalStatus: 'success',
      lastStopReason: null
    })
  })

  it('preserves warm state when a queued turn interrupts the active run', async () => {
    const registry = new RuntimeDriverRegistry()
    const { driver, pending } = createDeferredDriver()
    const prewarmSession = vi.fn(async () => ({
      ok: true as const,
      status: 'warmed' as const
    }))
    registry.register('claude-code', {
      ...driver,
      prewarmSession
    })
    const runtime = new AgentSessionRuntimeService({
      getAgentState: async () => createState(),
      driverRegistry: registry
    })

    await expect(
      runtime.prewarmSession({
        agentId: 'agent-1',
        sessionId: 'session-1'
      })
    ).resolves.toEqual({
      ok: true,
      status: 'warmed'
    })

    const first = runtime.sendMessage({
      agentId: 'agent-1',
      sessionId: 'session-1',
      text: 'First turn',
      runId: 'run-1'
    })

    await waitForPendingRequest(pending, 0)

    const second = runtime.sendMessage({
      agentId: 'agent-1',
      sessionId: 'session-1',
      text: 'Second turn',
      runId: 'run-2'
    })

    await vi.waitFor(() =>
      expect(driver.cancelMessage).toHaveBeenCalledWith('run-1', {
        kind: 'interrupt',
        message: 'Interrupted by a newer queued turn.'
      })
    )
    expect(runtime.getSnapshot().sessions['session-1']).toMatchObject({
      warmState: 'warm',
      lastWarmAt: expect.any(String),
      lastStopReason: {
        kind: 'interrupt'
      }
    })

    pending[0]!.resolve(
      createRuntimeResult(
        {
          agentId: 'agent-1',
          sessionId: 'session-1',
          text: 'First turn',
          runId: 'run-1'
        },
        'paused'
      )
    )
    await first

    const secondPending = await waitForPendingRequest(pending, 1)
    secondPending.resolve(
      createRuntimeResult({
        agentId: 'agent-1',
        sessionId: 'session-1',
        text: 'Second turn',
        runId: 'run-2'
      })
    )
    await second

    expect(runtime.getSnapshot().sessions['session-1']).toMatchObject({
      warmState: 'warm',
      lastStopReason: null
    })
  })

  it('waits for active tools to drain before interrupting the current run', async () => {
    const registry = new RuntimeDriverRegistry()
    const { driver, pending } = createDeferredDriver()
    registry.register('claude-code', driver)
    const runtime = new AgentSessionRuntimeService({
      getAgentState: async () => createState(),
      driverRegistry: registry
    })

    const first = runtime.sendMessage({
      agentId: 'agent-1',
      sessionId: 'session-1',
      text: 'First turn',
      runId: 'run-1'
    })

    await waitForPendingRequest(pending, 0)

    runtime.emitChunk({
      type: 'tool-input-start',
      sessionId: 'session-1',
      toolCallId: 'tool-1',
      toolName: 'Read'
    })

    const second = runtime.sendMessage({
      agentId: 'agent-1',
      sessionId: 'session-1',
      text: 'Second turn',
      runId: 'run-2'
    })

    expect(driver.cancelMessage).not.toHaveBeenCalled()
    expect(runtime.getSnapshot().sessions['session-1']).toMatchObject({
      queuedTurnCount: 1,
      lastStopReason: {
        kind: 'interrupt'
      }
    })

    runtime.emitChunk({
      type: 'tool-output-available',
      sessionId: 'session-1',
      toolCallId: 'tool-1',
      output: {
        ok: true
      }
    })

    await vi.waitFor(() =>
      expect(driver.cancelMessage).toHaveBeenCalledWith('run-1', {
        kind: 'interrupt',
        message: 'Interrupted by a newer queued turn.'
      })
    )

    pending[0]!.resolve(
      createRuntimeResult(
        {
          agentId: 'agent-1',
          sessionId: 'session-1',
          text: 'First turn',
          runId: 'run-1'
        },
        'paused'
      )
    )
    await first

    const secondPending = await waitForPendingRequest(pending, 1)
    secondPending.resolve(
      createRuntimeResult({
        agentId: 'agent-1',
        sessionId: 'session-1',
        text: 'Second turn',
        runId: 'run-2'
      })
    )
    await second
  })

  it('delegates stop calls through the registered driver', async () => {
    const registry = new RuntimeDriverRegistry()
    const { driver, pending } = createDeferredDriver()
    registry.register('claude-code', driver)
    const runtime = new AgentSessionRuntimeService({
      getAgentState: async () => createState(),
      driverRegistry: registry
    })

    const turn = runtime.sendMessage({
      agentId: 'agent-1',
      sessionId: 'session-1',
      text: 'Stop me',
      runId: 'run-1'
    })

    await waitForPendingRequest(pending, 0)
    expect(runtime.cancelSession('session-1')).toBe(true)
    expect(runtime.cancelMessage('run-1')).toBe(true)
    await vi.waitFor(() =>
      expect(driver.cancelSession).toHaveBeenCalledWith('session-1', {
        kind: 'user-stop',
        message: 'Stopped by user request.'
      })
    )
    await vi.waitFor(() =>
      expect(driver.cancelMessage).toHaveBeenCalledWith('run-1', {
        kind: 'user-stop',
        message: 'Stopped by user request.'
      })
    )

    const firstPending = await waitForPendingRequest(pending, 0)
    firstPending.resolve(
      createRuntimeResult(
        {
          agentId: 'agent-1',
          sessionId: 'session-1',
          text: 'Stop me',
          runId: 'run-1'
        },
        'paused'
      )
    )
    await turn

    expect(runtime.getSnapshot().sessions['session-1']).toMatchObject({
      inflightRequestCount: 0,
      lastTerminalStatus: 'paused'
    })
  })

  it('short-circuits session stop requests that land before driver dispatch begins', async () => {
    const registry = new RuntimeDriverRegistry()
    const driver: AgentRuntimeDriver = {
      sendMessage: vi.fn(async (request: AgentChatRuntimeRequest) => createRuntimeResult(request)),
      cancelMessage: vi.fn(() => true),
      cancelSession: vi.fn(() => true)
    }
    registry.register('claude-code', driver)
    const stateDeferred = createDeferredPromise<AgentStoreState>()
    const runtime = new AgentSessionRuntimeService({
      getAgentState: () => stateDeferred.promise,
      driverRegistry: registry
    })

    const turn = runtime.sendMessage({
      agentId: 'agent-1',
      sessionId: 'session-1',
      text: 'Stop before dispatch',
      runId: 'run-1'
    })

    expect(runtime.cancelSession('session-1')).toBe(true)
    stateDeferred.resolve(createState())

    await expect(turn).rejects.toMatchObject({
      name: 'AbortError'
    })
    expect(driver.sendMessage).not.toHaveBeenCalled()
    expect(driver.cancelSession).not.toHaveBeenCalled()
    expect(runtime.getSnapshot().sessions['session-1']).toMatchObject({
      turnState: 'idle',
      lastTerminalStatus: 'paused',
      lastStopReason: {
        kind: 'user-stop'
      }
    })
  })

  it('short-circuits run stop requests that land before driver dispatch begins', async () => {
    const registry = new RuntimeDriverRegistry()
    const driver: AgentRuntimeDriver = {
      sendMessage: vi.fn(async (request: AgentChatRuntimeRequest) => createRuntimeResult(request)),
      cancelMessage: vi.fn(() => true),
      cancelSession: vi.fn(() => true)
    }
    registry.register('claude-code', driver)
    const stateDeferred = createDeferredPromise<AgentStoreState>()
    const runtime = new AgentSessionRuntimeService({
      getAgentState: () => stateDeferred.promise,
      driverRegistry: registry
    })

    const turn = runtime.sendMessage({
      agentId: 'agent-1',
      sessionId: 'session-1',
      text: 'Cancel before dispatch',
      runId: 'run-1'
    })

    expect(runtime.cancelMessage('run-1')).toBe(true)
    stateDeferred.resolve(createState())

    await expect(turn).rejects.toMatchObject({
      name: 'AbortError'
    })
    expect(driver.sendMessage).not.toHaveBeenCalled()
    expect(driver.cancelMessage).not.toHaveBeenCalled()
    expect(runtime.getSnapshot().sessions['session-1']).toMatchObject({
      turnState: 'idle',
      lastTerminalStatus: 'paused',
      lastStopReason: {
        kind: 'user-stop'
      }
    })
  })

  it('notifies listeners when runtime state changes', async () => {
    const registry = new RuntimeDriverRegistry()
    const { driver, pending } = createDeferredDriver()
    registry.register('claude-code', driver)
    const runtime = new AgentSessionRuntimeService({
      getAgentState: async () => createState(),
      driverRegistry: registry
    })
    const listener = vi.fn()
    const unsubscribe = runtime.subscribe(listener)

    const turn = runtime.sendMessage({
      agentId: 'agent-1',
      sessionId: 'session-1',
      text: 'First turn',
      runId: 'run-1'
    })
    const firstPending = await waitForPendingRequest(pending, 0)
    firstPending.resolve(
      createRuntimeResult({
        agentId: 'agent-1',
        sessionId: 'session-1',
        text: 'First turn',
        runId: 'run-1'
      })
    )
    await turn
    unsubscribe()

    await vi.waitFor(() => {
      expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2)
    })
    expect(listener.mock.calls[0]?.[0].sessions['session-1']).toMatchObject({
      inflightRequestCount: 1,
      queuedTurnCount: 0
    })
    expect(listener.mock.calls.at(-1)?.[0].sessions['session-1']).toMatchObject({
      inflightRequestCount: 0,
      lastTerminalStatus: 'success'
    })
  })

  it('settles runtime snapshot as idle error when driver send fails', async () => {
    const registry = new RuntimeDriverRegistry()
    const driver: AgentRuntimeDriver = {
      sendMessage: vi.fn(async () => {
        throw new Error('Claude Code runtime driver requires a workspace path in runtime composition.')
      }),
      cancelMessage: vi.fn(() => false),
      cancelSession: vi.fn(() => false)
    }
    registry.register('claude-code', driver)
    const runtime = new AgentSessionRuntimeService({
      getAgentState: async () => createState(),
      driverRegistry: registry
    })

    await expect(
      runtime.sendMessage({
        agentId: 'agent-1',
        sessionId: 'session-1',
        text: 'Hello',
        runId: 'run-1'
      })
    ).rejects.toThrow('Claude Code runtime driver requires a workspace path in runtime composition.')

    expect(runtime.getSnapshot().sessions['session-1']).toMatchObject({
      turnState: 'idle',
      turnPhase: 'idle',
      inflightRequestCount: 0,
      lastTerminalStatus: 'error',
      lastStopReason: {
        kind: 'runtime-stop',
        message: 'Claude Code runtime driver requires a workspace path in runtime composition.'
      }
    })
  })

  it('rejects a turn whose driver never settles, cancels it, and leaves no in-flight state', async () => {
    const registry = new RuntimeDriverRegistry()
    const driver: AgentRuntimeDriver = {
      sendMessage: vi.fn(() => new Promise<AgentChatRuntimeResult>(() => undefined)),
      cancelMessage: vi.fn(() => true),
      cancelSession: vi.fn(() => true)
    }
    registry.register('claude-code', driver)
    const runtime = new AgentSessionRuntimeService({
      getAgentState: async () => createState(),
      driverRegistry: registry,
      turnTimeoutMs: 25
    })

    const turn = runtime.sendMessage({
      agentId: 'agent-1',
      sessionId: 'session-1',
      text: 'Hang while connecting',
      runId: 'run-1'
    })

    await expect(turn).rejects.toThrow(
      'Agent turn timed out after 25ms waiting for the runtime driver.'
    )

    const timeoutStopReason = {
      kind: 'runtime-stop',
      message: 'Agent turn timed out after 25ms waiting for the runtime driver.'
    }
    expect(driver.cancelMessage).toHaveBeenCalledWith('run-1', timeoutStopReason)
    expect(driver.cancelSession).not.toHaveBeenCalled()
    expect(runtime.isSessionBusy('session-1')).toBe(false)
    expect(runtime.getSnapshot().sessions['session-1']).toMatchObject({
      turnState: 'idle',
      turnPhase: 'idle',
      inflightRequestCount: 0,
      queuedTurnCount: 0,
      lastTerminalStatus: 'error',
      lastStopReason: timeoutStopReason
    })
  })

  it('cancels the session when a timed-out turn has no run id', async () => {
    const registry = new RuntimeDriverRegistry()
    const driver: AgentRuntimeDriver = {
      sendMessage: vi.fn(() => new Promise<AgentChatRuntimeResult>(() => undefined)),
      cancelMessage: vi.fn(() => true),
      cancelSession: vi.fn(() => true)
    }
    registry.register('claude-code', driver)
    const runtime = new AgentSessionRuntimeService({
      getAgentState: async () => createState(),
      driverRegistry: registry,
      turnTimeoutMs: 25
    })

    const turn = runtime.sendMessage({
      agentId: 'agent-1',
      sessionId: 'session-1',
      text: 'Hang without a run id'
    })

    await expect(turn).rejects.toThrow('Agent turn timed out after 25ms')

    expect(driver.cancelSession).toHaveBeenCalledWith('session-1', {
      kind: 'runtime-stop',
      message: 'Agent turn timed out after 25ms waiting for the runtime driver.'
    })
    expect(driver.cancelMessage).not.toHaveBeenCalled()
    expect(runtime.isSessionBusy('session-1')).toBe(false)
  })

  it('does not cancel a turn that completes before the timeout', async () => {
    const registry = new RuntimeDriverRegistry()
    const { driver, pending } = createDeferredDriver()
    registry.register('claude-code', driver)
    const runtime = new AgentSessionRuntimeService({
      getAgentState: async () => createState(),
      driverRegistry: registry,
      turnTimeoutMs: 500
    })

    const request: AgentChatRuntimeRequest = {
      agentId: 'agent-1',
      sessionId: 'session-1',
      text: 'Finish quickly',
      runId: 'run-1'
    }
    const turn = runtime.sendMessage(request)
    const dispatched = await waitForPendingRequest(pending, 0)
    dispatched.resolve(createRuntimeResult(request))
    await expect(turn).resolves.toMatchObject({
      assistantMessage: { status: 'success' }
    })

    expect(driver.cancelMessage).not.toHaveBeenCalled()
    expect(driver.cancelSession).not.toHaveBeenCalled()
    expect(runtime.isSessionBusy('session-1')).toBe(false)
    expect(runtime.getSnapshot().sessions['session-1']).toMatchObject({
      turnState: 'idle',
      inflightRequestCount: 0,
      lastTerminalStatus: 'success'
    })
  })

  it('tracks tool approval requests inside the runtime snapshot and clears them when resolved', async () => {
    const registry = new RuntimeDriverRegistry()
    registry.register('claude-code', createDeferredDriver().driver)
    const approvalRegistry = new ToolApprovalRegistry()
    const runtime = new AgentSessionRuntimeService({
      getAgentState: async () => createState(),
      driverRegistry: registry,
      toolApprovalRegistry: approvalRegistry
    })

    const approvalResult = runtime.requestToolApproval({
      sessionId: 'session-1',
      toolCallId: 'tool-call-1',
      toolName: 'Bash'
    })

    const pendingApproval = runtime.listToolApprovals()[0]
    expect(pendingApproval).toMatchObject({
      sessionId: 'session-1',
      toolCallId: 'tool-call-1',
      toolName: 'Bash'
    })
    expect(runtime.getSnapshot().toolApprovals).toEqual([pendingApproval])
    expect(runtime.getSnapshot().chunksBySessionId['session-1']).toEqual([
      {
        type: 'tool-approval-request',
        approvalId: pendingApproval!.approvalId,
        sessionId: 'session-1',
        toolCallId: 'tool-call-1',
        providerMetadata: {
          claudeAgent: {
            transport: 'claude-agent',
            toolName: 'Bash'
          }
        }
      }
    ])

    const nextSnapshot = runtime.resolveToolApproval(pendingApproval!.approvalId, {
      behavior: 'allow',
      updatedInput: {
        command: 'pwd'
      }
    })

    await expect(approvalResult).resolves.toEqual({
      behavior: 'allow',
      updatedInput: {
        command: 'pwd'
      }
    })
    expect(nextSnapshot.toolApprovals).toEqual([])
    expect(nextSnapshot.toolApprovalHistory).toEqual([
      {
        approvalId: pendingApproval!.approvalId,
        sessionId: 'session-1',
        toolCallId: 'tool-call-1',
        toolName: 'Bash',
        decision: 'allow',
        updatedInput: {
          command: 'pwd'
        },
        resolvedAt: expect.any(String),
        resolutionSource: 'user'
      }
    ])
    expect(nextSnapshot.chunksBySessionId['session-1']).toEqual([
      {
        type: 'tool-approval-resolved',
        approvalId: pendingApproval!.approvalId,
        sessionId: 'session-1',
        toolCallId: 'tool-call-1',
        toolName: 'Bash',
        decision: 'allow',
        updatedInput: {
          command: 'pwd'
        }
      }
    ])
    expect(runtime.getSnapshot().toolApprovals).toEqual([])
    expect(runtime.getSnapshot().chunksBySessionId['session-1']).toEqual([
      {
        type: 'tool-approval-resolved',
        approvalId: pendingApproval!.approvalId,
        sessionId: 'session-1',
        toolCallId: 'tool-call-1',
        toolName: 'Bash',
        decision: 'allow',
        updatedInput: {
          command: 'pwd'
        }
      }
    ])
  })

  it('denies pending tool approvals when the session is cancelled', async () => {
    const registry = new RuntimeDriverRegistry()
    registry.register('claude-code', createDeferredDriver().driver)
    const approvalRegistry = new ToolApprovalRegistry()
    const runtime = new AgentSessionRuntimeService({
      getAgentState: async () => createState(),
      driverRegistry: registry,
      toolApprovalRegistry: approvalRegistry
    })

    const approvalResult = runtime.requestToolApproval({
      sessionId: 'session-1',
      toolCallId: 'tool-call-1',
      toolName: 'Read'
    })
    const pendingApproval = runtime.listToolApprovals()[0]!

    expect(runtime.cancelSession('session-1')).toBe(true)

    await expect(approvalResult).resolves.toEqual({
      behavior: 'deny',
      message: 'Tool approval was denied because the session was stopped.'
    })
    expect(runtime.getSnapshot().toolApprovals).toEqual([])
    expect(runtime.getSnapshot().toolApprovalHistory).toEqual([
      {
        approvalId: pendingApproval.approvalId,
        sessionId: 'session-1',
        toolCallId: 'tool-call-1',
        toolName: 'Read',
        decision: 'deny',
        message: 'Tool approval was denied because the session was stopped.',
        resolvedAt: expect.any(String),
        resolutionSource: 'session-stop'
      }
    ])
    expect(runtime.getSnapshot().chunksBySessionId['session-1']).toEqual([
      {
        type: 'tool-approval-resolved',
        approvalId: pendingApproval.approvalId,
        sessionId: 'session-1',
        toolCallId: 'tool-call-1',
        toolName: 'Read',
        decision: 'deny',
        message: 'Tool approval was denied because the session was stopped.'
      }
    ])
  })

  it('denies all pending tool approvals and clears approval chunks when disposed', async () => {
    const registry = new RuntimeDriverRegistry()
    registry.register('claude-code', createDeferredDriver().driver)
    const approvalRegistry = new ToolApprovalRegistry()
    const runtime = new AgentSessionRuntimeService({
      getAgentState: async () => createState(),
      driverRegistry: registry,
      toolApprovalRegistry: approvalRegistry
    })

    const firstApproval = runtime.requestToolApproval({
      sessionId: 'session-1',
      toolCallId: 'tool-call-1',
      toolName: 'Read'
    })
    const secondApproval = runtime.requestToolApproval({
      sessionId: 'session-2',
      toolCallId: 'tool-call-2',
      toolName: 'Write'
    })

    expect(runtime.getSnapshot().toolApprovals).toHaveLength(2)
    expect(Object.keys(runtime.getSnapshot().chunksBySessionId).sort()).toEqual(['session-1', 'session-2'])

    await runtime.dispose()

    await expect(firstApproval).resolves.toEqual({
      behavior: 'deny',
      message: 'Tool approval was denied because the runtime was disposed.'
    })
    await expect(secondApproval).resolves.toEqual({
      behavior: 'deny',
      message: 'Tool approval was denied because the runtime was disposed.'
    })
    const disposedSnapshot = runtime.getSnapshot()
    expect(disposedSnapshot.toolApprovals).toEqual([])
    const session1Chunk = disposedSnapshot.chunksBySessionId['session-1']![0]
    const session2Chunk = disposedSnapshot.chunksBySessionId['session-2']![0]
    expect(session1Chunk?.type).toBe('tool-approval-resolved')
    expect(session2Chunk?.type).toBe('tool-approval-resolved')
    if (session1Chunk?.type !== 'tool-approval-resolved' || session2Chunk?.type !== 'tool-approval-resolved') {
      throw new Error('Expected tool approval resolved chunks')
    }
    expect(disposedSnapshot.toolApprovalHistory).toEqual([
      {
        approvalId: session1Chunk.approvalId,
        sessionId: 'session-1',
        toolCallId: 'tool-call-1',
        toolName: 'Read',
        decision: 'deny',
        message: 'Tool approval was denied because the runtime was disposed.',
        resolvedAt: expect.any(String),
        resolutionSource: 'runtime-dispose'
      },
      {
        approvalId: session2Chunk.approvalId,
        sessionId: 'session-2',
        toolCallId: 'tool-call-2',
        toolName: 'Write',
        decision: 'deny',
        message: 'Tool approval was denied because the runtime was disposed.',
        resolvedAt: expect.any(String),
        resolutionSource: 'runtime-dispose'
      }
    ])
    expect(disposedSnapshot.chunksBySessionId).toEqual({
      'session-1': [
        {
          type: 'tool-approval-resolved',
          approvalId: session1Chunk.approvalId,
          sessionId: 'session-1',
          toolCallId: 'tool-call-1',
          toolName: 'Read',
          decision: 'deny',
          message: 'Tool approval was denied because the runtime was disposed.'
        }
      ],
      'session-2': [
        {
          type: 'tool-approval-resolved',
          approvalId: session2Chunk.approvalId,
          sessionId: 'session-2',
          toolCallId: 'tool-call-2',
          toolName: 'Write',
          decision: 'deny',
          message: 'Tool approval was denied because the runtime was disposed.'
        }
      ]
    })
  })

  it('cancels in-flight session turns when the runtime is disposed', async () => {
    const registry = new RuntimeDriverRegistry()
    const { driver, pending } = createDeferredDriver()
    registry.register('claude-code', driver)
    const runtime = new AgentSessionRuntimeService({
      getAgentState: async () => createState(),
      driverRegistry: registry
    })

    const turn = runtime.sendMessage({
      agentId: 'agent-1',
      sessionId: 'session-1',
      text: 'Dispose me',
      runId: 'run-1'
    })

    await waitForPendingRequest(pending, 0)
    await runtime.dispose()

    expect(driver.cancelSession).toHaveBeenCalledWith('session-1', {
      kind: 'runtime-stop',
      message: 'Agent session runtime is disposed.'
    })

    pending[0]!.resolve(
      createRuntimeResult(
        {
          agentId: 'agent-1',
          sessionId: 'session-1',
          text: 'Dispose me',
          runId: 'run-1'
        },
        'paused'
      )
    )
    await turn

    expect(runtime.getSnapshot().sessions['session-1']).toMatchObject({
      inflightRequestCount: 0,
      lastTerminalStatus: 'paused'
    })
  })

  it('rejects queued turns and blocks new turns after the runtime is disposed', async () => {
    const registry = new RuntimeDriverRegistry()
    const { driver, pending } = createDeferredDriver()
    registry.register('claude-code', driver)
    const runtime = new AgentSessionRuntimeService({
      getAgentState: async () => createState(),
      driverRegistry: registry
    })

    const first = runtime.sendMessage({
      agentId: 'agent-1',
      sessionId: 'session-1',
      text: 'First turn',
      runId: 'run-1'
    })
    await waitForPendingRequest(pending, 0)
    const second = runtime.sendMessage({
      agentId: 'agent-1',
      sessionId: 'session-1',
      text: 'Second turn',
      runId: 'run-2'
    })
    await runtime.dispose()

    pending[0]!.resolve(
      createRuntimeResult(
        {
          agentId: 'agent-1',
          sessionId: 'session-1',
          text: 'First turn',
          runId: 'run-1'
        },
        'paused'
      )
    )
    await first

    await expect(second).rejects.toThrow('Agent session runtime is disposed.')
    await expect(
      runtime.sendMessage({
        agentId: 'agent-1',
        sessionId: 'session-1',
        text: 'Third turn',
        runId: 'run-3'
      })
    ).rejects.toThrow('Agent session runtime is disposed.')
    expect(driver.sendMessage).toHaveBeenCalledTimes(1)
  })

  it('flushes the trace recorder during runtime dispose', async () => {
    const registry = new RuntimeDriverRegistry()
    registry.register('claude-code', createDeferredDriver().driver)
    const flushDeferred = createDeferredPromise<void>()
    const flush = vi.fn(() => flushDeferred.promise)
    const runtime = new AgentSessionRuntimeService({
      getAgentState: async () => createState(),
      driverRegistry: registry,
      traceRecorder: {
        startSpan: vi.fn(() => null),
        flush
      }
    })

    const disposePromise = runtime.dispose()

    expect(flush).toHaveBeenCalledOnce()
    let disposed = false
    disposePromise.then(() => {
      disposed = true
    })
    await Promise.resolve()
    expect(disposed).toBe(false)

    flushDeferred.resolve()
    await disposePromise

    expect(disposed).toBe(true)
  })

  it('keeps runtime dispose best-effort when trace flush fails', async () => {
    const registry = new RuntimeDriverRegistry()
    registry.register('claude-code', createDeferredDriver().driver)
    const flush = vi.fn(async () => {
      throw new Error('trace sink unavailable')
    })
    const runtime = new AgentSessionRuntimeService({
      getAgentState: async () => createState(),
      driverRegistry: registry,
      traceRecorder: {
        startSpan: vi.fn(() => null),
        flush
      }
    })

    await expect(runtime.dispose()).resolves.toBeUndefined()
    expect(flush).toHaveBeenCalledOnce()
  })

  it('stores externally emitted runtime approval chunks without duplicating them on approval registration', async () => {
    const registry = new RuntimeDriverRegistry()
    registry.register('claude-code', createDeferredDriver().driver)
    const approvalRegistry = new ToolApprovalRegistry()
    const runtime = new AgentSessionRuntimeService({
      getAgentState: async () => createState(),
      driverRegistry: registry,
      toolApprovalRegistry: approvalRegistry
    })

    runtime.emitChunk({
      type: 'tool-approval-request',
      approvalId: 'approval-1',
      sessionId: 'session-1',
      toolCallId: 'tool-call-2',
      providerMetadata: {
        claudeAgent: {
          transport: 'claude-agent',
          toolName: 'Write'
        }
      }
    })

    const approvalResult = runtime.requestToolApproval({
      approvalId: 'approval-1',
      sessionId: 'session-1',
      toolCallId: 'tool-call-2',
      toolName: 'Write'
    })

    expect(runtime.getSnapshot().toolApprovals).toEqual([
      {
        approvalId: 'approval-1',
        sessionId: 'session-1',
        toolCallId: 'tool-call-2',
        toolName: 'Write'
      }
    ])
    expect(runtime.getSnapshot().chunksBySessionId['session-1']).toEqual([
      {
        type: 'tool-approval-request',
        approvalId: 'approval-1',
        sessionId: 'session-1',
        toolCallId: 'tool-call-2',
        providerMetadata: {
          claudeAgent: {
            transport: 'claude-agent',
            toolName: 'Write'
          }
        }
      }
    ])

    runtime.resolveToolApproval('approval-1', {
      behavior: 'deny',
      message: 'Nope'
    })

    await expect(approvalResult).resolves.toEqual({
      behavior: 'deny',
      message: 'Nope'
    })
    expect(runtime.getSnapshot().chunksBySessionId['session-1']).toEqual([
      {
        type: 'tool-approval-resolved',
        approvalId: 'approval-1',
        sessionId: 'session-1',
        toolCallId: 'tool-call-2',
        toolName: 'Write',
        decision: 'deny',
        message: 'Nope'
      }
    ])
  })

  it('replaces assistant text update chunks for the same run and clears runtime chunks after the turn finishes', async () => {
    const registry = new RuntimeDriverRegistry()
    const { driver, pending } = createDeferredDriver()
    registry.register('claude-code', driver)
    const runtime = new AgentSessionRuntimeService({
      getAgentState: async () => createState(),
      driverRegistry: registry
    })

    const turn = runtime.sendMessage({
      agentId: 'agent-1',
      sessionId: 'session-1',
      text: 'Stream text',
      runId: 'run-1'
    })

    await waitForPendingRequest(pending, 0)

    runtime.emitChunk({
      type: 'assistant-text-update',
      sessionId: 'session-1',
      runId: 'run-1',
      text: 'partial',
      textDelta: 'partial',
      mode: 'append'
    })
    runtime.emitChunk({
      type: 'assistant-text-update',
      sessionId: 'session-1',
      runId: 'run-1',
      text: 'partial updated',
      textDelta: ' updated',
      mode: 'append'
    })
    runtime.emitChunk({
      type: 'tool-output-available',
      sessionId: 'session-1',
      toolCallId: 'tool-1',
      output: { ok: true }
    })

    expect(runtime.getSnapshot().chunksBySessionId['session-1']).toEqual([
      {
        type: 'assistant-text-update',
        sessionId: 'session-1',
        runId: 'run-1',
        text: 'partial updated',
        textDelta: ' updated',
        mode: 'append'
      },
      {
        type: 'tool-output-available',
        sessionId: 'session-1',
        toolCallId: 'tool-1',
        output: { ok: true }
      }
    ])

    pending[0]!.resolve(
      createRuntimeResult({
        agentId: 'agent-1',
        sessionId: 'session-1',
        text: 'Stream text',
        runId: 'run-1'
      })
    )
    await turn

    expect(runtime.getSnapshot().chunksBySessionId['session-1']).toBeUndefined()
  })

  it('bounds retained runtime chunks during long reasoning streams', () => {
    const runtime = new AgentSessionRuntimeService({
      getAgentState: async () => createState(),
      driverRegistry: new RuntimeDriverRegistry()
    })
    const total = MAX_RUNTIME_CHUNKS_PER_SESSION + 25

    for (let index = 0; index < total; index += 1) {
      runtime.emitChunk({
        type: 'reasoning-delta',
        sessionId: 'session-1',
        runId: 'run-1',
        partId: 'reasoning-1',
        delta: `delta-${index}`
      })
    }

    const chunks = runtime.getSnapshot().chunksBySessionId['session-1'] ?? []
    expect(chunks).toHaveLength(MAX_RUNTIME_CHUNKS_PER_SESSION)
    expect(chunks.at(-1)).toMatchObject({ delta: `delta-${total - 1}` })
  })

  it('builds runtime composition before dispatching a turn when a composition service is configured', async () => {
    const registry = new RuntimeDriverRegistry()
    const { driver, pending } = createDeferredDriver()
    registry.register('claude-code', driver)
    const compose = vi.fn(async () => ({}) as AgentRuntimeComposition)
    const runtime = new AgentSessionRuntimeService({
      getAgentState: async () => createState(),
      driverRegistry: registry,
      compositionService: {
        compose
      }
    })

    const turn = runtime.sendMessage({
      agentId: 'agent-1',
      sessionId: 'session-1',
      text: 'Compose runtime',
      runId: 'run-1'
    })

    const firstPending = await waitForPendingRequest(pending, 0)
    firstPending.resolve(
      createRuntimeResult({
        agentId: 'agent-1',
        sessionId: 'session-1',
        text: 'Compose runtime',
        runId: 'run-1'
      })
    )
    await turn

    expect(compose).toHaveBeenCalledWith({
      state: expect.objectContaining({
        agents: expect.arrayContaining([expect.objectContaining({ id: 'agent-1' })]),
        sessions: expect.arrayContaining([expect.objectContaining({ id: 'session-1' })])
      }),
      agentId: 'agent-1',
      sessionId: 'session-1'
    })
  })

  it('passes runtime composition to the driver context when available', async () => {
    const registry = new RuntimeDriverRegistry()
    const { driver, pending } = createDeferredDriver()
    registry.register('claude-code', driver)
    const composition = {
      agentId: 'agent-1',
      sessionId: 'session-1',
      agentType: 'claude-code',
      instructions: null,
      modelId: 'provider-1:chat-model',
      modelName: null,
      permissionMode: 'default',
      workspacePath: '/tmp/workspace',
      workspaceType: 'user',
      environment: {},
      tools: { all: [], enabled: [], disabled: [] },
      mcp: { sources: [], servers: [] },
      skills: { agentId: 'agent-1', skills: [], toolIds: [] }
    } satisfies AgentRuntimeComposition
    const runtime = new AgentSessionRuntimeService({
      getAgentState: async () => createState(),
      driverRegistry: registry,
      compositionService: {
        compose: async () => composition
      }
    })

    const turn = runtime.sendMessage({
      agentId: 'agent-1',
      sessionId: 'session-1',
      text: 'Use composition',
      runId: 'run-1'
    })

    const firstPending = await waitForPendingRequest(pending, 0)
    firstPending.resolve(
      createRuntimeResult({
        agentId: 'agent-1',
        sessionId: 'session-1',
        text: 'Use composition',
        runId: 'run-1'
      })
    )
    await turn

    expect(driver.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-1' }),
      {
        composition,
        traceId: null,
        lastResumeToken: null
      }
    )
  })

  it('passes the session trace id through runtime snapshots and driver context', async () => {
    const registry = new RuntimeDriverRegistry()
    const { driver, pending } = createDeferredDriver()
    registry.register('claude-code', driver)
    const composition = {
      agentId: 'agent-1',
      sessionId: 'session-1',
      agentType: 'claude-code',
      instructions: null,
      modelId: 'provider-1:chat-model',
      modelName: null,
      permissionMode: 'default',
      workspacePath: '/tmp/workspace',
      workspaceType: 'user',
      environment: {},
      tools: { all: [], enabled: [], disabled: [] },
      mcp: { sources: [], servers: [] },
      skills: { agentId: 'agent-1', skills: [], toolIds: [] }
    } satisfies AgentRuntimeComposition
    const runtime = new AgentSessionRuntimeService({
      getAgentState: async () =>
        createState({
          sessions: [
            {
              ...session,
              traceId: 'trace-session-1'
            }
          ]
        }),
      driverRegistry: registry,
      compositionService: {
        compose: async () => composition
      }
    })

    const turn = runtime.sendMessage({
      agentId: 'agent-1',
      sessionId: 'session-1',
      text: 'Trace me',
      runId: 'run-1'
    })

    const firstPending = await waitForPendingRequest(pending, 0)
    expect(driver.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-1' }),
      {
        composition,
        traceId: 'trace-session-1',
        lastResumeToken: null
      }
    )
    expect(runtime.getSnapshot().sessions['session-1']).toMatchObject({
      traceId: 'trace-session-1'
    })

    firstPending.resolve(
      createRuntimeResult({
        agentId: 'agent-1',
        sessionId: 'session-1',
        text: 'Trace me',
        runId: 'run-1'
      })
    )
    await turn
  })

  it('records a traced send-message span through success completion', async () => {
    const registry = new RuntimeDriverRegistry()
    const { driver, pending } = createDeferredDriver()
    registry.register('claude-code', driver)
    const { recorder, spans } = createTraceRecorder()
    const runtime = new AgentSessionRuntimeService({
      getAgentState: async () =>
        createState({
          sessions: [
            {
              ...session,
              traceId: 'trace-turn-1'
            }
          ]
        }),
      driverRegistry: registry,
      traceRecorder: recorder,
      now: () => '2026-01-01T00:00:00.000Z'
    })

    const turn = runtime.sendMessage({
      agentId: 'agent-1',
      sessionId: 'session-1',
      text: 'Trace span',
      runId: 'run-1'
    })

    const firstPending = await waitForPendingRequest(pending, 0)
    expect(spans).toEqual([
      {
        start: {
          operation: 'send-message',
          traceId: 'trace-turn-1',
          agentId: 'agent-1',
          agentType: 'claude-code',
          sessionId: 'session-1',
          runId: 'run-1',
          parentResumeToken: null,
          startedAt: '2026-01-01T00:00:00.000Z'
        },
        ends: []
      }
    ])

    firstPending.resolve(
      createRuntimeResult({
        agentId: 'agent-1',
        sessionId: 'session-1',
        text: 'Trace span',
        runId: 'run-1'
      })
    )
    await turn

    expect(spans[0]?.ends).toEqual([
      {
        status: 'success',
        endedAt: '2026-01-01T00:00:00.000Z',
        stopReason: null,
        resumeToken: 'resume:run-1'
      }
    ])
  })

  it('records a traced send-message span as paused when pre-dispatch stop wins', async () => {
    const registry = new RuntimeDriverRegistry()
    const driver: AgentRuntimeDriver = {
      sendMessage: vi.fn(async (request: AgentChatRuntimeRequest) => createRuntimeResult(request)),
      cancelMessage: vi.fn(() => true),
      cancelSession: vi.fn(() => true)
    }
    registry.register('claude-code', driver)
    const stateDeferred = createDeferredPromise<AgentStoreState>()
    const { recorder, spans } = createTraceRecorder()
    const runtime = new AgentSessionRuntimeService({
      getAgentState: () => stateDeferred.promise,
      driverRegistry: registry,
      traceRecorder: recorder,
      now: () => '2026-01-01T00:00:00.000Z'
    })

    const turn = runtime.sendMessage({
      agentId: 'agent-1',
      sessionId: 'session-1',
      text: 'Stop before dispatch',
      runId: 'run-1'
    })

    expect(runtime.cancelSession('session-1')).toBe(true)
    stateDeferred.resolve(
      createState({
        sessions: [
          {
            ...session,
            traceId: 'trace-paused-1'
          }
        ]
      })
    )

    await expect(turn).rejects.toMatchObject({
      name: 'AbortError'
    })
    expect(driver.sendMessage).not.toHaveBeenCalled()
    expect(spans).toEqual([
      {
        start: {
          operation: 'send-message',
          traceId: 'trace-paused-1',
          agentId: 'agent-1',
          agentType: 'claude-code',
          sessionId: 'session-1',
          runId: 'run-1',
          parentResumeToken: null,
          startedAt: '2026-01-01T00:00:00.000Z'
        },
        ends: [
          {
            status: 'paused',
            endedAt: '2026-01-01T00:00:00.000Z',
            stopReason: {
              kind: 'user-stop',
              message: 'Stopped by user request.'
            },
            resumeToken: null
          }
        ]
      }
    ])
  })

  it('passes the previous runtime resume token into the next driver context', async () => {
    const registry = new RuntimeDriverRegistry()
    const { driver, pending } = createDeferredDriver()
    registry.register('claude-code', driver)
    const composition = {
      agentId: 'agent-1',
      sessionId: 'session-1',
      agentType: 'claude-code',
      instructions: null,
      modelId: 'provider-1:chat-model',
      modelName: null,
      permissionMode: 'default',
      workspacePath: '/tmp/workspace',
      workspaceType: 'user',
      environment: {},
      tools: { all: [], enabled: [], disabled: [] },
      mcp: { sources: [], servers: [] },
      skills: { agentId: 'agent-1', skills: [], toolIds: [] }
    } satisfies AgentRuntimeComposition
    const runtime = new AgentSessionRuntimeService({
      getAgentState: async () => createState(),
      driverRegistry: registry,
      compositionService: {
        compose: async () => composition
      }
    })

    const firstTurn = runtime.sendMessage({
      agentId: 'agent-1',
      sessionId: 'session-1',
      text: 'First turn',
      runId: 'run-1'
    })

    const firstPending = await waitForPendingRequest(pending, 0)
    firstPending.resolve(
      createRuntimeResult({
        agentId: 'agent-1',
        sessionId: 'session-1',
        text: 'First turn',
        runId: 'run-1'
      })
    )
    await firstTurn

    const secondTurn = runtime.sendMessage({
      agentId: 'agent-1',
      sessionId: 'session-1',
      text: 'Second turn',
      runId: 'run-2'
    })

    const secondPending = await waitForPendingRequest(pending, 1)
    expect(driver.sendMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ runId: 'run-2' }),
      {
        composition,
        traceId: null,
        lastResumeToken: 'resume:run-1'
      }
    )

    secondPending.resolve(
      createRuntimeResult({
        agentId: 'agent-1',
        sessionId: 'session-1',
        text: 'Second turn',
        runId: 'run-2'
      })
    )
    await secondTurn
  })

  it('prewarms a session through the registered driver with composition and the latest resume token', async () => {
    const registry = new RuntimeDriverRegistry()
    const { driver, pending } = createDeferredDriver()
    const prewarmSession = vi.fn(async () => ({
      ok: true as const,
      status: 'warmed' as const
    }))
    registry.register('claude-code', {
      ...driver,
      prewarmSession
    })
    const composition = {
      agentId: 'agent-1',
      sessionId: 'session-1',
      agentType: 'claude-code',
      instructions: null,
      modelId: 'provider-1:chat-model',
      modelName: null,
      permissionMode: 'default',
      workspacePath: '/tmp/workspace',
      workspaceType: 'user',
      environment: {},
      tools: { all: [], enabled: [], disabled: [] },
      mcp: { sources: [], servers: [] },
      skills: { agentId: 'agent-1', skills: [], toolIds: [] }
    } satisfies AgentRuntimeComposition
    const runtime = new AgentSessionRuntimeService({
      getAgentState: async () => createState(),
      driverRegistry: registry,
      compositionService: {
        compose: async () => composition
      }
    })

    const turn = runtime.sendMessage({
      agentId: 'agent-1',
      sessionId: 'session-1',
      text: 'Seed resume',
      runId: 'run-1'
    })
    const firstPending = await waitForPendingRequest(pending, 0)
    firstPending.resolve(
      createRuntimeResult({
        agentId: 'agent-1',
        sessionId: 'session-1',
        text: 'Seed resume',
        runId: 'run-1'
      })
    )
    await turn

    await expect(
      runtime.prewarmSession({
        agentId: 'agent-1',
        sessionId: 'session-1'
      })
    ).resolves.toEqual({
      ok: true,
      status: 'warmed'
    })

    expect(prewarmSession).toHaveBeenCalledWith(
      {
        agentId: 'agent-1',
        sessionId: 'session-1'
      },
      {
        composition,
        traceId: null,
        lastResumeToken: 'resume:run-1'
      }
    )
    expect(driver.sendMessage).toHaveBeenCalledTimes(1)
  })

  it('hydrates persisted runtime resume tokens and terminal state before a cold prewarm', async () => {
    const registry = new RuntimeDriverRegistry()
    const { driver } = createDeferredDriver()
    const prewarmSession = vi.fn(async () => ({
      ok: true as const,
      status: 'warmed' as const
    }))
    registry.register('claude-code', {
      ...driver,
      prewarmSession
    })
    const composition = {
      agentId: 'agent-1',
      sessionId: 'session-1',
      agentType: 'claude-code',
      instructions: null,
      modelId: 'provider-1:chat-model',
      modelName: null,
      permissionMode: 'default',
      workspacePath: '/tmp/workspace',
      workspaceType: 'user',
      environment: {},
      tools: { all: [], enabled: [], disabled: [] },
      mcp: { sources: [], servers: [] },
      skills: { agentId: 'agent-1', skills: [], toolIds: [] }
    } satisfies AgentRuntimeComposition
    const runtime = new AgentSessionRuntimeService({
      getAgentState: async () =>
        createState({
          messagesBySessionId: {
            'session-1': [
              {
                id: 'assistant-persisted',
                sessionId: 'session-1',
                role: 'assistant',
                data: { parts: [{ type: 'text', text: 'Persisted reply' }] },
                searchableText: 'Persisted reply',
                status: 'success',
                modelId: agent.model,
                modelSnapshot: {
                  id: 'chat-model',
                  name: 'Chat Model',
                  provider: 'provider-1'
                },
                stats: null,
                runtimeResumeToken: 'resume:persisted',
                createdAt,
                updatedAt: createdAt
              }
            ]
          }
        }),
      driverRegistry: registry,
      compositionService: {
        compose: async () => composition
      }
    })

    await expect(
      runtime.prewarmSession({
        agentId: 'agent-1',
        sessionId: 'session-1'
      })
    ).resolves.toEqual({
      ok: true,
      status: 'warmed'
    })

    expect(prewarmSession).toHaveBeenCalledWith(
      {
        agentId: 'agent-1',
        sessionId: 'session-1'
      },
      {
        composition,
        traceId: null,
        lastResumeToken: 'resume:persisted'
      }
    )
    expect(runtime.getSnapshot().sessions['session-1']).toMatchObject({
      lastResumeToken: 'resume:persisted',
      lastResumeTokenSource: 'persisted',
      lastTerminalStatus: 'success',
      warmState: 'warm'
    })
  })

  it('passes the session trace id into prewarm driver context', async () => {
    const registry = new RuntimeDriverRegistry()
    const { driver } = createDeferredDriver()
    const prewarmSession = vi.fn(async () => ({
      ok: true as const,
      status: 'warmed' as const
    }))
    registry.register('claude-code', {
      ...driver,
      prewarmSession
    })
    const composition = {
      agentId: 'agent-1',
      sessionId: 'session-1',
      agentType: 'claude-code',
      instructions: null,
      modelId: 'provider-1:chat-model',
      modelName: null,
      permissionMode: 'default',
      workspacePath: '/tmp/workspace',
      workspaceType: 'user',
      environment: {},
      tools: { all: [], enabled: [], disabled: [] },
      mcp: { sources: [], servers: [] },
      skills: { agentId: 'agent-1', skills: [], toolIds: [] }
    } satisfies AgentRuntimeComposition
    const runtime = new AgentSessionRuntimeService({
      getAgentState: async () =>
        createState({
          sessions: [
            {
              ...session,
              traceId: 'trace-prewarm-1'
            }
          ]
        }),
      driverRegistry: registry,
      compositionService: {
        compose: async () => composition
      }
    })

    await expect(
      runtime.prewarmSession({
        agentId: 'agent-1',
        sessionId: 'session-1'
      })
    ).resolves.toEqual({
      ok: true,
      status: 'warmed'
    })

    expect(prewarmSession).toHaveBeenCalledWith(
      {
        agentId: 'agent-1',
        sessionId: 'session-1'
      },
      {
        composition,
        traceId: 'trace-prewarm-1',
        lastResumeToken: null
      }
    )
    expect(runtime.getSnapshot().sessions['session-1']).toMatchObject({
      traceId: 'trace-prewarm-1',
      warmState: 'warm'
    })
  })

  it('records a traced prewarm-session span through success completion', async () => {
    const registry = new RuntimeDriverRegistry()
    const { driver } = createDeferredDriver()
    const prewarmSession = vi.fn(async () => ({
      ok: true as const,
      status: 'warmed' as const
    }))
    registry.register('claude-code', {
      ...driver,
      prewarmSession
    })
    const { recorder, spans } = createTraceRecorder()
    const runtime = new AgentSessionRuntimeService({
      getAgentState: async () =>
        createState({
          sessions: [
            {
              ...session,
              traceId: 'trace-prewarm-span-1'
            }
          ]
        }),
      driverRegistry: registry,
      traceRecorder: recorder,
      now: () => '2026-01-01T00:00:00.000Z'
    })

    await expect(
      runtime.prewarmSession({
        agentId: 'agent-1',
        sessionId: 'session-1'
      })
    ).resolves.toEqual({
      ok: true,
      status: 'warmed'
    })

    expect(spans).toEqual([
      {
        start: {
          operation: 'prewarm-session',
          traceId: 'trace-prewarm-span-1',
          agentId: 'agent-1',
          agentType: 'claude-code',
          sessionId: 'session-1',
          runId: null,
          parentResumeToken: null,
          startedAt: '2026-01-01T00:00:00.000Z'
        },
        ends: [
          {
            status: 'success',
            endedAt: '2026-01-01T00:00:00.000Z',
            stopReason: null,
            resumeToken: null
          }
        ]
      }
    ])
  })

  it('reuses the latest persisted resume token even when the newest assistant message has no token', async () => {
    const registry = new RuntimeDriverRegistry()
    const { driver } = createDeferredDriver()
    const prewarmSession = vi.fn(async () => ({
      ok: true as const,
      status: 'warmed' as const
    }))
    registry.register('claude-code', {
      ...driver,
      prewarmSession
    })
    const composition = {
      agentId: 'agent-1',
      sessionId: 'session-1',
      agentType: 'claude-code',
      instructions: null,
      modelId: 'provider-1:chat-model',
      modelName: null,
      permissionMode: 'default',
      workspacePath: '/tmp/workspace',
      workspaceType: 'user',
      environment: {},
      tools: { all: [], enabled: [], disabled: [] },
      mcp: { sources: [], servers: [] },
      skills: { agentId: 'agent-1', skills: [], toolIds: [] }
    } satisfies AgentRuntimeComposition
    const runtime = new AgentSessionRuntimeService({
      getAgentState: async () =>
        createState({
          messagesBySessionId: {
            'session-1': [
              {
                id: 'assistant-success',
                sessionId: 'session-1',
                role: 'assistant',
                data: { parts: [{ type: 'text', text: 'Successful reply' }] },
                searchableText: 'Successful reply',
                status: 'success',
                modelId: agent.model,
                modelSnapshot: {
                  id: 'chat-model',
                  name: 'Chat Model',
                  provider: 'provider-1'
                },
                stats: null,
                runtimeResumeToken: 'resume:previous-success',
                createdAt,
                updatedAt: createdAt
              },
              {
                id: 'assistant-paused',
                sessionId: 'session-1',
                role: 'assistant',
                data: { parts: [{ type: 'text', text: '已停止。' }] },
                searchableText: '已停止。',
                status: 'paused',
                modelId: agent.model,
                modelSnapshot: {
                  id: 'chat-model',
                  name: 'Chat Model',
                  provider: 'provider-1'
                },
                stats: null,
                runtimeResumeToken: null,
                createdAt,
                updatedAt: createdAt
              }
            ]
          }
        }),
      driverRegistry: registry,
      compositionService: {
        compose: async () => composition
      }
    })

    await expect(
      runtime.prewarmSession({
        agentId: 'agent-1',
        sessionId: 'session-1'
      })
    ).resolves.toEqual({
      ok: true,
      status: 'warmed'
    })

    expect(prewarmSession).toHaveBeenCalledWith(
      {
        agentId: 'agent-1',
        sessionId: 'session-1'
      },
      {
        composition,
        traceId: null,
        lastResumeToken: 'resume:previous-success'
      }
    )
    expect(runtime.getSnapshot().sessions['session-1']).toMatchObject({
      lastResumeToken: 'resume:previous-success',
      lastResumeTokenSource: 'persisted',
      lastTerminalStatus: 'paused',
      warmState: 'warm'
    })
  })

  it('tracks warm-session lifecycle in the runtime snapshot during prewarm', async () => {
    const registry = new RuntimeDriverRegistry()
    let resolvePrewarm: (value: { ok: true; status: 'warmed' }) => void = () => {
      throw new Error('Expected prewarm promise resolver to be captured.')
    }
    const prewarmSession = vi.fn(
      async () =>
        new Promise<{ ok: true; status: 'warmed' }>((resolve) => {
          resolvePrewarm = resolve
        })
    )
    registry.register('claude-code', {
      ...createDeferredDriver().driver,
      prewarmSession
    })
    const runtime = new AgentSessionRuntimeService({
      getAgentState: async () => createState(),
      driverRegistry: registry
    })

    const warmPromise = runtime.prewarmSession({
      agentId: 'agent-1',
      sessionId: 'session-1'
    })

    await vi.waitFor(() =>
      expect(runtime.getSnapshot().sessions['session-1']).toMatchObject({
        warmState: 'warming'
      })
    )
    await vi.waitFor(() => expect(prewarmSession).toHaveBeenCalledOnce())

    resolvePrewarm({
      ok: true,
      status: 'warmed'
    })

    await expect(warmPromise).resolves.toEqual({
      ok: true,
      status: 'warmed'
    })
    expect(runtime.getSnapshot().sessions['session-1']).toMatchObject({
      warmState: 'warm'
    })
    expect(runtime.getSnapshot().sessions['session-1']?.lastWarmAt).toEqual(expect.any(String))
    expect(runtime.getSnapshot().sessions['session-1']?.lastWarmResultMessage).toBeNull()
  })

  it('records user-stop reasons when a user cancels an active turn', async () => {
    const registry = new RuntimeDriverRegistry()
    const { driver, pending } = createDeferredDriver()
    registry.register('claude-code', driver)
    const runtime = new AgentSessionRuntimeService({
      getAgentState: async () => createState(),
      driverRegistry: registry
    })

    const turn = runtime.sendMessage({
      agentId: 'agent-1',
      sessionId: 'session-1',
      text: 'Stop me',
      runId: 'run-1'
    })

    await waitForPendingRequest(pending, 0)
    expect(runtime.cancelMessage('run-1')).toBe(true)

    expect(runtime.getSnapshot().sessions['session-1']).toMatchObject({
      turnState: 'stopping',
      lastStopReason: {
        kind: 'user-stop'
      }
    })

    pending[0]!.resolve(
      createRuntimeResult(
        {
          agentId: 'agent-1',
          sessionId: 'session-1',
          text: 'Stop me',
          runId: 'run-1'
        },
        'paused'
      )
    )
    await turn

    expect(runtime.getSnapshot().sessions['session-1']).toMatchObject({
      turnState: 'idle',
      lastTerminalStatus: 'paused',
      lastStopReason: {
        kind: 'user-stop'
      }
    })
    expect(driver.cancelMessage).toHaveBeenCalledWith('run-1', {
      kind: 'user-stop',
      message: 'Stopped by user request.'
    })
  })

  it('records paused terminal status when the active driver aborts before producing a runtime result', async () => {
    const registry = new RuntimeDriverRegistry()
    let rejectTurn: ((error: unknown) => void) | null = null
    const driver: AgentRuntimeDriver = {
      sendMessage: vi.fn(() =>
        new Promise<AgentChatRuntimeResult>((resolve, reject) => {
          rejectTurn = reject
        })
      ),
      cancelMessage: vi.fn(() => {
        rejectTurn?.(new DOMException('Aborted', 'AbortError'))
        return true
      }),
      cancelSession: vi.fn(() => true)
    }
    registry.register('claude-code', driver)
    const runtime = new AgentSessionRuntimeService({
      getAgentState: async () => createState(),
      driverRegistry: registry
    })

    const turn = runtime.sendMessage({
      agentId: 'agent-1',
      sessionId: 'session-1',
      text: 'Abort me early',
      runId: 'run-1'
    })

    await vi.waitFor(() => expect(driver.sendMessage).toHaveBeenCalledOnce())
    expect(runtime.cancelMessage('run-1')).toBe(true)
    await expect(turn).rejects.toMatchObject({
      name: 'AbortError'
    })

    expect(runtime.getSnapshot().sessions['session-1']).toMatchObject({
      turnState: 'idle',
      lastTerminalStatus: 'paused',
      lastStopReason: {
        kind: 'user-stop'
      }
    })
  })

  it('records runtime-stop reasons when shutdown disposes an active turn', async () => {
    const registry = new RuntimeDriverRegistry()
    const { driver, pending } = createDeferredDriver()
    registry.register('claude-code', driver)
    const runtime = new AgentSessionRuntimeService({
      getAgentState: async () => createState(),
      driverRegistry: registry
    })

    const turn = runtime.sendMessage({
      agentId: 'agent-1',
      sessionId: 'session-1',
      text: 'Dispose me',
      runId: 'run-1'
    })

    await waitForPendingRequest(pending, 0)
    await runtime.dispose()

    expect(driver.cancelSession).toHaveBeenCalledWith('session-1', {
      kind: 'runtime-stop',
      message: 'Agent session runtime is disposed.'
    })
    expect(runtime.getSnapshot().sessions['session-1']).toMatchObject({
      turnState: 'stopping',
      lastStopReason: {
        kind: 'runtime-stop'
      }
    })

    pending[0]!.resolve(
      createRuntimeResult(
        {
          agentId: 'agent-1',
          sessionId: 'session-1',
          text: 'Dispose me',
          runId: 'run-1'
        },
        'paused'
      )
    )
    await turn

    expect(runtime.getSnapshot().sessions['session-1']).toMatchObject({
      turnState: 'idle',
      lastTerminalStatus: 'paused',
      lastStopReason: {
        kind: 'runtime-stop'
      }
    })
  })
})
