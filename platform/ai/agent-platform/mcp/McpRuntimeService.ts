import type {
  McpRuntimeErrorKind,
  McpRuntimeLifecycleState,
  McpRuntimeState,
  McpRuntimeStatus,
  McpServerEntity
} from '../schemas/mcpServerSchemas'
import type { McpTool, Tool } from '../schemas/toolSchemas'
import type { AgentStoreState } from '../store/agentStore'
import { createMcpTool } from '../tools/agentToolCatalog'
import { isMcpToolNameForServer, parseMcpToolName } from '../tools/mcpToolName'
import { resolveSourceAccess } from '../tools/mcpSourcePolicy'
import { buildMcpToolWireName } from '../tools/toolRules'
import { ToolRegistry } from '../tools/registry'
import { classifyMcpRuntimeError } from './mcpRuntimeError'
import { refreshMcpServerTools, type RefreshMcpServerToolsOptions, type RefreshMcpServerToolsResult } from './mcpToolsRefreshService'
import type {
  McpRuntimeOperation,
  McpRuntimeOperationResult,
  McpRuntimeServerHost,
  McpRuntimeServerToolsChangedEvent,
  McpRuntimeServerHostFactory
} from './mcpRuntimeHost'

export type McpRuntimeSourceSnapshot = {
  serverId: string
  sourceId: string
  toolCount: number
  isActive: boolean
  runtimeState: McpRuntimeState
  runtimeMessage?: string
  runtimeErrorKind?: McpRuntimeErrorKind
  runtimeRetryable?: boolean
  runtimeLifecycleState?: McpRuntimeLifecycleState
  reconnectAttempt?: number
  maxReconnectAttempts?: number
  reconnectExhausted?: boolean
  reconnectDelayMs?: number
  nextReconnectAt?: number
  lastCheckedAt?: number
}

export type McpRuntimeSnapshot = {
  sources: McpRuntimeSourceSnapshot[]
}

type GetMcpRuntimeSnapshotOptions = {
  includeDiagnostics?: boolean
}

type McpRuntimeScheduledTaskHandle = {
  cancel: () => void
}

type CloseServerHostOptions = {
  allowPendingHostResolution?: boolean
}

type McpRuntimeServiceDependencies = {
  toolRegistry: ToolRegistry
  createServerHost?: McpRuntimeServerHostFactory
  onServerToolsChanged?: (serverId: string) => Promise<void> | void
  scheduleTask?: (run: () => void, delayMs: number) => McpRuntimeScheduledTaskHandle
  reconnectDelayMs?: number | ((serverId: string, attempt: number) => number)
  maxReconnectAttempts?: number
}

export class McpRuntimeService {
  private readonly activeSourceIdsByServerId = new Map<string, string>()
  private readonly activeServersByServerId = new Map<string, McpServerEntity>()
  private readonly activeHostsByServerId = new Map<string, { signature: string; host: McpRuntimeServerHost }>()
  private readonly pendingHostsByServerId = new Map<string, { signature: string; promise: Promise<McpRuntimeServerHost> }>()
  private readonly toolSessionContextByServerId = new Map<string, Map<string, unknown>>()
  private readonly disposingPendingServerIds = new Set<string>()
  private readonly hostToolChangeUnsubscribeByServerId = new Map<string, () => void>()
  private readonly hostToolChangeWritebackPromiseByServerId = new Map<string, Promise<void>>()
  private readonly hostToolChangeWritebackQueuedServerIds = new Set<string>()
  private readonly reconnectTaskByServerId = new Map<string, McpRuntimeScheduledTaskHandle>()
  private readonly reconnectAttemptByServerId = new Map<string, number>()
  private readonly reconnectScheduleByServerId = new Map<string, { delayMs: number; nextReconnectAt: number }>()
  private runtimeStatusByServerId = new Map<string, McpRuntimeStatus>()

  constructor(private readonly deps: McpRuntimeServiceDependencies) {}

