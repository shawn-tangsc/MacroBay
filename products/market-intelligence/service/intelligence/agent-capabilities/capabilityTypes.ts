import type { ProductAgentToolHandlerContext } from '@platform/ai/agent-platform/productTools/productAgentToolBootstrapContracts'
import type { LocalizedText } from '@platform/product-manifest'

export type CapabilityDomain =
  | 'query'
  | 'source-config'
  | 'calendar'
  | 'translation'
  | 'cross-asset'
  | 'operations'

export type CapabilityKind = 'read' | 'write' | 'discovery' | 'handoff'

export type IntelligenceAgentCapability = {
  id: string
  domain: CapabilityDomain
  kind: CapabilityKind
  title: LocalizedText
  description: string
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  handlerId: string
  timeoutMs: number
  maxOutputBytes: number
}

declare const guardedHandlerBrand: unique symbol

/**
 * Only `wrapProductToolHandler` can produce this shape; the brand is not
 * exported as a value so callers cannot bypass the guards.
 */
export type GuardedHandler = {
  readonly [guardedHandlerBrand]: true
  readonly capabilityId: string
  handle(input: unknown, context: ToolCallContext): Promise<unknown>
}

/** Mirrors the platform context field-for-field, with no product-side additions. */
export type ToolCallContext = ProductAgentToolHandlerContext

export type ProductToolGuardCode =
  | 'invalid-input'
  | 'unexpected-property'
  | 'missing-property'
  | 'type-mismatch'
  | 'invalid-enum'
  | 'out-of-range'
  | 'string-too-long'
  | 'sensitive-input-rejected'
  | 'invalid-action-fields'
  | 'sensitive-output-blocked'
  | 'output-too-deep'
  | 'approval-denied'
  | 'tool-disabled'
  | 'timeout'
  | 'source-not-ready'
  | 'handler-error'

export class ProductToolGuardError extends Error {
  readonly code: ProductToolGuardCode

  constructor(code: ProductToolGuardCode, message: string) {
    super(message)
    this.name = 'ProductToolGuardError'
    this.code = code
  }
}
