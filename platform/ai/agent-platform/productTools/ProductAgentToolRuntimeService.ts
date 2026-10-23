import type { ProductManifest, ProductAgentToolApprovalMode } from '../../../product-manifest'
import type { Tool } from '../schemas/toolSchemas'
import type { AgentStoreState } from '../store/agentStore'
import { ToolRegistry } from '../tools/registry'
import { canonicalJsonHash } from './productAgentToolHash'
import {
  buildProductAgentToolId,
  buildProductAgentToolSourceId,
  ProductAgentToolRegistry
} from './ProductAgentToolRegistry'
import { ProductAgentToolError } from './productAgentToolErrors'
import { buildProductAgentToolRuntimeName } from './productAgentToolRuntimeNames'
import type {
  AgentProductToolPackageBinding,
  ProductAgentToolCallTrace,
  ProductAgentToolInvokeInput,
  ProductAgentToolInvokeResult,
  ProductAgentToolsRuntimeSnapshot
} from './productAgentToolSchemas'
import { mapProductToolApproval, resolvePackagePermissionMode } from './productAgentToolViewModel'
import { validateTemporalBoundary } from './productAgentToolTemporalBoundary'
import { validateProductAgentToolJsonSchema } from './productAgentToolSchemaValidation'
import type { ProductAgentToolTraceRepository } from './productAgentToolTraceRepository'
import type { ProductAgentToolErrorCode } from './productAgentToolErrors'

const defaultTimeoutMs = 30_000
const defaultMaxOutputBytes = 256 * 1024

type ProductAgentToolRuntimeServiceDependencies = {
  registry: ProductAgentToolRegistry
  toolRegistry?: ToolRegistry
  traceRepository?: ProductAgentToolTraceRepository
  installedProductIds: () => readonly string[]
  now?: () => string
}

export class ProductAgentToolRuntimeService {
  constructor(private readonly deps: ProductAgentToolRuntimeServiceDependencies) {}

  loadManifestRegistrations(manifests: readonly ProductManifest[]): void {
    for (const manifest of manifests) {
      for (const registration of manifest.productAgentTools ?? []) {
        this.deps.registry.registerToolMetadata({
          ...registration,
          productId: registration.productId || manifest.id
        })
      }
    }
  }

  getAgentRuntime(state: AgentStoreState, agentId: string): ProductAgentToolsRuntimeSnapshot {
    return this.buildSnapshot(state, agentId)
  }

  syncAgentTools(state: AgentStoreState, agentId: string): ProductAgentToolsRuntimeSnapshot {
    const snapshot = this.buildSnapshot(state, agentId)
    const toolRegistry = this.deps.toolRegistry
    if (!toolRegistry) return snapshot

    const activeSourceIds = new Set<string>()
    for (const pkg of snapshot.packages) {
      if (pkg.permissionMode === 'disabled' || pkg.status !== 'available') continue
      const sourceId = buildProductAgentToolSourceId(agentId, pkg.productId)
      activeSourceIds.add(sourceId)
      const tools = this.deps.registry
        .listToolsForProduct(pkg.productId)
        .filter((tool) => tool.hasHandler)
        .map((tool) => toRuntimeTool(agentId, pkg.productId, pkg.permissionMode, tool))
      toolRegistry.registerTools(sourceId, tools)
    }

    for (const binding of (state.agentProductToolPackages ?? []).filter((item) => item.agentId === agentId)) {
      const sourceId = buildProductAgentToolSourceId(agentId, binding.productId)
      if (activeSourceIds.has(sourceId)) continue
      toolRegistry.unregisterSource(sourceId)
    }

    return snapshot
  }

