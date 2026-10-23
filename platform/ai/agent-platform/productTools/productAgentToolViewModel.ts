import type { ProductAgentToolApprovalMode } from '../../../product-manifest'
import type { ToolApproval } from '../schemas/toolSchemas'
import type {
  AgentProductToolPackageBinding,
  ProductAgentToolPackageDescriptor,
  ProductAgentToolPackagePermissionMode
} from './productAgentToolSchemas'

export type ProductAgentToolPackageEditorView = {
  productId: string
  status: ProductAgentToolPackageDescriptor['status']
  permissionMode: ProductAgentToolPackagePermissionMode
  staleBinding: boolean
  diagnostics: string[]
  tools: Array<{
    toolName: string
    description: string
    readOnly: true
    requiresTemporalBoundary: boolean
    schemaVersion: number
    requiresApproval: ProductAgentToolApprovalMode
  }>
}

/**
 * The package mode is the user's switch; the per-tool declaration can only make a tool stricter.
 *
 * `allow-read-only` means exactly what it says: read-only tools run without a prompt, mutating
 * tools still ask. Before this the mode was never inspected, so it behaved like `prompt` and the
 * editor offered a switch that did nothing.
 */
export function mapProductToolApproval(
  requiresApproval: ProductAgentToolApprovalMode,
  packagePermissionMode: ProductAgentToolPackagePermissionMode,
  readOnly: boolean
): ToolApproval {
  if (packagePermissionMode === 'disabled') {
    return 'prompt'
  }

  if (packagePermissionMode === 'prompt') {
    return 'prompt'
  }

  if (!readOnly) {
    return 'prompt'
  }

  return requiresApproval === 'always' ? 'prompt' : 'auto'
}

export function resolvePackagePermissionMode(
  bindings: readonly AgentProductToolPackageBinding[],
  agentId: string,
  productId: string
): ProductAgentToolPackagePermissionMode {
  const binding = bindings.find((item) => item.agentId === agentId && item.productId === productId)
  return binding?.permissionMode ?? 'disabled'
}

export function buildProductAgentToolPackageEditorView(input: {
  package: ProductAgentToolPackageDescriptor
  binding?: AgentProductToolPackageBinding
  installedProductIds: readonly string[]
}): ProductAgentToolPackageEditorView {
  const installed = new Set(input.installedProductIds)
  const permissionMode = input.binding?.permissionMode ?? 'disabled'
  const staleBinding = Boolean(input.binding && !installed.has(input.package.productId))

  return {
    productId: input.package.productId,
    status: input.package.status,
    permissionMode,
    staleBinding,
    diagnostics: staleBinding
      ? [...input.package.diagnostics, 'Persisted agent binding points to a product package that is no longer installed.']
      : [...input.package.diagnostics],
    tools: input.package.tools.map((tool) => ({
      toolName: tool.toolName,
      description: tool.description,
      readOnly: tool.readOnly,
      requiresTemporalBoundary: tool.requiresTemporalBoundary,
      schemaVersion: tool.schemaVersion,
      requiresApproval: tool.requiresApproval
    }))
  }
}

export function toProductToolCallCardSummary(input: {
  productId: string
  toolName: string
  asOf?: string
  status: string
  durationMs?: number
  outputHash?: string
  errorCode?: string
  consumerProductId?: string
  agentSessionId: string
}): Record<string, string | number | undefined> {
  return {
    productId: input.productId,
    toolName: input.toolName,
    asOf: input.asOf,
    status: input.status,
    durationMs: input.durationMs,
    outputHash: input.outputHash,
    errorCode: input.errorCode,
    consumerProductId: input.consumerProductId,
    agentSessionId: input.agentSessionId
  }
}
