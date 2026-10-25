import type { GuardedHandler, IntelligenceAgentCapability, ToolCallContext } from './capabilityTypes'
import { createGuardedHandler, isGuardedHandlerValue, ProductToolGuardError } from './capabilityTypes'
import { guardProductToolOutput } from './sensitiveDataGuard'
import type { CapabilityActionRules } from './strictInputGuard'
import { validateCapabilityInput } from './strictInputGuard'

export type WrapProductToolHandlerOptions = {
  capability: Pick<IntelligenceAgentCapability, 'id' | 'inputSchema'>
  handle: (input: unknown, context: ToolCallContext) => Promise<unknown>
  /** Action-scoped field allow-lists, forwarded to the input validator. */
  actionRules?: CapabilityActionRules
}

/**
 * Input guard -> handler -> output guard. `createGuardedHandler` is the only
 * way to obtain the runtime brand, so a hand-built look-alike cannot pass
 * `isGuardedHandler`. Handler failures become fixed-text errors so provider
 * messages cannot leak values.
 */
export function wrapProductToolHandler({
  capability,
  handle,
  actionRules
}: WrapProductToolHandlerOptions): GuardedHandler {
  return createGuardedHandler({
    capabilityId: capability.id,
    handle: async (input, context) => {
      const validation = validateCapabilityInput(input, capability.inputSchema, actionRules)
      if (!validation.ok) throw new ProductToolGuardError(validation.code, validation.message)

      let output: unknown
      try {
        output = await handle(input, context)
      } catch (error) {
        if (error instanceof ProductToolGuardError) throw error
        throw new ProductToolGuardError('handler-error', 'Tool execution failed.')
      }

      return guardProductToolOutput(output)
    }
  })
}

/** Retained public predicate; delegates to the brand owned by `capabilityTypes`. */
export function isGuardedHandler(value: unknown): value is GuardedHandler {
  return isGuardedHandlerValue(value)
}