  syncFromState(state: AgentStoreState): McpRuntimeSnapshot {
    this.runtimeStatusByServerId = mergeRuntimeStatuses(state.mcpRuntimeStatusByServerId, this.runtimeStatusByServerId)

    const nextServerIds = new Set<string>()
    this.activeServersByServerId.clear()

    for (const server of state.mcpServers) {
      const sourceId = buildMcpRuntimeSourceId(server.id)
      nextServerIds.add(server.id)

      if (!server.isActive) {
        this.deps.toolRegistry.unregisterSource(sourceId)
        this.activeSourceIdsByServerId.delete(server.id)
        this.runtimeStatusByServerId.delete(server.id)
        this.toolSessionContextByServerId.delete(server.id)
        this.cancelReconnect(server.id)
        this.reconnectAttemptByServerId.delete(server.id)
        this.reconnectScheduleByServerId.delete(server.id)
        void this.closeServerHost(server.id)
        continue
      }

      this.activeServersByServerId.set(server.id, cloneServer(server))
      this.ensureHostSignature(server)

      const tools: Tool[] = (state.mcpToolsByServerId[server.id] ?? []).flatMap((tool) => {
        const access = resolveSourceAccess(server, tool)
        if (!access.enabled) return []

        return [
          {
            id: buildMcpToolWireName(server.name, tool.name),
            name: tool.name,
            description: tool.description ?? '',
            origin: 'mcp',
            approval: access.approval,
            sourceId: server.id,
            sourceName: server.name
          }
        ] satisfies Tool[]
      })

      this.deps.toolRegistry.registerTools(sourceId, tools)
      this.activeSourceIdsByServerId.set(server.id, sourceId)
    }

    for (const [serverId, sourceId] of [...this.activeSourceIdsByServerId.entries()]) {
      if (nextServerIds.has(serverId)) continue
      this.deps.toolRegistry.unregisterSource(sourceId)
      this.activeSourceIdsByServerId.delete(serverId)
      this.activeServersByServerId.delete(serverId)
      this.runtimeStatusByServerId.delete(serverId)
      this.toolSessionContextByServerId.delete(serverId)
      this.cancelReconnect(serverId)
      this.reconnectAttemptByServerId.delete(serverId)
      this.reconnectScheduleByServerId.delete(serverId)
      void this.closeServerHost(serverId)
    }

    return this.getSnapshot()
  }

  getSnapshot(options: GetMcpRuntimeSnapshotOptions = {}): McpRuntimeSnapshot {
    return this.getSnapshotForServerIds([...this.activeSourceIdsByServerId.keys()], options)
  }

  getSnapshotForServerIds(
    serverIds: readonly string[],
    options: GetMcpRuntimeSnapshotOptions = {}
  ): McpRuntimeSnapshot {
    const allowedServerIds = new Set(serverIds)
    const includeDiagnostics = options.includeDiagnostics === true

    return {
      sources: [...this.activeSourceIdsByServerId.entries()]
        .filter(([serverId]) => allowedServerIds.has(serverId))
        .map(([serverId, sourceId]) => {
          const status = this.getEffectiveRuntimeStatus(serverId)
          const toolCount = this.deps.toolRegistry.listBySource(sourceId).length
          const reconnectState = this.getReconnectSnapshotState(serverId)
          const lifecycleState = this.getRuntimeLifecycleState(serverId, status)

          return {
            serverId,
            sourceId,
            toolCount,
            isActive: true,
            runtimeState: status?.state ?? 'connecting',
            ...((status?.state === 'error' || includeDiagnostics) && status?.message
              ? { runtimeMessage: status.message }
              : {}),
            ...(includeDiagnostics && status?.errorKind ? { runtimeErrorKind: status.errorKind } : {}),
            ...(includeDiagnostics && typeof status?.retryable === 'boolean' ? { runtimeRetryable: status.retryable } : {}),
            ...(includeDiagnostics ? { runtimeLifecycleState: lifecycleState } : {}),
            ...reconnectState,
            ...(status?.lastCheckedAt ? { lastCheckedAt: status.lastCheckedAt } : {})
          } satisfies McpRuntimeSourceSnapshot
        })
        .filter((source) => source.toolCount > 0 || source.runtimeState !== 'connecting')
    }
  }

  async refreshServerTools(
    state: AgentStoreState,
    serverId: string,
    options: Omit<RefreshMcpServerToolsOptions, 'discoverTools'> = {}
  ): Promise<RefreshMcpServerToolsResult> {
    let refreshError: unknown
    const result = await refreshMcpServerTools(state, serverId, {
      ...options,
      throwOnError: false,
      discoverTools: async (server) => {
        try {
          const host = await this.requireServerHost(server)
          return await host.discoverTools()
        } catch (error) {
          refreshError = error
          await this.closeServerHost(server.id)
          throw error
        }
      }
    })
    this.syncFromState(result.state)
    if (refreshError) {
      this.markServerError(serverId, refreshError, options.now)
    }
    if (refreshError && options.throwOnError !== false) {
      throw refreshError
    }
    return result
  }