  async invokeTool(state: AgentStoreState, input: ProductAgentToolInvokeInput): Promise<ProductAgentToolInvokeResult> {
    const startedAt = this.timestamp()
    const toolCallId = input.toolCallId ?? createToolCallId()
    const inputHash = safeInputHash(input.input)

    const binding = resolvePackagePermissionMode(state.agentProductToolPackages ?? [], input.agentId, input.productId)
    if (binding === 'disabled') {
      await this.recordTerminalTrace({
        toolCallId,
        toolName: input.toolName,
        productId: input.productId,
        handlerId: 'unknown',
        schemaVersion: 0,
        consumerProductId: input.consumerProductId,
        agentId: input.agentId,
        agentSessionId: input.sessionId,
        inputHash,
        startedAt,
        status: 'failed',
        errorCode: 'tool-disabled'
      })
      throw new ProductAgentToolError('tool-disabled', 'Product tool package is disabled for this agent.')
    }

    const resolved = this.deps.registry.resolve(input.productId, input.toolName)
    if (!resolved) {
      await this.recordTerminalTrace({
        toolCallId,
        toolName: input.toolName,
        productId: input.productId,
        handlerId: 'unknown',
        schemaVersion: 0,
        consumerProductId: input.consumerProductId,
        agentId: input.agentId,
        agentSessionId: input.sessionId,
        inputHash,
        startedAt,
        status: 'failed',
        errorCode: 'missing-handler'
      })
      throw new ProductAgentToolError('missing-handler', 'Product tool handler is not available.')
    }

    if (!this.deps.installedProductIds().includes(input.productId)) {
      await this.recordTerminalTrace({
        toolCallId,
        toolName: input.toolName,
        productId: input.productId,
        handlerId: resolved.handlerId,
        schemaVersion: resolved.schemaVersion,
        consumerProductId: input.consumerProductId,
        agentId: input.agentId,
        agentSessionId: input.sessionId,
        inputHash,
        startedAt,
        status: 'failed',
        errorCode: 'product-unavailable'
      })
      throw new ProductAgentToolError('product-unavailable', 'Product tool package is not installed.')
    }

    const inputSchemaResult = validateProductAgentToolJsonSchema(input.input, resolved.inputSchema)
    if (!inputSchemaResult.ok) {
      await this.recordTerminalTrace({
        toolCallId,
        toolName: input.toolName,
        productId: input.productId,
        handlerId: resolved.handlerId,
        schemaVersion: resolved.schemaVersion,
        consumerProductId: input.consumerProductId,
        agentId: input.agentId,
        agentSessionId: input.sessionId,
        inputHash,
        startedAt,
        status: 'failed',
        errorCode: 'invalid-input-schema'
      })
      throw new ProductAgentToolError('invalid-input-schema', inputSchemaResult.message)
    }

    let asOf: string | undefined
    if (resolved.requiresTemporalBoundary) {
      const boundary = validateTemporalBoundary(input.input)
      if (!boundary.ok) {
        await this.recordTerminalTrace({
          toolCallId,
          toolName: input.toolName,
          productId: input.productId,
          handlerId: resolved.handlerId,
          schemaVersion: resolved.schemaVersion,
          consumerProductId: input.consumerProductId,
          agentId: input.agentId,
          agentSessionId: input.sessionId,
          inputHash,
          startedAt,
          status: 'failed',
          errorCode: boundary.errorCode
        })
        throw new ProductAgentToolError(boundary.errorCode, boundary.message)
      }
      asOf = boundary.asOf
    }

    await this.insertTrace({
      toolCallId,
      toolName: input.toolName,
      productId: input.productId,
      handlerId: resolved.handlerId,
      schemaVersion: resolved.schemaVersion,
      consumerProductId: input.consumerProductId,
      agentId: input.agentId,
      agentSessionId: input.sessionId,
      asOf,
      inputHash,
      startedAt,
      status: 'running'
    })

    const timeoutMs = resolved.timeoutMs ?? defaultTimeoutMs
    const maxOutputBytes = resolved.maxOutputBytes ?? defaultMaxOutputBytes
    const abortController = new AbortController()
    const timeoutHandle = setTimeout(() => abortController.abort(new Error('timeout')), timeoutMs)
    const signal = mergeAbortSignals(input.signal, abortController.signal)

    try {
      const output = await resolved.handle(input.input, {
        toolCallId,
        productId: input.productId,
        toolName: input.toolName,
        schemaVersion: resolved.schemaVersion,
        consumerProductId: input.consumerProductId,
        agentId: input.agentId,
        agentSessionId: input.sessionId,
        signal,
        log: async () => undefined
      })

      const outputSchemaResult = validateProductAgentToolJsonSchema(output, resolved.outputSchema)
      if (!outputSchemaResult.ok) {
        await this.finalizeTrace({
          toolCallId,
          toolName: input.toolName,
          productId: input.productId,
          handlerId: resolved.handlerId,
          schemaVersion: resolved.schemaVersion,
          consumerProductId: input.consumerProductId,
          agentId: input.agentId,
          agentSessionId: input.sessionId,
          asOf,
          inputHash,
          startedAt,
          ...terminalFields(startedAt, 'failed', 'invalid-output-schema')
        })
        throw new ProductAgentToolError('invalid-output-schema', outputSchemaResult.message)
      }

      const outputHashResult = canonicalJsonHash(output)
      if (outputHashResult.byteLength > maxOutputBytes) {
        await this.finalizeTrace({
          toolCallId,
          toolName: input.toolName,
          productId: input.productId,
          handlerId: resolved.handlerId,
          schemaVersion: resolved.schemaVersion,
          consumerProductId: input.consumerProductId,
          agentId: input.agentId,
          agentSessionId: input.sessionId,
          asOf,
          inputHash,
          startedAt,
          ...terminalFields(startedAt, 'failed', 'output-too-large'),
          resultSizeBytes: outputHashResult.byteLength
        })
        throw new ProductAgentToolError('output-too-large', 'Product tool output exceeded the platform size limit.')
      }

      const completedAt = this.timestamp()
      const durationMs = Date.parse(completedAt) - Date.parse(startedAt)
      await this.finalizeTrace({
        toolCallId,
        toolName: input.toolName,
        productId: input.productId,
        handlerId: resolved.handlerId,
        schemaVersion: resolved.schemaVersion,
        consumerProductId: input.consumerProductId,
        agentId: input.agentId,
        agentSessionId: input.sessionId,
        asOf,
        inputHash,
        outputHash: outputHashResult.sha256,
        startedAt,
        completedAt,
        durationMs,
        status: 'completed',
        resultSizeBytes: outputHashResult.byteLength
      })

      return {
        toolCallId,
        output,
        outputHash: outputHashResult.sha256,
        asOf,
        durationMs
      }
    } catch (error) {
      const errorCode = resolveInvokeErrorCode(error, abortController.signal)
      await this.finalizeTrace({
        toolCallId,
        toolName: input.toolName,
        productId: input.productId,
        handlerId: resolved.handlerId,
        schemaVersion: resolved.schemaVersion,
        consumerProductId: input.consumerProductId,
        agentId: input.agentId,
        agentSessionId: input.sessionId,
        asOf,
        inputHash,
        startedAt,
        ...terminalFields(startedAt, resolveTerminalStatus(errorCode), errorCode)
      })
      if (error instanceof ProductAgentToolError) throw error
      throw new ProductAgentToolError('handler-error', error instanceof Error ? error.message : 'Product tool handler failed.')
    } finally {
      clearTimeout(timeoutHandle)
    }
  }

