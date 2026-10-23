import type { GuardedHandler, IntelligenceAgentCapability, ToolCallContext } from './capabilityTypes'
import { ProductToolGuardError } from './capabilityTypes'
import { guardProductToolOutput } from './sensitiveDataGuard'
import { validateCapabilityInput } from './strictInputGuard'

export type WrapProductToolHandlerOptions = {
  capability: Pick<IntelligenceAgentCapability, 'id' | 'inputSchema'>
  handle: (input: unknown, context: ToolCallContext) => Promise<unknown>
}

/**
 * The only constructor of `GuardedHandler`. Input guard -> handler -> output guard.
 * Handler failures become fixed-text errors so provider messages cannot leak values.
 */
export function wrapProductToolHandler({ capability, handle }: WrapProductToolHandlerOptions): GuardedHandler {
  return {
    capabilityId: capability.id,
    handle: async (input, context) => {
      const validation = validateCapabilityInput(input, capability.inputSchema)
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
  } as GuardedHandler
}

export function isGuardedHandler(value: unknown): value is GuardedHandler {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { capabilityId?: unknown; handle?: unknown }
  return (
    typeof candidate.capabilityId === 'string' &&
    candidate.capabilityId.length > 0 &&
    typeof candidate.handle === 'function'
  )
}