  async runOperation(operation: McpRuntimeOperation): Promise<McpRuntimeOperationResult> {
    if (operation.kind === 'discover-tools') {
      const host = await this.requireServerHostForOperation(operation.serverId)
      const tools = await this.runServerOperation(operation.serverId, () => host.discoverTools(), { host })
      this.markServerConnected(operation.serverId)
      return {
        kind: 'discover-tools',
        tools: tools.map((tool) => createMcpTool(tool))
      }
    }

    if (operation.kind === 'restart-server') {
      const tools = await this.restartServer(operation.serverId)
      return {
        kind: 'restart-server',
        tools
      }
    }

    if (operation.kind === 'search-tools') {
      const host = await this.requireServerHostForOperation(operation.serverId)
      if (!host.searchTools) {
        throw new Error(`MCP runtime host for server "${operation.serverId}" does not support search-tools.`)
      }

      const tools = await this.runServerOperation(operation.serverId, () => host.searchTools!(operation.query), { host })
      this.markServerConnected(operation.serverId)
      return {
        kind: 'search-tools',
        tools: tools.map((tool) => createMcpTool(tool))
      }
    }

    const resolved = await this.resolveToolReference(operation)
    if (operation.kind === 'inspect-tool') {
      if (!resolved.host.inspectTool) {
        throw new Error(`MCP runtime host for server "${resolved.server.id}" does not support inspect-tool.`)
      }

      const tool = await this.runServerOperation(
        resolved.server.id,
        () => resolved.host.inspectTool!(resolved.toolName),
        { host: resolved.host }
      )
      this.markServerConnected(resolved.server.id)
      return {
        kind: 'inspect-tool',
        tool: tool ? createMcpTool(tool) : null
      }
    }

    const result = await this.runServerOperation(
      resolved.server.id,
      () =>
        resolved.host.invokeTool({
          toolName: resolved.toolName,
          input: operation.input,
          sessionId: operation.sessionId,
          sessionContext: this.getToolSessionContext(resolved.server.id, operation.sessionId),
          signal: operation.signal
        }),
      { host: resolved.host }
    )
    this.updateToolSessionContext(resolved.server.id, operation.sessionId, result.sessionContext)
    this.markServerConnected(resolved.server.id)
    return {
      kind: 'invoke-tool',
      result
    }
  }

  async dispose(): Promise<void> {
    for (const serverId of [...this.reconnectTaskByServerId.keys()]) {
      this.cancelReconnect(serverId)
    }

    const serverIds = new Set<string>([
      ...this.activeHostsByServerId.keys(),
      ...this.pendingHostsByServerId.keys()
    ])
    await Promise.all(
      [...serverIds].map((serverId) => this.closeServerHost(serverId, undefined, { allowPendingHostResolution: true }))
    )
  }

  private ensureHostSignature(server: AgentStoreState['mcpServers'][number]): void {
    const activeHost = this.activeHostsByServerId.get(server.id)
    const nextSignature = buildServerSignature(server)
    if (activeHost && activeHost.signature !== nextSignature) {
      this.toolSessionContextByServerId.delete(server.id)
      void this.closeServerHost(server.id, activeHost.signature)
      this.scheduleReconnect(server.id)
    }

    const pendingHost = this.pendingHostsByServerId.get(server.id)
    if (pendingHost && pendingHost.signature !== nextSignature) {
      this.toolSessionContextByServerId.delete(server.id)
      void this.closeServerHost(server.id, pendingHost.signature)
      this.scheduleReconnect(server.id)
    }
  }

  private async requireServerHostByServerId(serverId: string): Promise<McpRuntimeServerHost> {
    const server = this.activeServersByServerId.get(serverId)
    if (!server) {
      throw new Error(`MCP server "${serverId}" is not active.`)
    }

    return this.requireServerHost(server)
  }