  private buildSnapshot(state: AgentStoreState, agentId: string): ProductAgentToolsRuntimeSnapshot {
    const installedProductIds = this.deps.installedProductIds()
    const packages = this.deps.registry.listPackages(installedProductIds).map((pkg) => {
      const permissionMode = resolvePackagePermissionMode(state.agentProductToolPackages ?? [], agentId, pkg.productId)
      const available = pkg.status === 'available' && permissionMode !== 'disabled' && installedProductIds.includes(pkg.productId)
      const toolNames = available
        ? pkg.tools.filter((tool) => tool.hasHandler).map((tool) => buildProductAgentToolRuntimeName(pkg.productId, tool.toolName))
        : []
      const toolIds = available
        ? pkg.tools.filter((tool) => tool.hasHandler).map((tool) => buildProductAgentToolId(pkg.productId, tool.toolName, tool.schemaVersion))
        : []
      return {
        productId: pkg.productId,
        status: pkg.status,
        permissionMode,
        toolNames,
        toolIds
      }
    })

    const toolIds = packages.flatMap((pkg) => pkg.toolIds)
    const toolNames = packages.flatMap((pkg) => pkg.toolNames)

    return {
      agentId,
      packages,
      toolIds,
      toolNames
    }
  }

  private async recordTerminalTrace(trace: ProductAgentToolCallTrace): Promise<void> {
    const completedAt = trace.completedAt ?? this.timestamp()
    const durationMs = trace.durationMs ?? Math.max(0, Date.parse(completedAt) - Date.parse(trace.startedAt))
    await this.insertTrace({
      ...trace,
      completedAt,
      durationMs
    })
  }

