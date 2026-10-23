import { describe, expect, it, vi } from 'vitest'

import type { McpServerEntity } from '../schemas/mcpServerSchemas'
import { createAgentStoreState } from '../store/agentStore'
import { ToolRegistry } from '../tools/registry'
import { McpRuntimeService } from './McpRuntimeService'
import { createMcpRuntimeDependencyError } from './mcpRuntimeError'
import type { McpRuntimeServerHost, McpRuntimeServerToolCall } from './mcpRuntimeHost'

const activeServer: McpServerEntity = {
  id: 'mcp-files',
  name: 'Filesystem',
  type: 'stdio',
  command: 'npx',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const disabledServer: McpServerEntity = {
  ...activeServer,
  id: 'mcp-disabled',
  name: 'Disabled Filesystem',
  isActive: false
}

function createDeferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, resolve, reject }
}

function createScheduledTaskQueue(): {
  scheduleTask: (run: () => void, delayMs: number) => { cancel: () => void }
  tasks: Array<{ run: () => void; delayMs: number; cancelled: boolean }>
} {
  const tasks: Array<{ run: () => void; delayMs: number; cancelled: boolean }> = []

  return {
    tasks,
    scheduleTask: (run, delayMs) => {
      const task = { run, delayMs, cancelled: false }
      tasks.push(task)
      return {
        cancel: () => {
          task.cancelled = true
        }
      }
    }
  }
}