  private async requireServerHost(server: McpServerEntity): Promise<McpRuntimeServerHost> {
    if (!server.isActive) {
      throw new Error(`MCP server "${server.id}" is not active.`)
    }
    const existing = this.activeHostsByServerId.get(server.id)
    if (existing) {
      return existing.host
    }
    const signature = buildServerSignature(server)
    const pending = this.pendingHostsByServerId.get(server.id)
    if (pending && pending.signature === signature) {
      return pending.promise
    }
    if (!this.deps.createServerHost) {
      throw new Error('MCP runtime server host factory is not wired yet.')
    }

    const pendingHostPromise = Promise.resolve(this.deps.createServerHost(cloneServer(server)))
      .then(async (host) => {
        if (this.disposingPendingServerIds.has(server.id)) {
          return host
        }

        const currentServer = this.activeServersByServerId.get(server.id)
        const currentSignature = currentServer ? buildServerSignature(currentServer) : null
        const currentPending = this.pendingHostsByServerId.get(server.id)

        if (!currentServer || !currentServer.isActive || currentSignature !== signature || currentPending?.promise !== pendingHostPromise) {
          await host.close()
          throw new Error(`MCP server "${server.id}" changed while connecting.`)
        }

        this.activeHostsByServerId.set(server.id, {
          signature,
          host
        })
        this.bindHostToolChangeSubscription(server.id, signature, host)
        return host
      })
      .finally(() => {
        const currentPending = this.pendingHostsByServerId.get(server.id)
        if (currentPending?.promise === pendingHostPromise) {
          this.pendingHostsByServerId.delete(server.id)
        }
      })

    this.pendingHostsByServerId.set(server.id, {
      signature,
      promise: pendingHostPromise
    })

    return pendingHostPromise
  }

  private async requireServerHostForOperation(serverId: string): Promise<McpRuntimeServerHost> {
    try {
      return await this.requireServerHostByServerId(serverId)
    } catch (error) {
      const classification = classifyMcpRuntimeError(error)
      this.markServerError(serverId, error)
      if (classification.retryable) {
        this.scheduleReconnect(serverId)
      }
      throw error
    }
  }

  private async runServerOperation<T>(
    serverId: string,
    operation: () => Promise<T>,
    options: { host?: McpRuntimeServerHost } = {}
  ): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      const classification = classifyMcpRuntimeError(error)
      if (classification.kind === 'abort') {
        throw error
      }

      const currentActiveHost = this.activeHostsByServerId.get(serverId)?.host
      const shouldAffectActiveHost =
        options.host == null || currentActiveHost == null || currentActiveHost === options.host