  private async insertTrace(trace: ProductAgentToolCallTrace): Promise<void> {
    await this.deps.traceRepository?.insert(trace)
  }

  private async finalizeTrace(trace: ProductAgentToolCallTrace): Promise<void> {
    await this.deps.traceRepository?.finalize(trace)
  }

  private timestamp(): string {
    return this.deps.now?.() ?? new Date().toISOString()
  }
}

function toRuntimeTool(
  agentId: string,
  productId: string,
  permissionMode: import('./productAgentToolSchemas').ProductAgentToolPackagePermissionMode,
  tool: {
    toolName: string
    description: string
    schemaVersion: number
    readOnly: true
    requiresTemporalBoundary: boolean
    requiresApproval: ProductAgentToolApprovalMode
  }
): Tool {
  return {
    id: buildProductAgentToolId(productId, tool.toolName, tool.schemaVersion),
    name: tool.toolName,
    description: tool.description,
    origin: 'product',
    approval: mapProductToolApproval(tool.requiresApproval, permissionMode, tool.readOnly),
    sourceId: buildProductAgentToolSourceId(agentId, productId),
    sourceName: productId,
    productId,
    readOnly: tool.readOnly,
    schemaVersion: tool.schemaVersion,
    requiresTemporalBoundary: tool.requiresTemporalBoundary
  }
}

function createToolCallId(): string {
  return `product-tool-call-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function safeInputHash(input: unknown): string {
  try {
    return canonicalJsonHash(input).sha256
  } catch {
    return 'unhashable-input'
  }
}

function terminalFields(
  startedAt: string,
  status: ProductAgentToolCallTrace['status'],
  errorCode?: ProductAgentToolErrorCode
): Pick<ProductAgentToolCallTrace, 'completedAt' | 'durationMs' | 'status' | 'errorCode'> {
  const completedAt = new Date().toISOString()
  return {
    completedAt,
    durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
    status,
    ...(errorCode ? { errorCode } : {})
  }
}

function resolveTerminalStatus(errorCode: ProductAgentToolErrorCode): ProductAgentToolCallTrace['status'] {
  if (errorCode === 'timeout') return 'timeout'
  if (errorCode === 'cancelled') return 'cancelled'
  if (errorCode === 'approval-denied') return 'failed'
  return 'failed'
}

function mergeAbortSignals(primary: AbortSignal | undefined, secondary: AbortSignal): AbortSignal {
  if (!primary) return secondary
  if (primary.aborted) return primary
  const controller = new AbortController()
  const abort = () => controller.abort(primary.reason ?? secondary.reason)
  primary.addEventListener('abort', abort, { once: true })
  secondary.addEventListener('abort', abort, { once: true })
  return controller.signal
}

function resolveInvokeErrorCode(error: unknown, signal: AbortSignal): import('./productAgentToolErrors').ProductAgentToolErrorCode {
  if (error instanceof ProductAgentToolError) return error.code
  if (signal.aborted) {
    const reason = signal.reason
    if (reason instanceof Error && reason.message === 'timeout') return 'timeout'
    return 'cancelled'
  }
  return 'handler-error'
}

export function upsertAgentProductToolPackageBinding(
  bindings: readonly AgentProductToolPackageBinding[],
  binding: AgentProductToolPackageBinding
): AgentProductToolPackageBinding[] {
  const next = bindings.filter((item) => !(item.agentId === binding.agentId && item.productId === binding.productId))
  return [...next, binding]
}
