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

const GUARDED: unique symbol = Symbol('mi.guarded')

/**
 * Only `createGuardedHandler` can produce this shape. The symbol stays module
 * private, so a hand-built object that happens to have the same fields fails
 * `isGuardedHandlerValue`.
 */
export type GuardedHandler = {
  readonly [GUARDED]: true
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
  | 'invalid-output'
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

/**
 * The only constructor of a `GuardedHandler`. The marker is a non-enumerable
 * symbol property, so spreading a guarded handler does not carry the brand.
 */
export function createGuardedHandler(handler: {
  readonly capabilityId: string
  handle(input: unknown, context: ToolCallContext): Promise<unknown>
}): GuardedHandler {
  const guarded = {
    capabilityId: handler.capabilityId,
    handle: handler.handle
  }
  Object.defineProperty(guarded, GUARDED, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false
  })
  return guarded as unknown as GuardedHandler
}

export function isGuardedHandlerValue(value: unknown): value is GuardedHandler {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<PropertyKey, unknown>
  if (!Object.prototype.hasOwnProperty.call(candidate, GUARDED)) return false
  if (candidate[GUARDED] !== true) return false
  return (
    typeof candidate.capabilityId === 'string' &&
    candidate.capabilityId.length > 0 &&
    typeof candidate.handle === 'function'
  )
}