      if (shouldAffectActiveHost) {
        this.markServerError(serverId, error)
        await this.closeServerHost(serverId)
        if (classification.retryable) {
          this.scheduleReconnect(serverId)
        }
      }
      throw error
    }
  }

  private async resolveToolReference(
    operation: Extract<McpRuntimeOperation, { kind: 'inspect-tool' | 'invoke-tool' }>
  ): Promise<{ server: McpServerEntity; host: McpRuntimeServerHost; toolName: string }> {
    if ('serverId' in operation) {
      const server = this.activeServersByServerId.get(operation.serverId)
      if (!server) {
        throw new Error(`MCP server "${operation.serverId}" is not active.`)
      }
      const host = await this.requireServerHostForOperation(operation.serverId)
      return {
        server,
        host,
        toolName: operation.toolName
      }
    }

    const resolved = this.resolveServerAndToolNameByToolId(operation.toolId)
    if (!resolved) {
      throw new Error(`No MCP server matches tool "${operation.toolId}".`)
    }

    return {
      server: resolved.server,
      host: await this.requireServerHostForOperation(resolved.server.id),
      toolName: resolved.toolName
    }
  }

  private resolveServerAndToolNameByToolId(
    toolId: string
  ): { server: McpServerEntity; toolName: string } | null {
    const parts = parseMcpToolName(toolId)
    if (!parts) return null

    for (const [serverId] of this.activeSourceIdsByServerId.entries()) {
      const tools = this.deps.toolRegistry.listBySource(buildMcpRuntimeSourceId(serverId))
      const matchingTool = tools.find((tool) => tool.id === toolId)
      const server = this.activeServersByServerId.get(serverId)
      if (!server) continue
      if (matchingTool) {
        return {
          server,
          toolName: matchingTool.name
        }
      }
    }

    for (const [serverId] of this.activeSourceIdsByServerId.entries()) {
      const server = this.activeServersByServerId.get(serverId)
      if (!server) continue
      const sourceTools = this.deps.toolRegistry.listBySource(buildMcpRuntimeSourceId(serverId))
      if (!isMcpToolNameForServer(server.name, toolId)) continue
      return {
        server,
        toolName: sourceTools.find((tool) => tool.id === toolId)?.name ?? parts.toolPart
      }
    }

    return null
  }

  private async closeServerHost(serverId: string, signature?: string, options: CloseServerHostOptions = {}): Promise<void> {
    const unsubscribe = this.hostToolChangeUnsubscribeByServerId.get(serverId)
    if (unsubscribe && (!signature || this.activeHostsByServerId.get(serverId)?.signature === signature || !this.activeHostsByServerId.has(serverId))) {
      this.hostToolChangeUnsubscribeByServerId.delete(serverId)
      unsubscribe()
    }

    const activeHost = this.activeHostsByServerId.get(serverId)
    if (activeHost && (!signature || activeHost.signature === signature)) {
      this.activeHostsByServerId.delete(serverId)
      this.toolSessionContextByServerId.delete(serverId)
      await activeHost.host.close()
    }

    const pending = this.pendingHostsByServerId.get(serverId)
    if (!pending || (signature && pending.signature !== signature)) return
    this.pendingHostsByServerId.delete(serverId)
    if (options.allowPendingHostResolution) {
      this.disposingPendingServerIds.add(serverId)
    }
    this.hostToolChangeWritebackPromiseByServerId.delete(serverId)
    this.hostToolChangeWritebackQueuedServerIds.delete(serverId)

    try {
      const host = await pending.promise
      const latestActiveHost = this.activeHostsByServerId.get(serverId)
      if (latestActiveHost?.host === host) {
        this.activeHostsByServerId.delete(serverId)
      }
      await host.close()
    } catch {
      // Ignore connect failures while shutting down/rebuilding a host.
    } finally {
      if (options.allowPendingHostResolution) {
        this.disposingPendingServerIds.delete(serverId)
      }
    }
  }

  private getToolSessionContext(serverId: string, sessionId?: string): unknown {
    if (!sessionId) return undefined
    return this.toolSessionContextByServerId.get(serverId)?.get(sessionId)
  }

  private updateToolSessionContext(serverId: string, sessionId: string | undefined, sessionContext: unknown): void {
    if (!sessionId) return
    if (sessionContext == null) return

    const contexts = this.toolSessionContextByServerId.get(serverId) ?? new Map<string, unknown>()
    contexts.set(sessionId, sessionContext)
    this.toolSessionContextByServerId.set(serverId, contexts)
  }

  private markServerConnected(serverId: string, now: () => number = Date.now): void {
    if (!this.activeServersByServerId.has(serverId)) return
    this.cancelReconnect(serverId)
    this.reconnectAttemptByServerId.delete(serverId)
    this.reconnectScheduleByServerId.delete(serverId)
    this.runtimeStatusByServerId.set(serverId, {
      state: 'connected',
      lastCheckedAt: now()
    })
  }

  private markServerConnecting(serverId: string, now: () => number = Date.now): void {
    if (!this.activeServersByServerId.has(serverId)) return
    const previous = this.runtimeStatusByServerId.get(serverId)

    this.runtimeStatusByServerId.set(serverId, {
      ...previous,
      state: 'connecting',
      lifecycleState: 'connecting',
      lastCheckedAt: now()
    })
  }

  private markServerError(serverId: string, error: unknown, now: () => number = Date.now): void {
    if (!this.activeServersByServerId.has(serverId)) return
    const classification = classifyMcpRuntimeError(error)
    this.runtimeStatusByServerId.set(serverId, {
      state: 'error',
      message: errorMessage(error),
      errorKind: classification.kind,
      retryable: classification.retryable,
      lifecycleState: classification.retryable ? 'reconnect-scheduled' : 'terminal-error',
      lastCheckedAt: now()
    })
  }

  private bindHostToolChangeSubscription(serverId: string, signature: string, host: McpRuntimeServerHost): void {
    this.hostToolChangeUnsubscribeByServerId.get(serverId)?.()
    this.hostToolChangeUnsubscribeByServerId.delete(serverId)

    const unsubscribe = host.subscribeToToolChanges?.((event) => {
      void this.handleHostToolChange(serverId, signature, event)
    })

    if (unsubscribe) {
      this.hostToolChangeUnsubscribeByServerId.set(serverId, unsubscribe)
    }
  }

  private async handleHostToolChange(
    serverId: string,
    signature: string,
    event: McpRuntimeServerToolsChangedEvent
  ): Promise<void> {
    const activeHost = this.activeHostsByServerId.get(serverId)
    if (!activeHost || activeHost.signature !== signature) return

    if (event.error) {
      const classification = classifyMcpRuntimeError(event.error)
      this.markServerError(serverId, event.error)
      await this.closeServerHost(serverId, signature)
      if (classification.retryable) {
        this.scheduleReconnect(serverId)
      }
      return
    }

    if (!event.tools) return

    const server = this.activeServersByServerId.get(serverId)
    const sourceId = this.activeSourceIdsByServerId.get(serverId)
    if (!server || !sourceId) return

    const tools: Tool[] = event.tools.flatMap((tool) => {
      const access = resolveSourceAccess(server, tool)
      if (!access.enabled) return []

      return [
        {
          id: buildMcpToolWireName(server.name, tool.name),
          name: tool.name,
          description: tool.description ?? '',
          origin: 'mcp',
          approval: access.approval,
          sourceId: server.id,
          sourceName: server.name
        }
      ] satisfies Tool[]
    })

    this.deps.toolRegistry.registerTools(sourceId, tools)
    this.enqueueHostToolChangeWriteback(serverId)
  }

  private scheduleReconnect(serverId: string): void {
    const server = this.activeServersByServerId.get(serverId)
    if (!server?.isActive) return
    if (this.pendingHostsByServerId.has(serverId) || this.reconnectTaskByServerId.has(serverId)) {
      return
    }

    const attempt = (this.reconnectAttemptByServerId.get(serverId) ?? 0) + 1
    if (isReconnectAttemptLimitExceeded(attempt, this.deps.maxReconnectAttempts)) {
      return
    }
    this.reconnectAttemptByServerId.set(serverId, attempt)
    this.markServerConnecting(serverId)

    const delayMs = resolveReconnectDelayMs(this.deps.reconnectDelayMs, serverId, attempt)
    this.reconnectScheduleByServerId.set(serverId, {
      delayMs,
      nextReconnectAt: Date.now() + delayMs
    })
    const handle = (this.deps.scheduleTask ?? scheduleTaskWithTimeout)(() => {
      this.reconnectTaskByServerId.delete(serverId)
      this.reconnectScheduleByServerId.delete(serverId)
      void this.runReconnect(serverId)
    }, delayMs)

    this.reconnectTaskByServerId.set(serverId, handle)
  }

  private cancelReconnect(serverId: string): void {
    const handle = this.reconnectTaskByServerId.get(serverId)
    if (!handle) return
    this.reconnectTaskByServerId.delete(serverId)
    this.reconnectScheduleByServerId.delete(serverId)
    handle.cancel()
  }

  private async runReconnect(serverId: string): Promise<void> {
    const server = this.activeServersByServerId.get(serverId)
    const sourceId = this.activeSourceIdsByServerId.get(serverId)
    if (!server?.isActive || !sourceId) {
      this.reconnectAttemptByServerId.delete(serverId)
      return
    }

    try {
      const host = await this.requireServerHostForOperation(serverId)
      const discoveredTools = await this.runServerOperation(serverId, () => host.discoverTools(), { host })
      const tools: Tool[] = discoveredTools.flatMap((tool) => {
        const access = resolveSourceAccess(server, tool)
        if (!access.enabled) return []

        return [
          {
            id: buildMcpToolWireName(server.name, tool.name),
            name: tool.name,
            description: tool.description ?? '',
            origin: 'mcp',
            approval: access.approval,
            sourceId: server.id,
            sourceName: server.name
          }
        ] satisfies Tool[]
      })

      this.deps.toolRegistry.registerTools(sourceId, tools)
      this.markServerConnected(serverId)
      this.enqueueHostToolChangeWriteback(serverId)
    } catch (error) {
      const classification = classifyMcpRuntimeError(error)
      if (!this.activeServersByServerId.get(serverId)?.isActive) {
        this.reconnectAttemptByServerId.delete(serverId)
        return
      }

      if (!classification.retryable) {
        return
      }

      if (isReconnectAttemptLimitExceeded(
        (this.reconnectAttemptByServerId.get(serverId) ?? 0) + 1,
        this.deps.maxReconnectAttempts
      )) {
        return
      }

      this.scheduleReconnect(serverId)
    }
  }

  private async restartServer(serverId: string): Promise<McpTool[]> {
    const server = this.activeServersByServerId.get(serverId)
    const sourceId = this.activeSourceIdsByServerId.get(serverId)
    if (!server?.isActive || !sourceId) {
      throw new Error(`MCP server "${serverId}" is not active.`)
    }

    this.cancelReconnect(serverId)
    this.reconnectAttemptByServerId.delete(serverId)
    this.reconnectScheduleByServerId.delete(serverId)
    this.toolSessionContextByServerId.delete(serverId)
    await this.closeServerHost(serverId)
    this.markServerConnecting(serverId)

    try {
      const host = await this.requireServerHostForOperation(serverId)
      const discoveredTools = await this.runServerOperation(serverId, () => host.discoverTools(), { host })
      const tools: Tool[] = discoveredTools.flatMap((tool) => {
        const access = resolveSourceAccess(server, tool)
        if (!access.enabled) return []

        return [
          {
            id: buildMcpToolWireName(server.name, tool.name),
            name: tool.name,
            description: tool.description ?? '',
            origin: 'mcp',
            approval: access.approval,
            sourceId: server.id,
            sourceName: server.name
          }
        ] satisfies Tool[]
      })

      this.deps.toolRegistry.registerTools(sourceId, tools)
      this.markServerConnected(serverId)
      this.enqueueHostToolChangeWriteback(serverId)
      return discoveredTools.map((tool) => createMcpTool(tool))
    } catch (error) {
      const classification = classifyMcpRuntimeError(error)
      this.markServerError(serverId, error)
      if (classification.retryable) {
        this.scheduleReconnect(serverId)
      }
      throw error
    }
  }

  private enqueueHostToolChangeWriteback(serverId: string): void {
    if (!this.deps.onServerToolsChanged) return
    if (this.hostToolChangeWritebackPromiseByServerId.has(serverId)) {
      this.hostToolChangeWritebackQueuedServerIds.add(serverId)
      return
    }

    const run = async (): Promise<void> => {
      try {
        await this.deps.onServerToolsChanged?.(serverId)
      } finally {
        if (this.hostToolChangeWritebackQueuedServerIds.has(serverId)) {
          this.hostToolChangeWritebackQueuedServerIds.delete(serverId)
          this.hostToolChangeWritebackPromiseByServerId.set(serverId, run())
          return
        }
        this.hostToolChangeWritebackPromiseByServerId.delete(serverId)
      }
    }

    this.hostToolChangeWritebackPromiseByServerId.set(serverId, run())
  }

  private getEffectiveRuntimeStatus(serverId: string): McpRuntimeStatus | undefined {
    const persistedOrRuntimeStatus = this.runtimeStatusByServerId.get(serverId)
    if (!persistedOrRuntimeStatus) return undefined

    if (this.reconnectTaskByServerId.has(serverId) || this.pendingHostsByServerId.has(serverId)) {
      return {
        ...persistedOrRuntimeStatus,
        state: 'connecting',
        lastCheckedAt: persistedOrRuntimeStatus.lastCheckedAt
      }
    }

    if (persistedOrRuntimeStatus.state === 'connected' && !this.activeHostsByServerId.has(serverId)) {
      return {
        ...persistedOrRuntimeStatus,
        state: 'connecting',
        lastCheckedAt: persistedOrRuntimeStatus.lastCheckedAt
      }
    }

    return persistedOrRuntimeStatus
  }

  private getReconnectSnapshotState(
    serverId: string
  ): Pick<
    McpRuntimeSourceSnapshot,
    'reconnectAttempt' | 'maxReconnectAttempts' | 'reconnectExhausted' | 'reconnectDelayMs' | 'nextReconnectAt'
  > {
    const reconnectAttempt = this.reconnectAttemptByServerId.get(serverId)
    if (!reconnectAttempt) return {}

    const maxReconnectAttempts = normalizeReconnectAttemptLimit(this.deps.maxReconnectAttempts)
    const reconnectSchedule = this.reconnectScheduleByServerId.get(serverId)
    const reconnectExhausted =
      maxReconnectAttempts != null &&
      !this.reconnectTaskByServerId.has(serverId) &&
      !this.pendingHostsByServerId.has(serverId) &&
      isReconnectAttemptLimitExceeded(reconnectAttempt + 1, maxReconnectAttempts)

    return {
      reconnectAttempt,
      ...(maxReconnectAttempts != null ? { maxReconnectAttempts } : {}),
      ...(reconnectSchedule
        ? {
            reconnectDelayMs: reconnectSchedule.delayMs,
            nextReconnectAt: reconnectSchedule.nextReconnectAt
          }
        : {}),
      ...(reconnectExhausted ? { reconnectExhausted: true } : {})
    }
  }

  private getRuntimeLifecycleState(
    serverId: string,
    status: McpRuntimeStatus | undefined
  ): McpRuntimeLifecycleState {
    if (!this.activeServersByServerId.has(serverId)) {
      return 'disabled'
    }

    if (this.reconnectTaskByServerId.has(serverId)) {
      return 'reconnect-scheduled'
    }

    if (this.pendingHostsByServerId.has(serverId)) {
      const reconnectAttempt = this.reconnectAttemptByServerId.get(serverId) ?? 0
      return reconnectAttempt > 0 ? 'reconnecting' : 'connecting'
    }

    const reconnectAttempt = this.reconnectAttemptByServerId.get(serverId) ?? 0
    const maxReconnectAttempts = normalizeReconnectAttemptLimit(this.deps.maxReconnectAttempts)
    if (
      reconnectAttempt > 0 &&
      maxReconnectAttempts != null &&
      isReconnectAttemptLimitExceeded(reconnectAttempt + 1, maxReconnectAttempts)
    ) {
      return 'retry-exhausted'
    }

    if (!status) return 'connecting'
    if (status.state === 'connected') return 'connected'
    if (status.state === 'connecting') return 'connecting'
    if (status.state === 'disabled') return 'disabled'
    return 'terminal-error'
  }
}

