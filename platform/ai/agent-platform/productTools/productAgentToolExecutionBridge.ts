import type { AgentRuntimeSessionChunk } from '../runtime/runtimeTypes'
import type { AgentStoreState } from '../store/agentStore'
import type { ProductAgentToolRuntimeService } from './ProductAgentToolRuntimeService'
import { ProductAgentToolError } from './productAgentToolErrors'
import { resolveProductToolRuntimeName } from './productAgentToolRuntimeNames'
import type { ProductAgentToolsRuntimeSnapshot } from './productAgentToolSchemas'

export type ProductAgentToolExecutionBridgeInput = {
  getState: () => Promise<AgentStoreState>
  sessionId: string
  agentId: string
  runtimeToolName: string
  toolInput: unknown
  toolCallId: string
  consumerProductId?: string
  signal?: AbortSignal
  emitChunk: (chunk: AgentRuntimeSessionChunk) => void
}

export async function invokeProductAgentToolThroughBridge(
  runtime: ProductAgentToolRuntimeService,
  productTools: ProductAgentToolsRuntimeSnapshot,
  input: ProductAgentToolExecutionBridgeInput
): Promise<{ output: unknown; outputHash: string; asOf?: string; toolCallId: string }> {
  const resolved = resolveProductToolRuntimeName(input.runtimeToolName, productTools.packages)
  if (!resolved) {
    throw new ProductAgentToolError('missing-handler', `Unknown product tool runtime name "${input.runtimeToolName}".`)
  }

  const startedAt = Date.now()
  emitProductToolStartChunk(input, resolved)

  try {
    const state = await input.getState()
    const result = await runtime.invokeTool(state, {
      agentId: input.agentId,
      sessionId: input.sessionId,
      productId: resolved.productId,
      toolName: resolved.toolName,
      input: input.toolInput,
      toolCallId: input.toolCallId,
      consumerProductId: input.consumerProductId,
      signal: input.signal
    })

    input.emitChunk({
      type: 'product-tool-call-finish',
      sessionId: input.sessionId,
      toolCallId: input.toolCallId,
      productId: resolved.productId,
      toolName: resolved.toolName,
      status: 'completed',
      durationMs: result.durationMs,
      outputHash: result.outputHash
    })

    return {
      output: result.output,
      outputHash: result.outputHash,
      asOf: result.asOf,
      toolCallId: input.toolCallId
    }
  } catch (error) {
    const errorCode = error instanceof ProductAgentToolError ? error.code : 'handler-error'
    const status =
      errorCode === 'timeout'
        ? 'timeout'
        : errorCode === 'cancelled'
          ? 'cancelled'
          : errorCode === 'approval-denied'
            ? 'denied'
            : 'failed'

    input.emitChunk({
      type: 'product-tool-call-finish',
      sessionId: input.sessionId,
      toolCallId: input.toolCallId,
      productId: resolved.productId,
      toolName: resolved.toolName,
      status,
      durationMs: Date.now() - startedAt,
      errorCode
    })
    throw error
  }
}

function emitProductToolStartChunk(
  input: ProductAgentToolExecutionBridgeInput,
  resolved: { productId: string; toolName: string }
): void {
  const asOf =
    typeof input.toolInput === 'object' &&
    input.toolInput !== null &&
    'asOf' in input.toolInput &&
    typeof (input.toolInput as { asOf?: unknown }).asOf === 'string'
      ? (input.toolInput as { asOf: string }).asOf
      : undefined

  input.emitChunk({
    type: 'product-tool-call-start',
    sessionId: input.sessionId,
    toolCallId: input.toolCallId,
    productId: resolved.productId,
    toolName: resolved.toolName,
    asOf
  })
}

export function createProductToolCallId(): string {
  return `product-tool-call-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
