import type { ProductAgentToolRegistration } from '../../../product-manifest'
import type { ProductAgentToolHandler, ProductAgentToolHandlerRegistration } from './productAgentToolBootstrapContracts'
import type { ProductAgentToolErrorCode } from './productAgentToolErrors'

export type ProductAgentToolPackagePermissionMode = 'allow-read-only' | 'prompt' | 'disabled'

export type AgentProductToolPackageBinding = {
  agentId: string
  productId: string
  permissionMode: ProductAgentToolPackagePermissionMode
  updatedAt: string
}

export type ProductAgentToolPackageStatus =
  | 'available'
  | 'missing-handler'
  | 'not-installed'

export type ProductAgentToolDescriptor = {
  toolName: string
  productId: string
  handlerId: string
  description: string
  title?: ProductAgentToolRegistration['title']
  schemaVersion: number
  readOnly: boolean
  requiresTemporalBoundary: boolean
  timeoutMs?: number
  maxOutputBytes?: number
  requiresApproval: ProductAgentToolRegistration['requiresApproval']
  hasHandler: boolean
}

export type ProductAgentToolPackageDescriptor = {
  productId: string
  status: ProductAgentToolPackageStatus
  tools: ProductAgentToolDescriptor[]
  diagnostics: string[]
}

export type ProductAgentToolResolvedRegistration = ProductAgentToolRegistration & {
  handle: ProductAgentToolHandler
}

export type ProductAgentToolsRuntimeSnapshot = {
  agentId: string
  packages: Array<{
    productId: string
    status: ProductAgentToolPackageStatus
    permissionMode: ProductAgentToolPackagePermissionMode
    toolNames: string[]
    toolIds: string[]
  }>
  toolIds: string[]
  toolNames: string[]
}

export type ProductAgentToolInvokeInput = {
  agentId: string
  sessionId: string
  productId: string
  toolName: string
  input: unknown
  toolCallId?: string
  consumerProductId?: string
  signal?: AbortSignal
}

export type ProductAgentToolInvokeResult = {
  toolCallId: string
  output: unknown
  outputHash: string
  asOf?: string
  durationMs: number
}

export type ProductAgentToolCallTrace = {
  toolCallId: string
  toolName: string
  productId: string
  handlerId: string
  schemaVersion: number
  consumerProductId?: string
  agentId: string
  agentSessionId: string
  asOf?: string
  inputHash: string
  outputHash?: string
  startedAt: string
  completedAt?: string
  durationMs?: number
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout' | 'denied'
  errorCode?: ProductAgentToolErrorCode
  resultSizeBytes?: number
}

export type ProductAgentToolCallTraceSafeView = ProductAgentToolCallTrace

export type ProductAgentToolHandlerRegistrationInput = ProductAgentToolHandlerRegistration

export type { ProductAgentToolErrorCode } from './productAgentToolErrors'