function buildMcpRuntimeSourceId(serverId: string): string {
  return `mcp:${serverId}`
}

function buildServerSignature(server: Partial<AgentStoreState['mcpServers'][number]> & Pick<AgentStoreState['mcpServers'][number], 'id'>): string {
  return JSON.stringify({
    id: server.id,
    name: server.name ?? '',
    type: server.type ?? null,
    command: server.command ?? null,
    baseUrl: server.baseUrl ?? null,
    args: server.args ?? [],
    env: server.env ?? {},
    headers: server.headers ?? {},
    disabledTools: server.disabledTools ?? [],
    disabledAutoApproveTools: server.disabledAutoApproveTools ?? [],
    isActive: server.isActive ?? false
  })
}

function cloneServer(server: McpServerEntity): McpServerEntity {
  return {
    ...server,
    args: server.args ? [...server.args] : undefined,
    env: server.env ? { ...server.env } : undefined,
    headers: server.headers ? { ...server.headers } : undefined,
    tags: server.tags ? [...server.tags] : undefined,
    disabledTools: server.disabledTools ? [...server.disabledTools] : undefined,
    disabledAutoApproveTools: server.disabledAutoApproveTools ? [...server.disabledAutoApproveTools] : undefined
  }
}

function mergeRuntimeStatuses(
  persistedStatuses: Record<string, McpRuntimeStatus>,
  runtimeStatuses: ReadonlyMap<string, McpRuntimeStatus>
): Map<string, McpRuntimeStatus> {
  const merged = new Map<string, McpRuntimeStatus>(
    Object.entries(persistedStatuses).map(([serverId, status]) => [serverId, { ...status }])
  )

  for (const [serverId, runtimeStatus] of runtimeStatuses.entries()) {
    const persistedStatus = merged.get(serverId)
    if (!persistedStatus || runtimeStatus.lastCheckedAt >= persistedStatus.lastCheckedAt) {
      merged.set(serverId, { ...runtimeStatus })
    }
  }

  return merged
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : 'MCP runtime host failed.'
}