describe('MCP runtime service', () => {
  it('registers discovered tools from active servers into ToolRegistry sources', () => {
    const toolRegistry = new ToolRegistry()
    const runtime = new McpRuntimeService({ toolRegistry })
    const state = createAgentStoreState({
      mcpServers: [activeServer],
      mcpToolsByServerId: {
        'mcp-files': [
          {
            id: 'read_file',
            name: 'read_file',
            description: 'Read a file'
          }
        ]
      }
    })

    const snapshot = runtime.syncFromState(state)

    expect(snapshot.sources).toEqual([
      {
        serverId: 'mcp-files',
        sourceId: 'mcp:mcp-files',
        toolCount: 1,
        isActive: true,
        runtimeState: 'connecting'
      }
    ])
    expect(toolRegistry.listBySource('mcp:mcp-files')).toEqual([
      {
        id: 'mcp__filesystem__readFile',
        name: 'read_file',
        description: 'Read a file',
        origin: 'mcp',
        approval: 'auto',
        sourceId: 'mcp-files',
        sourceName: 'Filesystem'
      }
    ])
  })

  it('includes runtime status in snapshot and keeps last known tools during error states', () => {
    const toolRegistry = new ToolRegistry()
    const runtime = new McpRuntimeService({ toolRegistry })
    const state = createAgentStoreState({
      mcpServers: [activeServer],
      mcpToolsByServerId: {
        'mcp-files': [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]
      },
      mcpRuntimeStatusByServerId: {
        'mcp-files': { state: 'error', message: 'spawn failed', lastCheckedAt: 42 }
      }
    })

    const snapshot = runtime.syncFromState(state)

    expect(snapshot.sources).toEqual([
      {
        serverId: 'mcp-files',
        sourceId: 'mcp:mcp-files',
        toolCount: 1,
        isActive: true,
        runtimeState: 'error',
        runtimeMessage: 'spawn failed',
        lastCheckedAt: 42
      }
    ])
    expect(toolRegistry.listBySource('mcp:mcp-files')).toEqual([
      {
        id: 'mcp__filesystem__readFile',
        name: 'read_file',
        description: 'Read a file',
        origin: 'mcp',
        approval: 'auto',
        sourceId: 'mcp-files',
        sourceName: 'Filesystem'
      }
    ])
  })

  it('downgrades a stale persisted connected status to connecting when no live host exists yet', () => {
    const toolRegistry = new ToolRegistry()
    const runtime = new McpRuntimeService({ toolRegistry })
    const state = createAgentStoreState({
      mcpServers: [activeServer],
      mcpToolsByServerId: {
        'mcp-files': [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]
      },
      mcpRuntimeStatusByServerId: {
        'mcp-files': { state: 'connected', lastCheckedAt: 42 }
      }
    })

    const snapshot = runtime.syncFromState(state)

    expect(snapshot.sources).toEqual([
      {
        serverId: 'mcp-files',
        sourceId: 'mcp:mcp-files',
        toolCount: 1,
        isActive: true,
        runtimeState: 'connecting',
        lastCheckedAt: 42
      }
    ])
  })

  it('removes tool sources for inactive or missing servers during sync', () => {
    const toolRegistry = new ToolRegistry()
    const runtime = new McpRuntimeService({ toolRegistry })

    runtime.syncFromState(
      createAgentStoreState({
        mcpServers: [activeServer],
        mcpToolsByServerId: {
          'mcp-files': [{ id: 'read_file', name: 'read_file' }]
        }
      })
    )

    const snapshot = runtime.syncFromState(
      createAgentStoreState({
        mcpServers: [disabledServer],
        mcpToolsByServerId: {
          'mcp-files': [{ id: 'read_file', name: 'read_file' }]
        }
      })
    )

    expect(snapshot.sources).toEqual([])
    expect(toolRegistry.listBySource('mcp:mcp-files')).toEqual([])
  })

  it('replaces a server source on repeated sync instead of accumulating stale tools', () => {
    const toolRegistry = new ToolRegistry()
    const runtime = new McpRuntimeService({ toolRegistry })

    runtime.syncFromState(
      createAgentStoreState({
        mcpServers: [activeServer],
        mcpToolsByServerId: {
          'mcp-files': [{ id: 'read_file', name: 'read_file' }]
        }
      })
    )

    runtime.syncFromState(
      createAgentStoreState({
        mcpServers: [activeServer],
        mcpToolsByServerId: {
          'mcp-files': [{ id: 'write_file', name: 'write_file' }]
        }
      })
    )

    expect(toolRegistry.listBySource('mcp:mcp-files')).toEqual([
      {
        id: 'mcp__filesystem__writeFile',
        name: 'write_file',
        description: '',
        origin: 'mcp',
        approval: 'auto',
        sourceId: 'mcp-files',
        sourceName: 'Filesystem'
      }
    ])
  })

  it('can return a snapshot filtered to a subset of active server ids', () => {
    const toolRegistry = new ToolRegistry()
    const runtime = new McpRuntimeService({ toolRegistry })
    const otherServer: McpServerEntity = {
      ...activeServer,
      id: 'mcp-git',
      name: 'Git'
    }

    runtime.syncFromState(
      createAgentStoreState({
        mcpServers: [activeServer, otherServer],
        mcpToolsByServerId: {
          'mcp-files': [{ id: 'read_file', name: 'read_file' }],
          'mcp-git': [{ id: 'git_status', name: 'git_status' }]
        }
      })
    )

    expect(runtime.getSnapshotForServerIds(['mcp-files'])).toEqual({
      sources: [
        {
          serverId: 'mcp-files',
          sourceId: 'mcp:mcp-files',
          toolCount: 1,
          isActive: true,
          runtimeState: 'connecting'
        }
      ]
    })
  })

  it('creates and reuses runtime hosts for active servers while refreshing discovered tools through the host', async () => {
    const toolRegistry = new ToolRegistry()
    const host: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => [{ name: 'read_file', description: 'Read through host' }]),
      invokeTool: vi.fn(async () => ({ output: { ok: true } })),
      close: vi.fn()
    }
    const createServerHost = vi.fn(async () => host)
    const runtime = new McpRuntimeService({ toolRegistry, createServerHost })
    const state = createAgentStoreState({ mcpServers: [activeServer] })

    runtime.syncFromState(state)
    const firstRefresh = await runtime.refreshServerTools(state, 'mcp-files', { now: () => 100 })
    const secondRefresh = await runtime.refreshServerTools(firstRefresh.state, 'mcp-files', { now: () => 110 })

    expect(createServerHost).toHaveBeenCalledTimes(1)
    expect(host.discoverTools).toHaveBeenCalledTimes(2)
    expect(firstRefresh.tools).toEqual([
      {
        id: 'read_file',
        name: 'read_file',
        description: 'Read through host',
        inputSchema: undefined
      }
    ])
    expect(secondRefresh.state.mcpRuntimeStatusByServerId['mcp-files']).toEqual({
      state: 'connected',
      lastCheckedAt: 110
    })
    expect(toolRegistry.listBySource('mcp:mcp-files')).toEqual([
      {
        id: 'mcp__filesystem__readFile',
        name: 'read_file',
        description: 'Read through host',
        origin: 'mcp',
        approval: 'auto',
        sourceId: 'mcp-files',
        sourceName: 'Filesystem'
      }
    ])
  })

  it('deduplicates concurrent runtime host creation for the same server', async () => {
    const toolRegistry = new ToolRegistry()
    const deferredHost = createDeferred<McpRuntimeServerHost>()
    const host: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]),
      invokeTool: vi.fn(async () => ({ output: { ok: true } })),
      close: vi.fn()
    }
    const createServerHost = vi.fn(async () => deferredHost.promise)
    const runtime = new McpRuntimeService({ toolRegistry, createServerHost })
    const state = createAgentStoreState({ mcpServers: [activeServer] })

    runtime.syncFromState(state)

    const firstOperation = runtime.runOperation({
      kind: 'discover-tools',
      serverId: 'mcp-files'
    })
    const secondOperation = runtime.runOperation({
      kind: 'discover-tools',
      serverId: 'mcp-files'
    })

    await Promise.resolve()

    expect(createServerHost).toHaveBeenCalledTimes(1)

    deferredHost.resolve(host)

    await expect(Promise.all([firstOperation, secondOperation])).resolves.toEqual([
      {
        kind: 'discover-tools',
        tools: [
          {
            id: 'read_file',
            name: 'read_file',
            description: 'Read a file',
            inputSchema: undefined
          }
        ]
      },
      {
        kind: 'discover-tools',
        tools: [
          {
            id: 'read_file',
            name: 'read_file',
            description: 'Read a file',
            inputSchema: undefined
          }
        ]
      }
    ])
  })

  it('schedules a reconnect when an in-flight host connect becomes stale after config change', async () => {
    const toolRegistry = new ToolRegistry()
    const scheduled = createScheduledTaskQueue()
    const deferredHost = createDeferred<McpRuntimeServerHost>()
    const staleHost: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => [{ id: 'stale_file', name: 'stale_file', description: 'Stale file' }]),
      invokeTool: vi.fn(async () => ({ output: 'stale' })),
      close: vi.fn()
    }
    const rebuiltHost: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => [{ id: 'write_file', name: 'write_file', description: 'Write a file' }]),
      invokeTool: vi.fn(async () => ({ output: 'rebuilt' })),
      close: vi.fn()
    }
    const createServerHost = vi
      .fn(async (_server: McpServerEntity) => rebuiltHost)
      .mockImplementationOnce(async () => deferredHost.promise)
      .mockResolvedValueOnce(rebuiltHost)
    const runtime = new McpRuntimeService({
      toolRegistry,
      createServerHost,
      scheduleTask: scheduled.scheduleTask,
      reconnectDelayMs: () => 1
    })

    runtime.syncFromState(createAgentStoreState({ mcpServers: [activeServer] }))
    const firstDiscover = runtime.runOperation({
      kind: 'discover-tools',
      serverId: 'mcp-files'
    })

    await Promise.resolve()

    const changedState = createAgentStoreState({
      mcpServers: [{ ...activeServer, args: ['--new-during-connect'] }],
      mcpToolsByServerId: {
        'mcp-files': [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]
      },
      mcpRuntimeStatusByServerId: {
        'mcp-files': { state: 'connected', lastCheckedAt: 10 }
      }
    })
    runtime.syncFromState(changedState)

    await vi.waitFor(() => {
      expect(scheduled.tasks).toHaveLength(1)
    })
    expect(runtime.getSnapshot()).toEqual({
      sources: [
        {
          serverId: 'mcp-files',
          sourceId: 'mcp:mcp-files',
          toolCount: 1,
          isActive: true,
          runtimeState: 'connecting',
          reconnectAttempt: 1,
          reconnectDelayMs: 1,
          nextReconnectAt: expect.any(Number),
          lastCheckedAt: expect.any(Number)
        }
      ]
    })

    deferredHost.resolve(staleHost)

    await expect(firstDiscover).rejects.toThrow('changed while connecting')
    await vi.waitFor(() => {
      expect(staleHost.close).toHaveBeenCalledTimes(1)
    })

    scheduled.tasks[0]?.run()

    await vi.waitFor(() => {
      expect(rebuiltHost.discoverTools).toHaveBeenCalledTimes(1)
    })

    const rebuildCall = createServerHost.mock.calls[1] as [McpServerEntity] | undefined
    expect(rebuildCall?.[0]).toMatchObject({
      id: 'mcp-files',
      args: ['--new-during-connect']
    })
    expect(runtime.getSnapshot()).toEqual({
      sources: [
        {
          serverId: 'mcp-files',
          sourceId: 'mcp:mcp-files',
          toolCount: 1,
          isActive: true,
          runtimeState: 'connected',
          lastCheckedAt: expect.any(Number)
        }
      ]
    })
  })

  it('closes stale runtime hosts when an active server config changes or becomes inactive', async () => {
    const toolRegistry = new ToolRegistry()
    const firstHost: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => [{ id: 'read_file', name: 'read_file' }]),
      invokeTool: vi.fn(async () => ({ output: 'first' })),
      close: vi.fn()
    }
    const secondHost: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => [{ id: 'write_file', name: 'write_file' }]),
      invokeTool: vi.fn(async () => ({ output: 'second' })),
      close: vi.fn()
    }
    const createServerHost = vi
      .fn<() => Promise<McpRuntimeServerHost>>()
      .mockResolvedValueOnce(firstHost)
      .mockResolvedValueOnce(secondHost)
    const runtime = new McpRuntimeService({ toolRegistry, createServerHost })

    const initial = createAgentStoreState({
      mcpServers: [activeServer]
    })
    runtime.syncFromState(initial)
    await runtime.refreshServerTools(initial, 'mcp-files', { now: () => 1 })

    const changedState = createAgentStoreState({
      mcpServers: [{ ...activeServer, args: ['--new'] }]
    })
    runtime.syncFromState(changedState)
    await runtime.refreshServerTools(changedState, 'mcp-files', { now: () => 2 })

    expect(firstHost.close).toHaveBeenCalledTimes(1)
    expect(secondHost.discoverTools).toHaveBeenCalledTimes(1)

    runtime.syncFromState(
      createAgentStoreState({
        mcpServers: [disabledServer],
        mcpToolsByServerId: {
          'mcp-files': [{ id: 'write_file', name: 'write_file' }]
        }
      })
    )

    expect(secondHost.close).toHaveBeenCalledTimes(1)
  })

  it('schedules a reconnect when a connected server config changes and rebuilds the host from the latest signature', async () => {
    const toolRegistry = new ToolRegistry()
    const scheduled = createScheduledTaskQueue()
    const firstHost: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]),
      invokeTool: vi.fn(async () => ({ output: 'first' })),
      close: vi.fn()
    }
    const rebuiltHost: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => [{ id: 'write_file', name: 'write_file', description: 'Write a file' }]),
      invokeTool: vi.fn(async () => ({ output: 'second' })),
      close: vi.fn()
    }
    const createServerHost = vi
      .fn(async (_server: McpServerEntity) => rebuiltHost)
      .mockResolvedValueOnce(firstHost)
      .mockResolvedValueOnce(rebuiltHost)
    const runtime = new McpRuntimeService({
      toolRegistry,
      createServerHost,
      scheduleTask: scheduled.scheduleTask,
      reconnectDelayMs: () => 1
    })

    const initial = createAgentStoreState({ mcpServers: [activeServer] })
    runtime.syncFromState(initial)
    await runtime.refreshServerTools(initial, 'mcp-files', { now: () => 1 })

    const changedState = createAgentStoreState({
      mcpServers: [{ ...activeServer, args: ['--new'] }],
      mcpToolsByServerId: {
        'mcp-files': [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]
      },
      mcpRuntimeStatusByServerId: {
        'mcp-files': { state: 'connected', lastCheckedAt: 1 }
      }
    })

    runtime.syncFromState(changedState)

    await vi.waitFor(() => {
      expect(firstHost.close).toHaveBeenCalledTimes(1)
      expect(scheduled.tasks).toHaveLength(1)
    })
    expect(runtime.getSnapshot()).toEqual({
      sources: [
        {
          serverId: 'mcp-files',
          sourceId: 'mcp:mcp-files',
          toolCount: 1,
          isActive: true,
          runtimeState: 'connecting',
          reconnectAttempt: 1,
          reconnectDelayMs: 1,
          nextReconnectAt: expect.any(Number),
          lastCheckedAt: expect.any(Number)
        }
      ]
    })

    scheduled.tasks[0]?.run()

    await vi.waitFor(() => {
      expect(rebuiltHost.discoverTools).toHaveBeenCalledTimes(1)
    })

    const rebuildCall = createServerHost.mock.calls[1] as [McpServerEntity] | undefined
    expect(rebuildCall?.[0]).toMatchObject({
      id: 'mcp-files',
      args: ['--new']
    })
    expect(runtime.getSnapshot()).toEqual({
      sources: [
        {
          serverId: 'mcp-files',
          sourceId: 'mcp:mcp-files',
          toolCount: 1,
          isActive: true,
          runtimeState: 'connected',
          lastCheckedAt: expect.any(Number)
        }
      ]
    })
  })

  it('keeps runtime error status after a failed refresh even if a later state sync is stale', async () => {
    const toolRegistry = new ToolRegistry()
    const runtime = new McpRuntimeService({
      toolRegistry,
      createServerHost: vi.fn(async () => {
        throw new Error('spawn failed')
      })
    })
    const state = createAgentStoreState({
      mcpServers: [activeServer],
      mcpToolsByServerId: {
        'mcp-files': [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]
      }
    })

    runtime.syncFromState(state)

    await expect(runtime.refreshServerTools(state, 'mcp-files', { now: () => 123 })).rejects.toThrow('spawn failed')
    expect(runtime.getSnapshot()).toEqual({
      sources: [
        {
          serverId: 'mcp-files',
          sourceId: 'mcp:mcp-files',
          toolCount: 0,
          isActive: true,
          runtimeState: 'error',
          runtimeMessage: 'spawn failed',
          lastCheckedAt: 123
        }
      ]
    })

    expect(runtime.syncFromState(state)).toEqual({
      sources: [
        {
          serverId: 'mcp-files',
          sourceId: 'mcp:mcp-files',
          toolCount: 1,
          isActive: true,
          runtimeState: 'error',
          runtimeMessage: 'spawn failed',
          lastCheckedAt: 123
        }
      ]
    })
  })

  it('allows a later refresh retry after host creation fails once', async () => {
    const toolRegistry = new ToolRegistry()
    const host: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => [{ id: 'read_file', name: 'read_file', description: 'Read after retry' }]),
      invokeTool: vi.fn(async () => ({ output: { ok: true } })),
      close: vi.fn()
    }
    const createServerHost = vi
      .fn<() => Promise<McpRuntimeServerHost>>()
      .mockRejectedValueOnce(new Error('spawn failed'))
      .mockResolvedValueOnce(host)
    const runtime = new McpRuntimeService({ toolRegistry, createServerHost })
    const state = createAgentStoreState({
      mcpServers: [activeServer],
      mcpToolsByServerId: {
        'mcp-files': [{ id: 'read_file', name: 'read_file', description: 'Stale read file' }]
      }
    })

    runtime.syncFromState(state)

    await expect(runtime.refreshServerTools(state, 'mcp-files', { now: () => 123 })).rejects.toThrow('spawn failed')

    const retry = await runtime.refreshServerTools(state, 'mcp-files', { now: () => 124 })

    expect(createServerHost).toHaveBeenCalledTimes(2)
    expect(retry.state.mcpRuntimeStatusByServerId['mcp-files']).toEqual({
      state: 'connected',
      lastCheckedAt: 124
    })
    expect(runtime.getSnapshot()).toEqual({
      sources: [
        {
          serverId: 'mcp-files',
          sourceId: 'mcp:mcp-files',
          toolCount: 1,
          isActive: true,
          runtimeState: 'connected',
          lastCheckedAt: 124
        }
      ]
    })
  })

  it('reports connecting while a reconnect is pending instead of keeping a stale error snapshot', async () => {
    const toolRegistry = new ToolRegistry()
    const deferredHost = createDeferred<McpRuntimeServerHost>()
    const host: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => [{ id: 'read_file', name: 'read_file', description: 'Recovered read' }]),
      invokeTool: vi.fn(async () => ({ output: { ok: true } })),
      close: vi.fn()
    }
    const createServerHost = vi.fn(async () => deferredHost.promise)
    const runtime = new McpRuntimeService({ toolRegistry, createServerHost })
    const state = createAgentStoreState({
      mcpServers: [activeServer],
      mcpToolsByServerId: {
        'mcp-files': [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]
      },
      mcpRuntimeStatusByServerId: {
        'mcp-files': { state: 'error', message: 'spawn failed', lastCheckedAt: 42 }
      }
    })

    runtime.syncFromState(state)

    const operation = runtime.runOperation({
      kind: 'discover-tools',
      serverId: 'mcp-files'
    })

    await Promise.resolve()

    expect(runtime.getSnapshot()).toEqual({
      sources: [
        {
          serverId: 'mcp-files',
          sourceId: 'mcp:mcp-files',
          toolCount: 1,
          isActive: true,
          runtimeState: 'connecting',
          lastCheckedAt: 42
        }
      ]
    })

    deferredHost.resolve(host)
    await expect(operation).resolves.toEqual({
      kind: 'discover-tools',
      tools: [
        {
          id: 'read_file',
          name: 'read_file',
          description: 'Recovered read',
          inputSchema: undefined
        }
      ]
    })
  })

  it('can return an error-state refresh result without throwing when throwOnError is false', async () => {
    const toolRegistry = new ToolRegistry()
    const runtime = new McpRuntimeService({
      toolRegistry,
      createServerHost: vi.fn(async () => {
        throw new Error('spawn failed')
      })
    })
    const state = createAgentStoreState({
      mcpServers: [activeServer],
      mcpToolsByServerId: {
        'mcp-files': [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]
      }
    })

    runtime.syncFromState(state)

    await expect(
      runtime.refreshServerTools(state, 'mcp-files', {
        now: () => 123,
        preserveToolsOnError: true,
        throwOnError: false
      })
    ).resolves.toEqual({
      state: createAgentStoreState({
        ...state,
        mcpRuntimeStatusByServerId: {
          'mcp-files': {
            state: 'error',
            message: 'spawn failed',
            errorKind: 'transient',
            retryable: true,
            lifecycleState: 'reconnect-scheduled',
            lastCheckedAt: 123
          }
        }
      }),
      tools: [
        {
          id: 'read_file',
          name: 'read_file',
          description: 'Read a file'
        }
      ]
    })
  })

  it('closes a broken live host after refresh failure and recreates it on the next refresh', async () => {
    const toolRegistry = new ToolRegistry()
    const firstHost: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => {
        throw new Error('broken refresh')
      }),
      invokeTool: vi.fn(async () => ({ output: 'first' })),
      close: vi.fn()
    }
    const secondHost: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => [{ id: 'read_file', name: 'read_file', description: 'Recovered read' }]),
      invokeTool: vi.fn(async () => ({ output: 'second' })),
      close: vi.fn()
    }
    const createServerHost = vi
      .fn<() => Promise<McpRuntimeServerHost>>()
      .mockResolvedValueOnce(firstHost)
      .mockResolvedValueOnce(secondHost)
    const runtime = new McpRuntimeService({ toolRegistry, createServerHost })
    const state = createAgentStoreState({ mcpServers: [activeServer] })

    runtime.syncFromState(state)

    await expect(
      runtime.refreshServerTools(state, 'mcp-files', {
        now: () => 200,
        throwOnError: true
      })
    ).rejects.toThrow('broken refresh')
    expect(firstHost.close).toHaveBeenCalledTimes(1)
    expect(runtime.getSnapshot()).toEqual({
      sources: [
        {
          serverId: 'mcp-files',
          sourceId: 'mcp:mcp-files',
          toolCount: 0,
          isActive: true,
          runtimeState: 'error',
          runtimeMessage: 'broken refresh',
          lastCheckedAt: 200
        }
      ]
    })

    const retry = await runtime.refreshServerTools(state, 'mcp-files', { now: () => 201 })

    expect(createServerHost).toHaveBeenCalledTimes(2)
    expect(secondHost.discoverTools).toHaveBeenCalledTimes(1)
    expect(retry.tools).toEqual([
      {
        id: 'read_file',
        name: 'read_file',
        description: 'Recovered read',
        inputSchema: undefined
      }
    ])
  })

  it('schedules a reconnect after a broken runtime operation closes the live host', async () => {
    const toolRegistry = new ToolRegistry()
    const scheduled = createScheduledTaskQueue()
    const firstHost: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]),
      invokeTool: vi.fn(async () => {
        throw new Error('invoke failed')
      }),
      close: vi.fn()
    }
    const secondHost: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => [{ id: 'write_file', name: 'write_file', description: 'Recovered write' }]),
      invokeTool: vi.fn(async () => ({ output: { ok: true } })),
      close: vi.fn()
    }
    const createServerHost = vi
      .fn<() => Promise<McpRuntimeServerHost>>()
      .mockResolvedValueOnce(firstHost)
      .mockResolvedValueOnce(secondHost)
    const runtime = new McpRuntimeService({
      toolRegistry,
      createServerHost,
      scheduleTask: scheduled.scheduleTask,
      reconnectDelayMs: () => 25
    })
    const state = createAgentStoreState({
      mcpServers: [activeServer],
      mcpToolsByServerId: {
        'mcp-files': [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]
      }
    })

    runtime.syncFromState(state)
    await runtime.refreshServerTools(state, 'mcp-files', { now: () => 10 })

    await expect(
      runtime.runOperation({
        kind: 'invoke-tool',
        toolId: 'mcp__filesystem__readFile',
        input: { path: '/tmp/demo.txt' }
      })
    ).rejects.toThrow('invoke failed')

    await vi.waitFor(() => {
      expect(firstHost.close).toHaveBeenCalledTimes(1)
      expect(scheduled.tasks).toHaveLength(1)
    })
    expect(runtime.getSnapshot()).toEqual({
      sources: [
        {
          serverId: 'mcp-files',
          sourceId: 'mcp:mcp-files',
          toolCount: 1,
          isActive: true,
          runtimeState: 'connecting',
          reconnectAttempt: 1,
          reconnectDelayMs: 25,
          nextReconnectAt: expect.any(Number),
          lastCheckedAt: expect.any(Number)
        }
      ]
    })

    scheduled.tasks[0]?.run()

    await vi.waitFor(() => {
      expect(secondHost.discoverTools).toHaveBeenCalledTimes(1)
    })

    expect(createServerHost).toHaveBeenCalledTimes(2)
    expect(runtime.getSnapshot()).toEqual({
      sources: [
        {
          serverId: 'mcp-files',
          sourceId: 'mcp:mcp-files',
          toolCount: 1,
          isActive: true,
          runtimeState: 'connected',
          lastCheckedAt: expect.any(Number)
        }
      ]
    })
  })

  it('schedules a reconnect when discover-tools fails during initial host creation with a retryable error', async () => {
    const toolRegistry = new ToolRegistry()
    const scheduled = createScheduledTaskQueue()
    const recoveredHost: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => [{ id: 'write_file', name: 'write_file', description: 'Recovered write' }]),
      invokeTool: vi.fn(async () => ({ output: { ok: true } })),
      close: vi.fn()
    }
    const createServerHost = vi
      .fn<() => Promise<McpRuntimeServerHost>>()
      .mockRejectedValueOnce(new Error('spawn failed'))
      .mockResolvedValueOnce(recoveredHost)
    const runtime = new McpRuntimeService({
      toolRegistry,
      createServerHost,
      scheduleTask: scheduled.scheduleTask,
      reconnectDelayMs: () => 25
    })
    const state = createAgentStoreState({
      mcpServers: [activeServer],
      mcpToolsByServerId: {
        'mcp-files': [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]
      }
    })

    runtime.syncFromState(state)

    await expect(
      runtime.runOperation({
        kind: 'discover-tools',
        serverId: 'mcp-files'
      })
    ).rejects.toThrow('spawn failed')

    expect(scheduled.tasks).toHaveLength(1)
    expect(runtime.getSnapshot()).toEqual({
      sources: [
        {
          serverId: 'mcp-files',
          sourceId: 'mcp:mcp-files',
          toolCount: 1,
          isActive: true,
          runtimeState: 'connecting',
          reconnectAttempt: 1,
          reconnectDelayMs: 25,
          nextReconnectAt: expect.any(Number),
          lastCheckedAt: expect.any(Number)
        }
      ]
    })

    scheduled.tasks[0]?.run()

    await vi.waitFor(() => {
      expect(recoveredHost.discoverTools).toHaveBeenCalledTimes(1)
    })

    expect(createServerHost).toHaveBeenCalledTimes(2)
    expect(runtime.getSnapshot()).toEqual({
      sources: [
        {
          serverId: 'mcp-files',
          sourceId: 'mcp:mcp-files',
          toolCount: 1,
          isActive: true,
          runtimeState: 'connected',
          lastCheckedAt: expect.any(Number)
        }
      ]
    })
  })

  it('does not schedule reconnect when initial host creation fails with a terminal dependency error', async () => {
    const toolRegistry = new ToolRegistry()
    const scheduled = createScheduledTaskQueue()
    const runtime = new McpRuntimeService({
      toolRegistry,
      createServerHost: vi.fn(async () => {
        throw createMcpRuntimeDependencyError('MCP SDK package is not installed in the desktop main process runtime.')
      }),
      scheduleTask: scheduled.scheduleTask,
      reconnectDelayMs: () => 25
    })
    const state = createAgentStoreState({
      mcpServers: [activeServer],
      mcpToolsByServerId: {
        'mcp-files': [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]
      }
    })

    runtime.syncFromState(state)

    await expect(
      runtime.runOperation({
        kind: 'discover-tools',
        serverId: 'mcp-files'
      })
    ).rejects.toThrow('MCP SDK package is not installed in the desktop main process runtime.')

    expect(scheduled.tasks).toHaveLength(0)
    expect(runtime.getSnapshot()).toEqual({
      sources: [
        {
          serverId: 'mcp-files',
          sourceId: 'mcp:mcp-files',
          toolCount: 1,
          isActive: true,
          runtimeState: 'error',
          runtimeMessage: 'MCP SDK package is not installed in the desktop main process runtime.',
          lastCheckedAt: expect.any(Number)
        }
      ]
    })
  })

  it('does not schedule reconnect after a terminal auth error from a runtime operation', async () => {
    const toolRegistry = new ToolRegistry()
    const scheduled = createScheduledTaskQueue()
    const authError = Object.assign(new Error('Unauthorized'), {
      status: 401
    })
    const host: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]),
      invokeTool: vi.fn(async () => {
        throw authError
      }),
      close: vi.fn()
    }
    const runtime = new McpRuntimeService({
      toolRegistry,
      createServerHost: async () => host,
      scheduleTask: scheduled.scheduleTask,
      reconnectDelayMs: () => 25
    })
    const state = createAgentStoreState({
      mcpServers: [activeServer],
      mcpToolsByServerId: {
        'mcp-files': [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]
      }
    })

    runtime.syncFromState(state)
    await runtime.refreshServerTools(state, 'mcp-files', { now: () => 10 })

    await expect(
      runtime.runOperation({
        kind: 'invoke-tool',
        toolId: 'mcp__filesystem__readFile',
        input: { path: '/tmp/demo.txt' }
      })
    ).rejects.toThrow('Unauthorized')

    expect(host.close).toHaveBeenCalledTimes(1)
    expect(scheduled.tasks).toHaveLength(0)
    expect(runtime.getSnapshot()).toEqual({
      sources: [
        {
          serverId: 'mcp-files',
          sourceId: 'mcp:mcp-files',
          toolCount: 1,
          isActive: true,
          runtimeState: 'error',
          runtimeMessage: 'Unauthorized',
          lastCheckedAt: expect.any(Number)
        }
      ]
    })
  })

  it('exposes terminal auth diagnostics when requested from the runtime snapshot', async () => {
    const toolRegistry = new ToolRegistry()
    const authError = Object.assign(new Error('Unauthorized'), {
      status: 401
    })
    const host: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]),
      invokeTool: vi.fn(async () => {
        throw authError
      }),
      close: vi.fn()
    }
    const runtime = new McpRuntimeService({
      toolRegistry,
      createServerHost: async () => host
    })
    const state = createAgentStoreState({
      mcpServers: [activeServer],
      mcpToolsByServerId: {
        'mcp-files': [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]
      }
    })

    runtime.syncFromState(state)
    await runtime.refreshServerTools(state, 'mcp-files', { now: () => 10 })

    await expect(
      runtime.runOperation({
        kind: 'invoke-tool',
        toolId: 'mcp__filesystem__readFile',
        input: { path: '/tmp/demo.txt' }
      })
    ).rejects.toThrow('Unauthorized')

    expect(runtime.getSnapshot({ includeDiagnostics: true })).toEqual({
      sources: [
        {
          serverId: 'mcp-files',
          sourceId: 'mcp:mcp-files',
          toolCount: 1,
          isActive: true,
          runtimeState: 'error',
          runtimeMessage: 'Unauthorized',
          runtimeErrorKind: 'auth',
          runtimeRetryable: false,
          runtimeLifecycleState: 'terminal-error',
          lastCheckedAt: expect.any(Number)
        }
      ]
    })
  })

  it('stops reconnect scheduling after the configured attempt limit is exhausted', async () => {
    const toolRegistry = new ToolRegistry()
    const scheduled = createScheduledTaskQueue()
    const firstHost: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]),
      invokeTool: vi.fn(async () => {
        throw new Error('invoke failed')
      }),
      close: vi.fn()
    }
    const createServerHost = vi
      .fn<() => Promise<McpRuntimeServerHost>>()
      .mockResolvedValueOnce(firstHost)
      .mockRejectedValueOnce(new Error('restart failed once'))
      .mockRejectedValueOnce(new Error('restart failed twice'))
    const runtime = new McpRuntimeService({
      toolRegistry,
      createServerHost,
      scheduleTask: scheduled.scheduleTask,
      reconnectDelayMs: () => 1,
      maxReconnectAttempts: 2
    })
    const state = createAgentStoreState({
      mcpServers: [activeServer],
      mcpToolsByServerId: {
        'mcp-files': [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]
      }
    })

    runtime.syncFromState(state)
    await runtime.refreshServerTools(state, 'mcp-files', { now: () => 10 })

    await expect(
      runtime.runOperation({
        kind: 'invoke-tool',
        toolId: 'mcp__filesystem__readFile',
        input: { path: '/tmp/demo.txt' }
      })
    ).rejects.toThrow('invoke failed')

    await vi.waitFor(() => {
      expect(scheduled.tasks).toHaveLength(1)
    })

    scheduled.tasks[0]?.run()

    await vi.waitFor(() => {
      expect(scheduled.tasks).toHaveLength(2)
    })

    scheduled.tasks[1]?.run()

    await vi.waitFor(() => {
      expect(createServerHost).toHaveBeenCalledTimes(3)
      expect(runtime.getSnapshot()).toEqual({
        sources: [
          {
            serverId: 'mcp-files',
            sourceId: 'mcp:mcp-files',
            toolCount: 1,
            isActive: true,
            runtimeState: 'error',
            runtimeMessage: 'restart failed twice',
            reconnectAttempt: 2,
            maxReconnectAttempts: 2,
            reconnectExhausted: true,
            lastCheckedAt: expect.any(Number)
          }
        ]
      })
    })
    expect(scheduled.tasks).toHaveLength(2)
  })

  it('stops reconnect retries when a reconnect attempt fails with a terminal dependency error', async () => {
    const toolRegistry = new ToolRegistry()
    const scheduled = createScheduledTaskQueue()
    const firstHost: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]),
      invokeTool: vi.fn(async () => {
        throw new Error('invoke failed')
      }),
      close: vi.fn()
    }
    const createServerHost = vi
      .fn<() => Promise<McpRuntimeServerHost>>()
      .mockResolvedValueOnce(firstHost)
      .mockRejectedValueOnce(
        createMcpRuntimeDependencyError('MCP SDK package is not installed in the desktop main process runtime.')
      )
    const runtime = new McpRuntimeService({
      toolRegistry,
      createServerHost,
      scheduleTask: scheduled.scheduleTask,
      reconnectDelayMs: () => 1,
      maxReconnectAttempts: 3
    })
    const state = createAgentStoreState({
      mcpServers: [activeServer],
      mcpToolsByServerId: {
        'mcp-files': [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]
      }
    })

    runtime.syncFromState(state)
    await runtime.refreshServerTools(state, 'mcp-files', { now: () => 10 })

    await expect(
      runtime.runOperation({
        kind: 'invoke-tool',
        toolId: 'mcp__filesystem__readFile',
        input: { path: '/tmp/demo.txt' }
      })
    ).rejects.toThrow('invoke failed')

    await vi.waitFor(() => {
      expect(scheduled.tasks).toHaveLength(1)
    })

    scheduled.tasks[0]?.run()

    await vi.waitFor(() => {
      expect(createServerHost).toHaveBeenCalledTimes(2)
      expect(runtime.getSnapshot()).toEqual({
        sources: [
          {
            serverId: 'mcp-files',
            sourceId: 'mcp:mcp-files',
            toolCount: 1,
            isActive: true,
            runtimeState: 'error',
            runtimeMessage: 'MCP SDK package is not installed in the desktop main process runtime.',
            reconnectAttempt: 1,
            maxReconnectAttempts: 3,
            lastCheckedAt: expect.any(Number)
          }
        ]
      })
    })

    expect(scheduled.tasks).toHaveLength(1)
  })

  it('exposes reconnect exhaustion metadata in runtime snapshots', async () => {
    const toolRegistry = new ToolRegistry()
    const scheduled = createScheduledTaskQueue()
    const firstHost: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]),
      invokeTool: vi.fn(async () => {
        throw new Error('invoke failed')
      }),
      close: vi.fn()
    }
    const createServerHost = vi
      .fn<() => Promise<McpRuntimeServerHost>>()
      .mockResolvedValueOnce(firstHost)
      .mockRejectedValueOnce(new Error('restart failed'))
    const runtime = new McpRuntimeService({
      toolRegistry,
      createServerHost,
      scheduleTask: scheduled.scheduleTask,
      reconnectDelayMs: () => 1,
      maxReconnectAttempts: 1
    })
    const state = createAgentStoreState({
      mcpServers: [activeServer],
      mcpToolsByServerId: {
        'mcp-files': [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]
      }
    })

    runtime.syncFromState(state)
    await runtime.refreshServerTools(state, 'mcp-files', { now: () => 10 })

    await expect(
      runtime.runOperation({
        kind: 'invoke-tool',
        toolId: 'mcp__filesystem__readFile',
        input: { path: '/tmp/demo.txt' }
      })
    ).rejects.toThrow('invoke failed')

    await vi.waitFor(() => {
      expect(scheduled.tasks).toHaveLength(1)
    })

    expect(runtime.getSnapshot()).toEqual({
      sources: [
        {
          serverId: 'mcp-files',
          sourceId: 'mcp:mcp-files',
          toolCount: 1,
          isActive: true,
          runtimeState: 'connecting',
          reconnectAttempt: 1,
          maxReconnectAttempts: 1,
          reconnectDelayMs: 1,
          nextReconnectAt: expect.any(Number),
          lastCheckedAt: expect.any(Number)
        }
      ]
    })

    scheduled.tasks[0]?.run()

    await vi.waitFor(() => {
      expect(runtime.getSnapshot()).toEqual({
        sources: [
          {
            serverId: 'mcp-files',
            sourceId: 'mcp:mcp-files',
            toolCount: 1,
            isActive: true,
            runtimeState: 'error',
            runtimeMessage: 'restart failed',
            reconnectAttempt: 1,
            maxReconnectAttempts: 1,
            reconnectExhausted: true,
            lastCheckedAt: expect.any(Number)
          }
        ]
      })
    })
  })

  it('exposes reconnect lifecycle diagnostics while a retry is scheduled', async () => {
    const toolRegistry = new ToolRegistry()
    const scheduled = createScheduledTaskQueue()
    const firstHost: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]),
      invokeTool: vi.fn(async () => {
        throw new Error('invoke failed')
      }),
      close: vi.fn()
    }
    const runtime = new McpRuntimeService({
      toolRegistry,
      createServerHost: async () => firstHost,
      scheduleTask: scheduled.scheduleTask,
      reconnectDelayMs: () => 25
    })
    const state = createAgentStoreState({
      mcpServers: [activeServer],
      mcpToolsByServerId: {
        'mcp-files': [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]
      }
    })

    runtime.syncFromState(state)
    await runtime.refreshServerTools(state, 'mcp-files', { now: () => 10 })

    await expect(
      runtime.runOperation({
        kind: 'invoke-tool',
        toolId: 'mcp__filesystem__readFile',
        input: { path: '/tmp/demo.txt' }
      })
    ).rejects.toThrow('invoke failed')

    expect(runtime.getSnapshot({ includeDiagnostics: true })).toEqual({
      sources: [
        {
          serverId: 'mcp-files',
          sourceId: 'mcp:mcp-files',
          toolCount: 1,
          isActive: true,
          runtimeState: 'connecting',
          runtimeMessage: 'invoke failed',
          runtimeErrorKind: 'transient',
          runtimeRetryable: true,
          runtimeLifecycleState: 'reconnect-scheduled',
          reconnectAttempt: 1,
          reconnectDelayMs: 25,
          nextReconnectAt: expect.any(Number),
          lastCheckedAt: expect.any(Number)
        }
      ]
    })
  })

  it('clears reconnect metadata after a successful reconnect', async () => {
    const toolRegistry = new ToolRegistry()
    const scheduled = createScheduledTaskQueue()
    const firstHost: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]),
      invokeTool: vi.fn(async () => {
        throw new Error('invoke failed')
      }),
      close: vi.fn()
    }
    const secondHost: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => [{ id: 'read_file', name: 'read_file', description: 'Recovered read' }]),
      invokeTool: vi.fn(async () => ({ output: { ok: true } })),
      close: vi.fn()
    }
    const createServerHost = vi
      .fn<() => Promise<McpRuntimeServerHost>>()
      .mockResolvedValueOnce(firstHost)
      .mockResolvedValueOnce(secondHost)
    const runtime = new McpRuntimeService({
      toolRegistry,
      createServerHost,
      scheduleTask: scheduled.scheduleTask,
      reconnectDelayMs: () => 1,
      maxReconnectAttempts: 2
    })
    const state = createAgentStoreState({
      mcpServers: [activeServer],
      mcpToolsByServerId: {
        'mcp-files': [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]
      }
    })

    runtime.syncFromState(state)
    await runtime.refreshServerTools(state, 'mcp-files', { now: () => 10 })

    await expect(
      runtime.runOperation({
        kind: 'invoke-tool',
        toolId: 'mcp__filesystem__readFile',
        input: { path: '/tmp/demo.txt' }
      })
    ).rejects.toThrow('invoke failed')

    await vi.waitFor(() => {
      expect(scheduled.tasks).toHaveLength(1)
    })

    scheduled.tasks[0]?.run()

    await vi.waitFor(() => {
      expect(runtime.getSnapshot()).toEqual({
        sources: [
          {
            serverId: 'mcp-files',
            sourceId: 'mcp:mcp-files',
            toolCount: 1,
            isActive: true,
            runtimeState: 'connected',
            lastCheckedAt: expect.any(Number)
          }
        ]
      })
    })
  })

  it('exposes reconnect backoff timing while a retry is scheduled', async () => {
    const toolRegistry = new ToolRegistry()
    const scheduled = createScheduledTaskQueue()
    const firstHost: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]),
      invokeTool: vi.fn(async () => {
        throw new Error('invoke failed')
      }),
      close: vi.fn()
    }
    const secondHost: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => [{ id: 'read_file', name: 'read_file', description: 'Recovered read' }]),
      invokeTool: vi.fn(async () => ({ output: { ok: true } })),
      close: vi.fn()
    }
    const createServerHost = vi
      .fn<() => Promise<McpRuntimeServerHost>>()
      .mockResolvedValueOnce(firstHost)
      .mockResolvedValueOnce(secondHost)
    const runtime = new McpRuntimeService({
      toolRegistry,
      createServerHost,
      scheduleTask: scheduled.scheduleTask,
      reconnectDelayMs: (_serverId, attempt) => attempt * 25,
      maxReconnectAttempts: 2
    })
    const state = createAgentStoreState({
      mcpServers: [activeServer],
      mcpToolsByServerId: {
        'mcp-files': [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]
      }
    })

    runtime.syncFromState(state)
    await runtime.refreshServerTools(state, 'mcp-files', { now: () => 10 })

    await expect(
      runtime.runOperation({
        kind: 'invoke-tool',
        toolId: 'mcp__filesystem__readFile',
        input: { path: '/tmp/demo.txt' }
      })
    ).rejects.toThrow('invoke failed')

    await vi.waitFor(() => {
      expect(scheduled.tasks).toHaveLength(1)
    })

    const snapshot = runtime.getSnapshot()
    expect(snapshot.sources).toEqual([
      {
        serverId: 'mcp-files',
        sourceId: 'mcp:mcp-files',
        toolCount: 1,
        isActive: true,
        runtimeState: 'connecting',
        reconnectAttempt: 1,
        maxReconnectAttempts: 2,
        reconnectDelayMs: 25,
        nextReconnectAt: expect.any(Number),
        lastCheckedAt: expect.any(Number)
      }
    ])
    expect(snapshot.sources[0]?.nextReconnectAt).toBeGreaterThanOrEqual(snapshot.sources[0]?.lastCheckedAt ?? 0)
    expect(scheduled.tasks[0]).toMatchObject({ delayMs: 25, cancelled: false })

    scheduled.tasks[0]?.run()

    await vi.waitFor(() => {
      expect(runtime.getSnapshot()).toEqual({
        sources: [
          {
            serverId: 'mcp-files',
            sourceId: 'mcp:mcp-files',
            toolCount: 1,
            isActive: true,
            runtimeState: 'connected',
            lastCheckedAt: expect.any(Number)
          }
        ]
      })
    })
  })

  it('can restart an active MCP server immediately and cancel a pending reconnect', async () => {
    const toolRegistry = new ToolRegistry()
    const scheduled = createScheduledTaskQueue()
    const firstHost: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]),
      invokeTool: vi.fn(async () => {
        throw new Error('invoke failed')
      }),
      close: vi.fn()
    }
    const restartedHost: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => [{ id: 'write_file', name: 'write_file', description: 'Write after restart' }]),
      invokeTool: vi.fn(async () => ({ output: { ok: true } })),
      close: vi.fn()
    }
    const createServerHost = vi
      .fn(async (_server: McpServerEntity) => restartedHost)
      .mockResolvedValueOnce(firstHost)
      .mockResolvedValueOnce(restartedHost)
    const runtime = new McpRuntimeService({
      toolRegistry,
      createServerHost,
      scheduleTask: scheduled.scheduleTask,
      reconnectDelayMs: () => 50
    })
    const state = createAgentStoreState({
      mcpServers: [activeServer],
      mcpToolsByServerId: {
        'mcp-files': [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]
      }
    })

    runtime.syncFromState(state)
    await runtime.refreshServerTools(state, 'mcp-files', { now: () => 10 })

    await expect(
      runtime.runOperation({
        kind: 'invoke-tool',
        toolId: 'mcp__filesystem__readFile',
        input: { path: '/tmp/demo.txt' }
      })
    ).rejects.toThrow('invoke failed')

    await vi.waitFor(() => {
      expect(scheduled.tasks).toHaveLength(1)
    })

    await expect(
      runtime.runOperation({
        kind: 'restart-server',
        serverId: 'mcp-files'
      })
    ).resolves.toEqual({
      kind: 'restart-server',
      tools: [
        {
          id: 'write_file',
          name: 'write_file',
          description: 'Write after restart',
          inputSchema: undefined
        }
      ]
    })

    expect(scheduled.tasks[0]?.cancelled).toBe(true)
    expect(firstHost.close).toHaveBeenCalledTimes(1)
    expect(restartedHost.discoverTools).toHaveBeenCalledTimes(1)
    expect(createServerHost).toHaveBeenCalledTimes(2)
    expect(toolRegistry.listBySource('mcp:mcp-files')).toEqual([
      {
        id: 'mcp__filesystem__writeFile',
        name: 'write_file',
        description: 'Write after restart',
        origin: 'mcp',
        approval: 'auto',
        sourceId: 'mcp-files',
        sourceName: 'Filesystem'
      }
    ])
    expect(runtime.getSnapshot()).toEqual({
      sources: [
        {
          serverId: 'mcp-files',
          sourceId: 'mcp:mcp-files',
          toolCount: 1,
          isActive: true,
          runtimeState: 'connected',
          lastCheckedAt: expect.any(Number)
        }
      ]
    })
  })

  it('does not close a rebuilt host when a stale pre-restart operation fails later', async () => {
    const toolRegistry = new ToolRegistry()
    const deferredInvoke = createDeferred<{ output: string }>()
    const firstHost: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]),
      invokeTool: vi.fn(async () => deferredInvoke.promise),
      close: vi.fn()
    }
    const restartedHost: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => [{ id: 'write_file', name: 'write_file', description: 'Write after restart' }]),
      invokeTool: vi.fn(async () => ({ output: 'ok-after-restart' })),
      close: vi.fn()
    }
    const createServerHost = vi
      .fn<() => Promise<McpRuntimeServerHost>>()
      .mockResolvedValueOnce(firstHost)
      .mockResolvedValueOnce(restartedHost)
    const runtime = new McpRuntimeService({
      toolRegistry,
      createServerHost
    })
    const state = createAgentStoreState({
      mcpServers: [activeServer],
      mcpToolsByServerId: {
        'mcp-files': [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]
      }
    })

    runtime.syncFromState(state)
    await runtime.refreshServerTools(state, 'mcp-files', { now: () => 10 })

    const staleOperation = runtime.runOperation({
      kind: 'invoke-tool',
      toolId: 'mcp__filesystem__readFile',
      input: { path: '/tmp/before-restart.txt' },
      sessionId: 'session-1'
    })

    await Promise.resolve()

    await expect(
      runtime.runOperation({
        kind: 'restart-server',
        serverId: 'mcp-files'
      })
    ).resolves.toEqual({
      kind: 'restart-server',
      tools: [
        {
          id: 'write_file',
          name: 'write_file',
          description: 'Write after restart',
          inputSchema: undefined
        }
      ]
    })

    deferredInvoke.reject(new Error('late failure from stale host'))

    await expect(staleOperation).rejects.toThrow('late failure from stale host')

    expect(firstHost.close).toHaveBeenCalledTimes(1)
    expect(restartedHost.close).not.toHaveBeenCalled()
    expect(runtime.getSnapshot()).toEqual({
      sources: [
        {
          serverId: 'mcp-files',
          sourceId: 'mcp:mcp-files',
          toolCount: 1,
          isActive: true,
          runtimeState: 'connected',
          lastCheckedAt: expect.any(Number)
        }
      ]
    })
  })

  it('clears resolved MCP session context when a broken host is rebuilt after a runtime operation failure', async () => {
    const toolRegistry = new ToolRegistry()
    const scheduled = createScheduledTaskQueue()
    const firstHost: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]),
      invokeTool: vi
        .fn<
          (input: McpRuntimeServerToolCall) => Promise<
            | { output: { sessionContext?: string | null }; sessionContext?: string }
            | never
          >
        >()
        .mockImplementationOnce(async (input) => ({
          output: { sessionContext: typeof input.sessionContext === 'string' ? input.sessionContext : null },
          sessionContext: 'mcp-session-a'
        }))
        .mockImplementationOnce(async () => {
          throw new Error('invoke failed')
        }),
      close: vi.fn()
    }
    const secondHost: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]),
      invokeTool: vi.fn(async (input: McpRuntimeServerToolCall) => ({
        output: { sessionContext: typeof input.sessionContext === 'string' ? input.sessionContext : null }
      })),
      close: vi.fn()
    }
    const createServerHost = vi
      .fn<() => Promise<McpRuntimeServerHost>>()
      .mockResolvedValueOnce(firstHost)
      .mockResolvedValueOnce(secondHost)
    const runtime = new McpRuntimeService({
      toolRegistry,
      createServerHost,
      scheduleTask: scheduled.scheduleTask,
      reconnectDelayMs: () => 1
    })
    const state = createAgentStoreState({
      mcpServers: [activeServer],
      mcpToolsByServerId: {
        'mcp-files': [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]
      }
    })

    runtime.syncFromState(state)
    await runtime.refreshServerTools(state, 'mcp-files', { now: () => 10 })

    await runtime.runOperation({
      kind: 'invoke-tool',
      toolId: 'mcp__filesystem__readFile',
      input: { path: '/tmp/seed.txt' },
      sessionId: 'session-1'
    })

    await expect(
      runtime.runOperation({
        kind: 'invoke-tool',
        toolId: 'mcp__filesystem__readFile',
        input: { path: '/tmp/fail.txt' },
        sessionId: 'session-1'
      })
    ).rejects.toThrow('invoke failed')

    await vi.waitFor(() => {
      expect(firstHost.close).toHaveBeenCalledTimes(1)
      expect(scheduled.tasks).toHaveLength(1)
    })

    scheduled.tasks[0]?.run()

    await vi.waitFor(() => {
      expect(secondHost.discoverTools).toHaveBeenCalledTimes(1)
    })

    await runtime.runOperation({
      kind: 'invoke-tool',
      toolId: 'mcp__filesystem__readFile',
      input: { path: '/tmp/after-rebuild.txt' },
      sessionId: 'session-1'
    })

    expect(secondHost.invokeTool).toHaveBeenCalledWith({
      toolName: 'read_file',
      input: { path: '/tmp/after-rebuild.txt' },
      sessionId: 'session-1',
      signal: undefined
    })
  })

  it('closes pending hosts during dispose once the in-flight creation resolves', async () => {
    const toolRegistry = new ToolRegistry()
    const deferredHost = createDeferred<McpRuntimeServerHost>()
    const host: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => []),
      invokeTool: vi.fn(async () => ({ output: { ok: true } })),
      close: vi.fn()
    }
    const createServerHost = vi.fn(async () => deferredHost.promise)
    const runtime = new McpRuntimeService({ toolRegistry, createServerHost })
    const state = createAgentStoreState({ mcpServers: [activeServer] })

    runtime.syncFromState(state)
    const operation = runtime.runOperation({
      kind: 'discover-tools',
      serverId: 'mcp-files'
    })

    await Promise.resolve()

    const disposePromise = runtime.dispose()
    deferredHost.resolve(host)

    await Promise.all([disposePromise, operation])

    expect(host.close).toHaveBeenCalledTimes(1)
  })

  it('can invoke, inspect, and search MCP tools through the resolved runtime host', async () => {
    const toolRegistry = new ToolRegistry()
    const host: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => [
        { id: 'read_file', name: 'read_file', description: 'Read a file' },
        { id: 'search_file', name: 'search_file', description: 'Search files' }
      ]),
      invokeTool: vi.fn(async ({ toolName, input, sessionId }) => ({
        output: { toolName, input, sessionId }
      })),
      inspectTool: vi.fn(async (toolName) =>
        toolName === 'read_file' ? { id: 'read_file', name: 'read_file', description: 'Read a file' } : null
      ),
      searchTools: vi.fn(async (query) =>
        query.includes('search')
          ? [{ id: 'search_file', name: 'search_file', description: 'Search files' }]
          : []
      ),
      close: vi.fn()
    }
    const runtime = new McpRuntimeService({
      toolRegistry,
      createServerHost: async () => host
    })
    const state = createAgentStoreState({
      mcpServers: [activeServer],
      mcpToolsByServerId: {
        'mcp-files': [
          { id: 'read_file', name: 'read_file', description: 'Read a file' },
          { id: 'search_file', name: 'search_file', description: 'Search files' }
        ]
      }
    })

    runtime.syncFromState(state)
    await runtime.refreshServerTools(state, 'mcp-files', { now: () => 50 })

    await expect(
      runtime.runOperation({
        kind: 'invoke-tool',
        toolId: 'mcp__filesystem__readFile',
        input: { path: '/tmp/demo.txt' },
        sessionId: 'session-1'
      })
    ).resolves.toEqual({
      kind: 'invoke-tool',
      result: {
        output: {
          toolName: 'read_file',
          input: { path: '/tmp/demo.txt' },
          sessionId: 'session-1'
        }
      }
    })

    await expect(
      runtime.runOperation({
        kind: 'inspect-tool',
        serverId: 'mcp-files',
        toolName: 'read_file'
      })
    ).resolves.toEqual({
      kind: 'inspect-tool',
      tool: {
        id: 'read_file',
        name: 'read_file',
        description: 'Read a file',
        inputSchema: undefined
      }
    })

    await expect(
      runtime.runOperation({
        kind: 'search-tools',
        serverId: 'mcp-files',
        query: 'search'
      })
    ).resolves.toEqual({
      kind: 'search-tools',
      tools: [
        {
          id: 'search_file',
          name: 'search_file',
          description: 'Search files',
          inputSchema: undefined
        }
      ]
    })

    expect(host.invokeTool).toHaveBeenCalledWith({
      toolName: 'read_file',
      input: { path: '/tmp/demo.txt' },
      sessionId: 'session-1',
      signal: undefined
    })
    expect(host.inspectTool).toHaveBeenCalledWith('read_file')
    expect(host.searchTools).toHaveBeenCalledWith('search')
  })

  it('does not mark the server errored or schedule reconnect when invoke-tool is aborted by the caller', async () => {
    const toolRegistry = new ToolRegistry()
    const scheduled = createScheduledTaskQueue()
    const abortError = Object.assign(new Error('This operation was aborted'), {
      name: 'AbortError'
    })
    const host: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]),
      invokeTool: vi.fn(async () => {
        throw abortError
      }),
      close: vi.fn()
    }
    const runtime = new McpRuntimeService({
      toolRegistry,
      createServerHost: async () => host,
      scheduleTask: scheduled.scheduleTask,
      reconnectDelayMs: () => 25
    })
    const state = createAgentStoreState({
      mcpServers: [activeServer],
      mcpToolsByServerId: {
        'mcp-files': [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]
      }
    })

    runtime.syncFromState(state)
    await runtime.refreshServerTools(state, 'mcp-files', { now: () => 50 })

    await expect(
      runtime.runOperation({
        kind: 'invoke-tool',
        toolId: 'mcp__filesystem__readFile',
        input: { path: '/tmp/demo.txt' },
        sessionId: 'session-1',
        signal: new AbortController().signal
      })
    ).rejects.toThrow('This operation was aborted')

    expect(host.close).not.toHaveBeenCalled()
    expect(scheduled.tasks).toHaveLength(0)
    expect(runtime.getSnapshot()).toEqual({
      sources: [
        {
          serverId: 'mcp-files',
          sourceId: 'mcp:mcp-files',
          toolCount: 1,
          isActive: true,
          runtimeState: 'connected',
          lastCheckedAt: expect.any(Number)
        }
      ]
    })
  })

  it('reuses resolved MCP session context per server and platform session while isolating other sessions', async () => {
    const toolRegistry = new ToolRegistry()
    const invokeTool = vi
      .fn<
        (input: McpRuntimeServerToolCall) => Promise<{
          output: { sessionId?: string; sessionContext?: string | null }
          sessionContext?: string | null
        }>
      >()
      .mockImplementationOnce(async ({ sessionId, sessionContext }) => ({
        output: { sessionId, sessionContext: typeof sessionContext === 'string' ? sessionContext : null },
        sessionContext: 'mcp-session-a'
      }))
      .mockImplementationOnce(async ({ sessionId, sessionContext }) => ({
        output: { sessionId, sessionContext: typeof sessionContext === 'string' ? sessionContext : null }
      }))
      .mockImplementationOnce(async ({ sessionId, sessionContext }) => ({
        output: { sessionId, sessionContext: typeof sessionContext === 'string' ? sessionContext : null },
        sessionContext: 'mcp-session-b'
      }))
      .mockImplementationOnce(async ({ sessionId, sessionContext }) => ({
        output: { sessionId, sessionContext: typeof sessionContext === 'string' ? sessionContext : null }
      }))
    const host: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]),
      invokeTool,
      close: vi.fn()
    }
    const runtime = new McpRuntimeService({
      toolRegistry,
      createServerHost: async () => host
    })
    const state = createAgentStoreState({
      mcpServers: [activeServer],
      mcpToolsByServerId: {
        'mcp-files': [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]
      }
    })

    runtime.syncFromState(state)
    await runtime.refreshServerTools(state, 'mcp-files', { now: () => 80 })

    await expect(
      runtime.runOperation({
        kind: 'invoke-tool',
        toolId: 'mcp__filesystem__readFile',
        input: { path: '/tmp/one.txt' },
        sessionId: 'session-1'
      })
    ).resolves.toEqual({
      kind: 'invoke-tool',
      result: {
        output: {
          sessionId: 'session-1',
          sessionContext: null
        },
        sessionContext: 'mcp-session-a'
      }
    })

    await expect(
      runtime.runOperation({
        kind: 'invoke-tool',
        toolId: 'mcp__filesystem__readFile',
        input: { path: '/tmp/two.txt' },
        sessionId: 'session-1'
      })
    ).resolves.toEqual({
      kind: 'invoke-tool',
      result: {
        output: {
          sessionId: 'session-1',
          sessionContext: 'mcp-session-a'
        }
      }
    })

    await expect(
      runtime.runOperation({
        kind: 'invoke-tool',
        toolId: 'mcp__filesystem__readFile',
        input: { path: '/tmp/three.txt' },
        sessionId: 'session-2'
      })
    ).resolves.toEqual({
      kind: 'invoke-tool',
      result: {
        output: {
          sessionId: 'session-2',
          sessionContext: null
        },
        sessionContext: 'mcp-session-b'
      }
    })

    await expect(
      runtime.runOperation({
        kind: 'invoke-tool',
        toolId: 'mcp__filesystem__readFile',
        input: { path: '/tmp/four.txt' },
        sessionId: 'session-1'
      })
    ).resolves.toEqual({
      kind: 'invoke-tool',
      result: {
        output: {
          sessionId: 'session-1',
          sessionContext: 'mcp-session-a'
        }
      }
    })

    expect(invokeTool.mock.calls).toEqual([
      [
        {
          toolName: 'read_file',
          input: { path: '/tmp/one.txt' },
          sessionId: 'session-1',
          signal: undefined
        }
      ],
      [
        {
          toolName: 'read_file',
          input: { path: '/tmp/two.txt' },
          sessionId: 'session-1',
          sessionContext: 'mcp-session-a',
          signal: undefined
        }
      ],
      [
        {
          toolName: 'read_file',
          input: { path: '/tmp/three.txt' },
          sessionId: 'session-2',
          signal: undefined
        }
      ],
      [
        {
          toolName: 'read_file',
          input: { path: '/tmp/four.txt' },
          sessionId: 'session-1',
          sessionContext: 'mcp-session-a',
          signal: undefined
        }
      ]
    ])
  })

  it('clears resolved MCP session context when the host is rebuilt after server config changes', async () => {
    const toolRegistry = new ToolRegistry()
    const scheduled = createScheduledTaskQueue()
    const firstHost: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]),
      invokeTool: vi.fn(async () => ({
        output: { ok: 'first-host' },
        sessionContext: 'mcp-session-a'
      })),
      close: vi.fn()
    }
    const secondHost: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]),
      invokeTool: vi.fn(async ({ sessionId, sessionContext }) => ({
        output: { sessionId, sessionContext: sessionContext ?? null }
      })),
      close: vi.fn()
    }
    const createServerHost = vi
      .fn<() => Promise<McpRuntimeServerHost>>()
      .mockResolvedValueOnce(firstHost)
      .mockResolvedValueOnce(secondHost)
    const runtime = new McpRuntimeService({
      toolRegistry,
      createServerHost,
      scheduleTask: scheduled.scheduleTask,
      reconnectDelayMs: () => 1
    })

    const initial = createAgentStoreState({
      mcpServers: [activeServer],
      mcpToolsByServerId: {
        'mcp-files': [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]
      }
    })
    runtime.syncFromState(initial)
    await runtime.refreshServerTools(initial, 'mcp-files', { now: () => 90 })

    await runtime.runOperation({
      kind: 'invoke-tool',
      toolId: 'mcp__filesystem__readFile',
      input: { path: '/tmp/seed.txt' },
      sessionId: 'session-1'
    })

    const changedState = createAgentStoreState({
      mcpServers: [{ ...activeServer, args: ['--rebuilt'] }],
      mcpToolsByServerId: {
        'mcp-files': [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]
      },
      mcpRuntimeStatusByServerId: {
        'mcp-files': { state: 'connected', lastCheckedAt: 90 }
      }
    })
    runtime.syncFromState(changedState)

    await vi.waitFor(() => {
      expect(firstHost.close).toHaveBeenCalledTimes(1)
      expect(scheduled.tasks).toHaveLength(1)
    })

    scheduled.tasks[0]?.run()

    await vi.waitFor(() => {
      expect(secondHost.discoverTools).toHaveBeenCalledTimes(1)
    })

    await runtime.runOperation({
      kind: 'invoke-tool',
      toolId: 'mcp__filesystem__readFile',
      input: { path: '/tmp/after-rebuild.txt' },
      sessionId: 'session-1'
    })

    expect(secondHost.invokeTool).toHaveBeenCalledWith({
      toolName: 'read_file',
      input: { path: '/tmp/after-rebuild.txt' },
      sessionId: 'session-1',
      signal: undefined
    })
  })

  it('reports runtime errors when a tool operation targets an unknown or unsupported host/tool', async () => {
    const toolRegistry = new ToolRegistry()
    const host: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => [{ name: 'read_file' }]),
      invokeTool: vi.fn(async () => ({ output: 'ok' })),
      close: vi.fn()
    }
    const runtime = new McpRuntimeService({
      toolRegistry,
      createServerHost: async () => host
    })
    const state = createAgentStoreState({ mcpServers: [activeServer] })
    runtime.syncFromState(state)
    await runtime.refreshServerTools(state, 'mcp-files', { now: () => 70 })

    await expect(
      runtime.runOperation({
        kind: 'invoke-tool',
        toolId: 'mcp__unknown__readFile'
      })
    ).rejects.toThrow('No MCP server matches tool "mcp__unknown__readFile".')

    await expect(
      runtime.runOperation({
        kind: 'inspect-tool',
        serverId: 'mcp-files',
        toolName: 'missing'
      })
    ).rejects.toThrow('MCP runtime host for server "mcp-files" does not support inspect-tool.')
  })

  it('subscribes to live tool-change notifications from connected hosts and updates runtime snapshot', async () => {
    const toolRegistry = new ToolRegistry()
    let emitChange:
      | ((event: { tools?: ReadonlyArray<{ id?: string; name: string; description?: string }>; error?: unknown }) => void)
      | undefined
    const host: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]),
      invokeTool: vi.fn(async () => ({ output: 'ok' })),
      subscribeToToolChanges: vi.fn((listener) => {
        emitChange = listener
        return () => {
          emitChange = undefined
        }
      }),
      close: vi.fn()
    }
    const runtime = new McpRuntimeService({
      toolRegistry,
      createServerHost: async () => host
    })
    const state = createAgentStoreState({ mcpServers: [activeServer] })

    runtime.syncFromState(state)
    await runtime.refreshServerTools(state, 'mcp-files', { now: () => 10 })

    emitChange?.({
      tools: [{ id: 'write_file', name: 'write_file', description: 'Write a file' }]
    })

    expect(toolRegistry.listBySource('mcp:mcp-files')).toEqual([
      {
        id: 'mcp__filesystem__writeFile',
        name: 'write_file',
        description: 'Write a file',
        origin: 'mcp',
        approval: 'auto',
        sourceId: 'mcp-files',
        sourceName: 'Filesystem'
      }
    ])
    expect(runtime.getSnapshot()).toEqual({
      sources: [
        {
          serverId: 'mcp-files',
          sourceId: 'mcp:mcp-files',
          toolCount: 1,
          isActive: true,
          runtimeState: 'connected',
          lastCheckedAt: 10
        }
      ]
    })
  })

  it('marks the server errored and closes the host when a live tool-change notification reports an error', async () => {
    const toolRegistry = new ToolRegistry()
    let emitChange:
      | ((event: { tools?: ReadonlyArray<{ id?: string; name: string; description?: string }>; error?: unknown }) => void)
      | undefined
    const host: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]),
      invokeTool: vi.fn(async () => ({ output: 'ok' })),
      subscribeToToolChanges: vi.fn((listener) => {
        emitChange = listener
        return () => {
          emitChange = undefined
        }
      }),
      close: vi.fn()
    }
    const runtime = new McpRuntimeService({
      toolRegistry,
      createServerHost: async () => host
    })
    const state = createAgentStoreState({ mcpServers: [activeServer] })

    runtime.syncFromState(state)
    await runtime.refreshServerTools(state, 'mcp-files', { now: () => 10 })

    emitChange?.({
      error: new Error('tool stream disconnected')
    })

    expect(host.close).toHaveBeenCalledTimes(1)
    expect(runtime.getSnapshot().sources).toHaveLength(1)
    expect(runtime.getSnapshot().sources[0]).toMatchObject({
      serverId: 'mcp-files',
      sourceId: 'mcp:mcp-files',
      toolCount: 1,
      isActive: true,
      runtimeState: 'error',
      runtimeMessage: 'tool stream disconnected'
    })
    expect(runtime.getSnapshot().sources[0]?.lastCheckedAt).toBeGreaterThanOrEqual(10)
  })

  it('schedules a reconnect after a live host error and reports connecting until the retry succeeds', async () => {
    const toolRegistry = new ToolRegistry()
    const scheduled = createScheduledTaskQueue()
    let emitChange:
      | ((event: { tools?: ReadonlyArray<{ id?: string; name: string; description?: string }>; error?: unknown }) => void)
      | undefined
    const firstHost: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]),
      invokeTool: vi.fn(async () => ({ output: 'ok' })),
      subscribeToToolChanges: vi.fn((listener) => {
        emitChange = listener
        return () => {
          emitChange = undefined
        }
      }),
      close: vi.fn()
    }
    const secondHost: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => [{ id: 'write_file', name: 'write_file', description: 'Write a file' }]),
      invokeTool: vi.fn(async () => ({ output: 'ok' })),
      close: vi.fn()
    }
    const createServerHost = vi
      .fn<() => Promise<McpRuntimeServerHost>>()
      .mockResolvedValueOnce(firstHost)
      .mockResolvedValueOnce(secondHost)
    const onServerToolsChanged = vi.fn(async () => undefined)
    const runtime = new McpRuntimeService({
      toolRegistry,
      createServerHost,
      onServerToolsChanged,
      scheduleTask: scheduled.scheduleTask,
      reconnectDelayMs: () => 250
    })
    const state = createAgentStoreState({ mcpServers: [activeServer] })

    runtime.syncFromState(state)
    await runtime.refreshServerTools(state, 'mcp-files', { now: () => 10 })

    emitChange?.({
      error: new Error('tool stream disconnected')
    })

    await vi.waitFor(() => {
      expect(firstHost.close).toHaveBeenCalledTimes(1)
      expect(scheduled.tasks).toHaveLength(1)
    })
    expect(scheduled.tasks[0]).toMatchObject({ delayMs: 250, cancelled: false })
    expect(runtime.getSnapshot()).toEqual({
      sources: [
        {
          serverId: 'mcp-files',
          sourceId: 'mcp:mcp-files',
          toolCount: 1,
          isActive: true,
          runtimeState: 'connecting',
          reconnectAttempt: 1,
          reconnectDelayMs: 250,
          nextReconnectAt: expect.any(Number),
          lastCheckedAt: expect.any(Number)
        }
      ]
    })

    scheduled.tasks[0]?.run()

    await vi.waitFor(() => {
      expect(secondHost.discoverTools).toHaveBeenCalledTimes(1)
    })

    expect(createServerHost).toHaveBeenCalledTimes(2)
    expect(toolRegistry.listBySource('mcp:mcp-files')).toEqual([
      {
        id: 'mcp__filesystem__writeFile',
        name: 'write_file',
        description: 'Write a file',
        origin: 'mcp',
        approval: 'auto',
        sourceId: 'mcp-files',
        sourceName: 'Filesystem'
      }
    ])
    expect(runtime.getSnapshot()).toEqual({
      sources: [
        {
          serverId: 'mcp-files',
          sourceId: 'mcp:mcp-files',
          toolCount: 1,
          isActive: true,
          runtimeState: 'connected',
          lastCheckedAt: expect.any(Number)
        }
      ]
    })
    expect(onServerToolsChanged).toHaveBeenCalledTimes(1)
  })

  it('rebuilds reconnect attempts against the latest server signature instead of leaking stale config', async () => {
    const toolRegistry = new ToolRegistry()
    const scheduled = createScheduledTaskQueue()
    let emitChange:
      | ((event: { tools?: ReadonlyArray<{ id?: string; name: string; description?: string }>; error?: unknown }) => void)
      | undefined
    const firstHost: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]),
      invokeTool: vi.fn(async () => ({ output: 'ok' })),
      subscribeToToolChanges: vi.fn((listener) => {
        emitChange = listener
        return () => {
          emitChange = undefined
        }
      }),
      close: vi.fn()
    }
    const rebuiltHost: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => [{ id: 'write_file', name: 'write_file', description: 'Write a file' }]),
      invokeTool: vi.fn(async () => ({ output: 'ok' })),
      close: vi.fn()
    }
    const createServerHost = vi
      .fn(async (_server: McpServerEntity) => rebuiltHost)
      .mockResolvedValueOnce(firstHost)
      .mockResolvedValueOnce(rebuiltHost)
    const runtime = new McpRuntimeService({
      toolRegistry,
      createServerHost,
      scheduleTask: scheduled.scheduleTask,
      reconnectDelayMs: () => 1
    })
    const initialState = createAgentStoreState({ mcpServers: [activeServer] })

    runtime.syncFromState(initialState)
    await runtime.refreshServerTools(initialState, 'mcp-files', { now: () => 10 })

    emitChange?.({
      error: new Error('tool stream disconnected')
    })

    const changedState = createAgentStoreState({
      mcpServers: [{ ...activeServer, args: ['--new-config'] }],
      mcpToolsByServerId: {
        'mcp-files': [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]
      },
      mcpRuntimeStatusByServerId: {
        'mcp-files': { state: 'connected', lastCheckedAt: 10 }
      }
    })

    await vi.waitFor(() => {
      expect(scheduled.tasks).toHaveLength(1)
    })

    runtime.syncFromState(changedState)

    scheduled.tasks[0]?.run()

    await vi.waitFor(() => {
      expect(rebuiltHost.discoverTools).toHaveBeenCalledTimes(1)
    })

    expect(createServerHost).toHaveBeenCalledTimes(2)
    const rebuildCall = createServerHost.mock.calls[1] as [McpServerEntity] | undefined
    expect(rebuildCall).toBeDefined()
    expect(rebuildCall?.[0]).toMatchObject({
      id: 'mcp-files',
      args: ['--new-config']
    })
    expect(runtime.getSnapshot()).toEqual({
      sources: [
        {
          serverId: 'mcp-files',
          sourceId: 'mcp:mcp-files',
          toolCount: 1,
          isActive: true,
          runtimeState: 'connected',
          lastCheckedAt: expect.any(Number)
        }
      ]
    })
  })

  it('deduplicates queued live tool-change writebacks for the same server', async () => {
    const toolRegistry = new ToolRegistry()
    let emitChange:
      | ((event: { tools?: ReadonlyArray<{ id?: string; name: string; description?: string }>; error?: unknown }) => void)
      | undefined
    let releaseWriteback!: () => void
    const firstWriteback = new Promise<void>((resolve) => {
      releaseWriteback = resolve
    })
    const onServerToolsChanged = vi
      .fn<(_: string) => Promise<void>>()
      .mockImplementationOnce(async () => firstWriteback)
      .mockResolvedValue(undefined)
    const host: McpRuntimeServerHost = {
      discoverTools: vi.fn(async () => [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]),
      invokeTool: vi.fn(async () => ({ output: 'ok' })),
      subscribeToToolChanges: vi.fn((listener) => {
        emitChange = listener
        return () => {
          emitChange = undefined
        }
      }),
      close: vi.fn()
    }
    const runtime = new McpRuntimeService({
      toolRegistry,
      createServerHost: async () => host,
      onServerToolsChanged
    })
    const state = createAgentStoreState({ mcpServers: [activeServer] })

    runtime.syncFromState(state)
    await runtime.refreshServerTools(state, 'mcp-files', { now: () => 10 })

    emitChange?.({
      tools: [{ id: 'write_file', name: 'write_file', description: 'Write a file' }]
    })
    emitChange?.({
      tools: [{ id: 'delete_file', name: 'delete_file', description: 'Delete a file' }]
    })

    expect(onServerToolsChanged).toHaveBeenCalledTimes(1)

    releaseWriteback()

    await vi.waitFor(() => {
      expect(onServerToolsChanged).toHaveBeenCalledTimes(2)
    })
    expect(onServerToolsChanged).toHaveBeenNthCalledWith(1, 'mcp-files')
    expect(onServerToolsChanged).toHaveBeenNthCalledWith(2, 'mcp-files')
  })
})