function resolveReconnectDelayMs(
  reconnectDelayMs: McpRuntimeServiceDependencies['reconnectDelayMs'],
  serverId: string,
  attempt: number
): number {
  const resolvedDelay =
    typeof reconnectDelayMs === 'function' ? reconnectDelayMs(serverId, attempt) : reconnectDelayMs
  const delayMs = typeof resolvedDelay === 'number' && Number.isFinite(resolvedDelay) ? resolvedDelay : 1000
  return Math.max(0, Math.trunc(delayMs))
}

function isReconnectAttemptLimitExceeded(attempt: number, maxReconnectAttempts: number | undefined): boolean {
  const normalizedLimit = normalizeReconnectAttemptLimit(maxReconnectAttempts)
  if (normalizedLimit == null) return false
  return attempt > normalizedLimit
}

function normalizeReconnectAttemptLimit(maxReconnectAttempts: number | undefined): number | null {
  if (typeof maxReconnectAttempts !== 'number' || !Number.isFinite(maxReconnectAttempts)) return null
  return Math.max(0, Math.trunc(maxReconnectAttempts))
}

function scheduleTaskWithTimeout(run: () => void, delayMs: number): McpRuntimeScheduledTaskHandle {
  const handle = setTimeout(run, delayMs)
  return {
    cancel: () => {
      clearTimeout(handle)
    }
  }
}
